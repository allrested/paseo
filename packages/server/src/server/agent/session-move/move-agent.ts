import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Logger } from "pino";
import {
  MOVED_FROM_AGENT_ID_LABEL,
  MOVED_TO_AGENT_ID_LABEL,
  PARENT_AGENT_ID_LABEL,
  getMovedFromAgentId,
  getMovedToAgentId,
  getParentAgentIdFromLabels,
} from "@getpaseo/protocol/agent-labels";
import { AgentNotFoundError, ensureAgentLoaded } from "../agent-loading.js";
import {
  AgentRunCancellationError,
  type AgentManager,
  type ManagedAgent,
} from "../agent-manager.js";
import {
  sendPromptToAgent,
  unarchiveAgentState,
  waitForAgentRunStartWithTimeout,
} from "../agent-prompt.js";
import type { AgentMode, AgentSessionConfig } from "../agent-sdk-types.js";
import type { AgentStorage, StoredAgentRecord } from "../agent-storage.js";
import { createAgentCommand } from "../create-agent/create.js";
import { archiveAgentCommand, cancelAgentRunCommand } from "../lifecycle-command.js";
import type { ProviderLaunchInfo, ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import { claudeConfigDir } from "../providers/claude/project-dir.js";
import {
  copyClaudeTranscript,
  undoClaudeTranscriptCopy,
  type ClaudeTranscriptCopy,
} from "./claude-transcript.js";
import { MOVE_CONTINUE_PROMPT, extendMoveHistory, renderMoveHistory } from "./handoff-context.js";
import type { MoveChain, MoveHistory, PendingMoveContext } from "./pending-context.js";

export type MoveAgentErrorCode = "busy" | "unavailable" | "not_found" | "failed";

export class MoveAgentError extends Error {
  constructor(
    readonly code: MoveAgentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MoveAgentError";
  }
}

export interface MoveAgentDeps {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  providerSnapshotManager: ProviderSnapshotManager;
  logger: Logger;
  paseoHome?: string;
  worktreesRoot?: string;
}

export interface MoveAgentInput {
  agentId: string;
  target: { provider: string; model?: string };
  continueWork: boolean;
}

export interface MoveAgentBackInput {
  agentId: string;
  continueWork: boolean;
  /** An earlier agent in the move chain to return to. Defaults to the direct moved-from agent. */
  toAgentId?: string;
}

export interface MoveAgentResult {
  agentId: string;
  strategy: "native" | "handoff";
  /**
   * True when both agents ran Claude with a session to share and the transcript could not be
   * shared, so the move fell back to a history handoff.
   */
  fellBackFromNative: boolean;
}

interface MoveTargetProvider {
  info: ProviderLaunchInfo;
  modes: readonly AgentMode[];
}

/** Refuses a target the daemon cannot start, before anything stops the agent's turn. */
async function requireTarget(
  deps: MoveAgentDeps,
  provider: string,
  cwd: string,
): Promise<MoveTargetProvider> {
  const info = deps.providerSnapshotManager.getProviderLaunchInfo(provider);
  if (!info || !info.enabled) {
    throw new MoveAgentError("unavailable", `Provider ${provider} is not available`);
  }
  // The readiness createAgentCommand demands of a handoff target, checked before settle.
  const entry = await deps.providerSnapshotManager.getProvider({ cwd, provider, wait: true });
  if (entry.status !== "ready") {
    throw new MoveAgentError(
      "unavailable",
      entry.error
        ? `Provider ${provider} is not available: ${entry.error}`
        : `Provider ${provider} is not available`,
    );
  }
  return { info, modes: entry.modes ?? [] };
}

function familyOf(deps: MoveAgentDeps, provider: string): string {
  return deps.providerSnapshotManager.getProviderLaunchInfo(provider)?.family ?? provider;
}

function labelOf(deps: MoveAgentDeps, provider: string): string {
  return deps.providerSnapshotManager.getProviderLaunchInfo(provider)?.label ?? provider;
}

/** Loads the agent and stops its turn, so its timeline is final before anything reads it. */
async function settle(deps: MoveAgentDeps, agentId: string): Promise<ManagedAgent> {
  try {
    await ensureAgentLoaded(agentId, {
      agentManager: deps.agentManager,
      agentStorage: deps.agentStorage,
      logger: deps.logger,
    });
    await cancelAgentRunCommand({ agentManager: deps.agentManager, logger: deps.logger }, agentId);
  } catch (error) {
    if (error instanceof AgentNotFoundError) {
      throw new MoveAgentError("not_found", `Agent not found: ${agentId}`);
    }
    if (error instanceof AgentRunCancellationError) {
      throw new MoveAgentError("busy", "Agent is busy; stop it first");
    }
    throw error;
  }
  const agent = deps.agentManager.getAgent(agentId);
  if (!agent) throw new MoveAgentError("not_found", `Agent not found: ${agentId}`);
  return agent;
}

/**
 * Refuses an archived agent: the session lives on in the agent it moved to, and moving the
 * archived one would fork the chain from stale work. An agent with no record (internal) is live.
 */
async function requireLiveSource(
  deps: MoveAgentDeps,
  agentId: string,
): Promise<StoredAgentRecord | null> {
  const record = await deps.agentStorage.get(agentId);
  if (record?.archivedAt) {
    const movedTo = getMovedToAgentId(record.labels);
    throw new MoveAgentError(
      "not_found",
      movedTo
        ? `Agent ${agentId} is archived; it moved to ${movedTo}`
        : `Agent ${agentId} is archived`,
    );
  }
  return record ?? null;
}

/** The chain as it stands when `source` gives up the session, plus its undelivered history. */
async function readChain(
  deps: MoveAgentDeps,
  source: ManagedAgent,
): Promise<{ chain: MoveChain; undelivered: PendingMoveContext | null }> {
  const stored = await deps.agentStorage.get(source.id);
  return {
    chain: extendMoveHistory({
      history: stored?.moveHistory ?? null,
      agentId: source.id,
      label: labelOf(deps, source.provider),
      rows: await deps.agentManager.getTimelineRows(source.id),
    }),
    undelivered: stored?.pendingMoveContext ?? null,
  };
}

/**
 * The receiver's last timeline seq. Read after it is loaded or hydrated: a later hydrate of the
 * same transcript prefix renumbers to the same rows, so the seq stays a valid cut across restarts.
 */
async function latestSeq(deps: MoveAgentDeps, agentId: string): Promise<number> {
  return (await deps.agentManager.getTimelineRows(agentId)).at(-1)?.seq ?? 0;
}

/** The env a Claude process for this agent launches with: daemon, then provider, then agent. */
function launchEnv(
  deps: MoveAgentDeps,
  provider: string,
  agentEnv: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  const info = deps.providerSnapshotManager.getProviderLaunchInfo(provider);
  return { ...process.env, ...info?.env, ...agentEnv };
}

interface SharedTranscript {
  shared: boolean;
  /** The copy this move made, which a failed move must undo. */
  copy: ClaudeTranscriptCopy | null;
}

const NOT_SHARED: SharedTranscript = { shared: false, copy: null };

/**
 * Makes the session transcript readable from the target login. Same config dir means the
 * target already reads the file, so there is nothing to copy. A failed copy, a missing source and
 * a target transcript with turns the source lacks are reported as not shared, so the caller
 * falls back to a history handoff.
 */
async function shareClaudeTranscript(
  deps: MoveAgentDeps,
  input: {
    cwd: string;
    sessionId: string;
    fromEnv: NodeJS.ProcessEnv;
    toEnv: NodeJS.ProcessEnv;
  },
): Promise<SharedTranscript> {
  const fromConfigDir = claudeConfigDir(input.fromEnv);
  const toConfigDir = claudeConfigDir(input.toEnv);
  if (resolve(fromConfigDir) === resolve(toConfigDir)) return { shared: true, copy: null };
  try {
    const copied = await copyClaudeTranscript({
      cwd: input.cwd,
      sessionId: input.sessionId,
      fromConfigDir,
      toConfigDir,
    });
    if (copied.status === "diverged") {
      deps.logger.warn(
        { path: copied.path },
        "move: target transcript diverged from the source, falling back to handoff",
      );
    }
    if (copied.status !== "copied") return NOT_SHARED;
    return { shared: true, copy: { path: copied.path, previousSize: copied.previousSize } };
  } catch (error) {
    // Only a file-system failure means "cannot share"; anything else is a bug and surfaces.
    if (!isFsError(error)) throw error;
    deps.logger.warn({ err: error }, "move: transcript copy failed, falling back to handoff");
    return NOT_SHARED;
  }
}

/** Errors from fs calls carry an errno code such as ENOENT or EACCES. */
function isFsError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && /^E[A-Z]+$/.test(code);
}

/** Undoes a failed move's transcript copy: a created file goes, a replaced one gets its old bytes. */
async function undoTranscriptCopy(deps: MoveAgentDeps, shared: SharedTranscript | null) {
  if (!shared?.copy) return;
  await undoClaudeTranscriptCopy(shared.copy).catch((error: unknown) => {
    deps.logger.error({ err: error }, "move: failed to undo transcript copy");
  });
}

async function storedTitle(deps: MoveAgentDeps, agent: ManagedAgent): Promise<string | null> {
  return (await deps.agentStorage.get(agent.id))?.title ?? agent.config.title ?? null;
}

async function continueAgent(deps: MoveAgentDeps, agentId: string): Promise<void> {
  const { disposition } = await sendPromptToAgent({
    agentManager: deps.agentManager,
    agentStorage: deps.agentStorage,
    logger: deps.logger,
    agentId,
    prompt: MOVE_CONTINUE_PROMPT,
    // A message id makes the prompt a visible user message in the timeline, as a typed one is.
    messageId: randomUUID(),
  });
  if (disposition === "turn_started") {
    await waitForAgentRunStartWithTimeout(deps.agentManager, agentId);
  }
}

/** What `finish` changed so far, so a failed move can undo exactly that. */
interface FinishProgress {
  reparentedChildIds: string[];
  /** The moved-from link `finish` replaced on the agent it hands to; value null means none. */
  previousMovedFrom: { agentId: string; value: string | null } | null;
  linked: boolean;
}

function newFinishProgress(): FinishProgress {
  return { reparentedChildIds: [], previousMovedFrom: null, linked: false };
}

/** Live sub-agents of `parentId`. Internal ones never reach storage, so they come from memory. */
async function listChildIds(deps: MoveAgentDeps, parentId: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const record of await deps.agentStorage.listActive()) {
    if (getParentAgentIdFromLabels(record.labels) === parentId) {
      ids.add(record.id);
    }
  }
  for (const agent of deps.agentManager.listAgents({ includeInternal: true })) {
    if (agent.internal && getParentAgentIdFromLabels(agent.labels) === parentId) ids.add(agent.id);
  }
  return [...ids];
}

async function setParent(deps: MoveAgentDeps, childId: string, parentId: string): Promise<void> {
  await deps.agentManager.updateAgentMetadata(childId, {
    labels: { [PARENT_AGENT_ID_LABEL]: parentId },
  });
}

/**
 * Hands the sub-agents to the successor, links both agents and archives the one being left.
 * Runs last, after the successor started. Archiving cascades to children that still name the
 * agent being left as parent, so they are re-parented first and follow the session. A forward
 * successor carries its moved-from link from creation; an agent moved back to gets it here.
 */
async function finish(
  deps: MoveAgentDeps,
  from: ManagedAgent,
  to: ManagedAgent,
  progress: FinishProgress,
): Promise<void> {
  for (const childId of await listChildIds(deps, from.id)) {
    if (childId === to.id) continue;
    await setParent(deps, childId, to.id);
    progress.reparentedChildIds.push(childId);
  }
  // `to` is stale after a native reload, so the labels come from the live agent.
  const movedFrom = getMovedFromAgentId(deps.agentManager.getAgent(to.id)?.labels) ?? null;
  if (movedFrom !== from.id) {
    progress.previousMovedFrom = { agentId: to.id, value: movedFrom };
    await deps.agentManager.setLabels(to.id, { [MOVED_FROM_AGENT_ID_LABEL]: from.id });
  }
  progress.linked = true;
  await deps.agentManager.setLabels(from.id, { [MOVED_TO_AGENT_ID_LABEL]: to.id });
  await archiveAgentCommand(
    { agentManager: deps.agentManager, agentStorage: deps.agentStorage, logger: deps.logger },
    from.id,
  );
  deps.agentManager.notifyAgentMoved(from.id, to.id, { internal: from.internal === true });
}

/**
 * Undoes a partly-run `finish`: the target's old moved-from back, children back under `from`,
 * `from` unlinked and unarchived.
 */
async function undoFinish(
  deps: MoveAgentDeps,
  from: ManagedAgent,
  progress: FinishProgress,
): Promise<void> {
  const previous = progress.previousMovedFrom;
  if (previous) {
    await deps.agentManager
      .setLabels(previous.agentId, { [MOVED_FROM_AGENT_ID_LABEL]: previous.value })
      .catch((error: unknown) => {
        deps.logger.error(
          { err: error, agentId: previous.agentId },
          "move: failed to restore moved-from link",
        );
      });
  }
  for (const childId of progress.reparentedChildIds) {
    await setParent(deps, childId, from.id).catch((error: unknown) => {
      deps.logger.error({ err: error, agentId: childId }, "move: failed to restore child parent");
    });
  }
  if (!progress.linked) return;
  try {
    const record = await deps.agentStorage.get(from.id);
    if (record?.archivedAt) {
      await unarchiveAgentState(deps.agentStorage, deps.agentManager, from.id, {
        labels: { [MOVED_TO_AGENT_ID_LABEL]: null },
      });
    } else {
      await deps.agentManager.setLabels(from.id, { [MOVED_TO_AGENT_ID_LABEL]: null });
    }
  } catch (error) {
    deps.logger.error({ err: error, agentId: from.id }, "move: failed to restore original agent");
  }
}

const movesInFlight = new Set<string>();

/**
 * One move at a time per agent: a second one would settle and archive the same source. Move
 * back nests a second lock for the agent it returns to. The lock never waits, so nesting
 * cannot deadlock: a held id refuses the newcomer.
 */
async function withMoveLock<T>(agentId: string, run: () => Promise<T>): Promise<T> {
  if (movesInFlight.has(agentId)) {
    throw new MoveAgentError("busy", "A move is already in progress for this agent");
  }
  movesInFlight.add(agentId);
  try {
    return await run();
  } finally {
    movesInFlight.delete(agentId);
  }
}

/** Deletes a half-created successor the same way the delete-agent request does. */
async function removeCreatedAgent(deps: MoveAgentDeps, agent: ManagedAgent): Promise<void> {
  deps.agentStorage.beginDelete(agent.id);
  await deps.agentManager.closeAgent(agent.id).catch((error: unknown) => {
    deps.logger.warn({ err: error, agentId: agent.id }, "move: failed to close new agent");
  });
  await deps.agentManager.flush();
  await deps.agentStorage.remove(agent.id);
  await deps.agentManager.deleteAgentState(agent.id);
  deps.agentManager.notifyAgentRemoved({
    id: agent.id,
    workspaceId: agent.workspaceId,
    internal: false,
  });
}

function toMoveError(error: unknown): MoveAgentError {
  if (error instanceof MoveAgentError) return error;
  return new MoveAgentError("failed", error instanceof Error ? error.message : String(error));
}

async function resumeNatively(
  deps: MoveAgentDeps,
  source: ManagedAgent,
  target: ProviderLaunchInfo,
  model: string | undefined,
  labels: Record<string, string>,
  onShared: (shared: SharedTranscript) => void,
): Promise<ManagedAgent | null> {
  const sessionId = source.persistence?.sessionId;
  if (familyOf(deps, source.provider) !== "claude" || target.family !== "claude") return null;
  if (!source.persistence || !sessionId) return null;
  const shared = await shareClaudeTranscript(deps, {
    cwd: source.cwd,
    sessionId,
    fromEnv: launchEnv(deps, source.provider, source.launchEnv),
    toEnv: launchEnv(deps, target.providerId, undefined),
  });
  onShared(shared);
  if (!shared.shared) return null;
  return deps.agentManager.resumeAgentFromPersistence(
    { ...source.persistence, provider: target.providerId },
    { cwd: source.cwd, ...(model ? { model } : {}) },
    undefined,
    { labels, workspaceId: source.workspaceId, background: source.background },
  );
}

/** A same-family successor keeps the source's mode and feature values, as a native move does. */
function carriedSettings(
  deps: MoveAgentDeps,
  source: ManagedAgent,
  target: MoveTargetProvider,
): Pick<AgentSessionConfig, "modeId" | "featureValues"> {
  if (familyOf(deps, source.provider) !== target.info.family) return {};
  const modeId = source.currentModeId ?? source.config.modeId ?? undefined;
  return {
    // A mode the target does not list would fail the create after settle stopped the turn.
    ...(modeId && target.modes.some((mode) => mode.id === modeId) ? { modeId } : {}),
    ...(source.config.featureValues ? { featureValues: source.config.featureValues } : {}),
  };
}

/** True when a native share was attempted and failed; null means it never was. */
function attemptedNative(shared: SharedTranscript | null): boolean {
  return shared !== null && !shared.shared;
}

async function moveForward(
  deps: MoveAgentDeps,
  source: ManagedAgent,
  target: MoveTargetProvider,
  options: { model?: string; continueWork: boolean },
): Promise<MoveAgentResult> {
  if (!source.workspaceId) {
    throw new MoveAgentError("failed", "Agent has no workspace to move within");
  }
  const workspaceId = source.workspaceId;
  const title = await storedTitle(deps, source);
  const { chain, undelivered } = await readChain(deps, source);
  // The successor stands in for the source, so it inherits every label the source carries:
  // its own parent link (paseo.parent-agent-id / paseo.parent-server-id, so it stays a sub-agent
  // of the same parent), its open tabs (paseo.open-agent-tab.*, so archive keeps it listed), an
  // earlier paseo.moved-from-agent-id (overwritten below to point at the source), and any user
  // labels. The source's own moved-to link is the one label that does not carry over.
  const labels: Record<string, string> = {
    ...source.labels,
    [MOVED_FROM_AGENT_ID_LABEL]: source.id,
  };
  delete labels[MOVED_TO_AGENT_ID_LABEL];

  let created: ManagedAgent | null = null;
  let shared: SharedTranscript | null = null;
  const progress = newFinishProgress();
  try {
    created = await resumeNatively(deps, source, target.info, options.model, labels, (result) => {
      shared = result;
    });
    if (created) {
      const moved = created;
      await deps.agentManager.hydrateTimelineFromProvider(moved.id);
      // The shared transcript lacks a history the source never delivered, so it carries over.
      await deps.agentStorage.setMoveState(moved.id, {
        moveHistory: { ...chain, sinceSeq: await latestSeq(deps, moved.id) },
        pendingMoveContext: undelivered,
      });
      if (title) await deps.agentManager.updateAgentMetadata(moved.id, { title });
      if (options.continueWork) await continueAgent(deps, moved.id);
      await finish(deps, source, moved, progress);
      return { agentId: moved.id, strategy: "native", fellBackFromNative: false };
    }

    const result = await createAgentCommand(
      {
        agentManager: deps.agentManager,
        agentStorage: deps.agentStorage,
        logger: deps.logger,
        paseoHome: deps.paseoHome,
        worktreesRoot: deps.worktreesRoot,
        providerSnapshotManager: deps.providerSnapshotManager,
      },
      {
        kind: "session",
        onAgentReady: async (agent) => {
          created = agent;
        },
        config: {
          provider: target.info.providerId,
          cwd: source.cwd,
          ...carriedSettings(deps, source, target),
          ...(options.model ? { model: options.model } : {}),
          ...(title ? { title } : {}),
        },
        workspaceId,
        labels,
        background: source.background ?? false,
        provisionalTitle: title,
        firstAgentContext: { attachments: [] },
      },
    );
    const moved = result.snapshot;
    // Stored before the first prompt so either path (continue now, or the user's next message)
    // takes it through the same at-most-once read in sendPreparedPromptToAgent.
    await deps.agentStorage.setMoveState(moved.id, {
      moveHistory: { ...chain, sinceSeq: await latestSeq(deps, moved.id) },
      pendingMoveContext: renderMoveHistory({
        chain,
        fromLabel: labelOf(deps, source.provider),
        agentTitle: title,
        cwd: source.cwd,
      }),
    });
    if (options.continueWork) await continueAgent(deps, moved.id);
    await finish(deps, source, moved, progress);
    return { agentId: moved.id, strategy: "handoff", fellBackFromNative: attemptedNative(shared) };
  } catch (error) {
    await undoFinish(deps, source, progress);
    if (created) {
      await removeCreatedAgent(deps, created).catch((cleanupError: unknown) => {
        deps.logger.error({ err: cleanupError }, "move: failed to remove new agent");
      });
    }
    await undoTranscriptCopy(deps, shared);
    throw toMoveError(error);
  }
}

export async function moveAgent(
  deps: MoveAgentDeps,
  input: MoveAgentInput,
): Promise<MoveAgentResult> {
  return withMoveLock(input.agentId, async () => {
    const record = await requireLiveSource(deps, input.agentId);
    const cwd = deps.agentManager.getAgent(input.agentId)?.cwd ?? record?.cwd;
    if (!cwd) throw new MoveAgentError("not_found", `Agent not found: ${input.agentId}`);
    const target = await requireTarget(deps, input.target.provider, cwd);
    // The readiness wait can take minutes; an archive during it still refuses the move.
    await requireLiveSource(deps, input.agentId);
    const source = await settle(deps, input.agentId);
    return moveForward(deps, source, target, {
      model: input.target.model,
      continueWork: input.continueWork,
    });
  });
}

type LabelsLookup = (agentId: string) => Promise<Record<string, string> | null | undefined>;

const MAX_MOVE_CHAIN = 50;

/**
 * The agents a moved agent can move back to, nearest first: its moved-from agent, that one's
 * moved-from agent, and so on. Stops at an agent with no record, at a cycle, or after
 * MAX_MOVE_CHAIN hops.
 */
export async function resolveMoveBackChain(
  agentId: string,
  getLabels: LabelsLookup,
): Promise<string[]> {
  const chain: string[] = [];
  const seen = new Set([agentId]);
  let labels = await getLabels(agentId);
  let nextId = labels ? getMovedFromAgentId(labels) : null;
  while (nextId && !seen.has(nextId) && chain.length < MAX_MOVE_CHAIN) {
    labels = await getLabels(nextId);
    if (!labels) break;
    chain.push(nextId);
    seen.add(nextId);
    nextId = getMovedFromAgentId(labels);
  }
  return chain;
}

function labelsLookup(deps: MoveAgentDeps): LabelsLookup {
  return async (agentId) =>
    deps.agentManager.getAgent(agentId)?.labels ?? (await deps.agentStorage.get(agentId))?.labels;
}

/** Picks the agent to return to, refusing anything outside the current agent's move chain. */
async function chooseMoveBackTarget(
  deps: MoveAgentDeps,
  input: MoveAgentBackInput,
): Promise<string> {
  const getLabels = labelsLookup(deps);
  const labels = await getLabels(input.agentId);
  if (!labels) throw new MoveAgentError("not_found", `Agent not found: ${input.agentId}`);
  const directId = getMovedFromAgentId(labels);
  if (!directId) {
    throw new MoveAgentError("not_found", "This agent was not moved from another agent");
  }
  const chain = await resolveMoveBackChain(input.agentId, getLabels);
  const chosenId = input.toAgentId ?? directId;
  if (!chain.includes(chosenId)) {
    throw new MoveAgentError(
      "not_found",
      input.toAgentId !== undefined
        ? `Agent ${input.toAgentId} is not an earlier agent in this move chain`
        : `Original agent not found: ${directId}`,
    );
  }
  return chosenId;
}

export async function moveAgentBack(
  deps: MoveAgentDeps,
  input: MoveAgentBackInput,
): Promise<MoveAgentResult> {
  return withMoveLock(input.agentId, async () => {
    // Validate everything before settle, which stops the current agent's turn.
    await requireLiveSource(deps, input.agentId);
    const originalId = await chooseMoveBackTarget(deps, input);
    return withMoveLock(originalId, async () => {
      const record = await deps.agentStorage.get(originalId);
      if (!record) {
        throw new MoveAgentError("not_found", `Original agent not found: ${originalId}`);
      }
      if (!record.archivedAt) throw activeAgainError(originalId);
      const target = await requireTarget(deps, record.provider, record.cwd);
      await requireLiveSource(deps, input.agentId);
      const current = await settle(deps, input.agentId);
      return moveBack(deps, current, record, target, input.continueWork);
    });
  });
}

/** Move back returns only to an archived agent; a live one has its own session going on. */
function activeAgainError(agentId: string): MoveAgentError {
  return new MoveAgentError(
    "busy",
    `Agent ${agentId} is active again; archive it before moving back to it`,
  );
}

async function moveBack(
  deps: MoveAgentDeps,
  current: ManagedAgent,
  record: StoredAgentRecord,
  target: MoveTargetProvider,
  continueWork: boolean,
): Promise<MoveAgentResult> {
  const originalId = record.id;
  const { chain, undelivered } = await readChain(deps, current);
  // Native only when both run the same Claude session: then the current transcript holds the
  // whole conversation, and the original resumes it after a reload from disk.
  const sessionId = current.persistence?.sessionId;
  const sameSession =
    familyOf(deps, current.provider) === "claude" &&
    target.info.family === "claude" &&
    !!sessionId &&
    sessionId === record.persistence?.sessionId;
  const shared = sameSession
    ? await shareClaudeTranscript(deps, {
        cwd: current.cwd,
        sessionId,
        fromEnv: launchEnv(deps, current.provider, current.launchEnv),
        toEnv: launchEnv(deps, record.provider, record.launchEnv),
      })
    : NOT_SHARED;
  const native = shared.shared;
  // In a chain the original points at the agent it moved to, not necessarily at `current`.
  const previousMovedTo = record.labels[MOVED_TO_AGENT_ID_LABEL] ?? null;
  const previousMoveState = {
    moveHistory: record.moveHistory ?? null,
    pendingMoveContext: record.pendingMoveContext ?? null,
  };

  const unarchived = await unarchiveAgentState(deps.agentStorage, deps.agentManager, originalId, {
    labels: { [MOVED_TO_AGENT_ID_LABEL]: null },
  }).catch(async (error: unknown) => {
    await undoTranscriptCopy(deps, shared);
    throw toMoveError(error);
  });
  // False means something unarchived it after the check above.
  if (!unarchived) {
    await undoTranscriptCopy(deps, shared);
    throw activeAgainError(originalId);
  }
  const progress = newFinishProgress();
  try {
    const original = await ensureAgentLoaded(originalId, {
      agentManager: deps.agentManager,
      agentStorage: deps.agentStorage,
      logger: deps.logger,
    });
    let pendingMoveContext: PendingMoveContext | null;
    if (native) {
      await deps.agentManager.reloadAgentSession(originalId, undefined, {
        rehydrateFromDisk: true,
      });
      // The reload wipes the timeline and only primes it again on request.
      await deps.agentManager.hydrateTimelineFromProvider(originalId, { broadcast: true });
      // The original now runs current's transcript, so its own older history is obsolete.
      pendingMoveContext = undelivered;
    } else {
      // The work since the session left the original, by every agent after it. An original that
      // never delivered its own inherited history gets every segment.
      pendingMoveContext = renderMoveHistory({
        chain,
        fromLabel: labelOf(deps, current.provider),
        agentTitle: await storedTitle(deps, current),
        cwd: current.cwd,
        afterAgentId: record.pendingMoveContext ? undefined : originalId,
      });
    }
    await deps.agentStorage.setMoveState(originalId, {
      moveHistory: { ...chain, sinceSeq: await latestSeq(deps, originalId) },
      pendingMoveContext,
    });
    // Returning to a login is trusting it again. Cleared before the continue turn, so a limit
    // that turn hits is recorded rather than erased.
    await deps.agentManager.setLimitReached(originalId, null);
    if (continueWork) await continueAgent(deps, originalId);
    await finish(deps, current, original, progress);
    return {
      agentId: originalId,
      strategy: native ? "native" : "handoff",
      fellBackFromNative: sameSession && !native,
    };
  } catch (error) {
    await undoFinish(deps, current, progress);
    await restoreOriginal(deps, {
      originalId,
      previousMovedTo,
      previousMoveState,
      previousLimitReached: record.limitReached ?? null,
    });
    await undoTranscriptCopy(deps, shared);
    throw toMoveError(error);
  }
}

/**
 * Puts the original back the way move back found it: its move state and limit, archived and
 * linked.
 */
async function restoreOriginal(
  deps: MoveAgentDeps,
  input: {
    originalId: string;
    previousMovedTo: string | null;
    previousMoveState: {
      moveHistory: MoveHistory | null;
      pendingMoveContext: PendingMoveContext | null;
    };
    previousLimitReached: ManagedAgent["limitReached"];
  },
): Promise<void> {
  const { originalId, previousMovedTo } = input;
  try {
    await deps.agentStorage.setMoveState(originalId, input.previousMoveState);
    if (deps.agentManager.getAgent(originalId)) {
      // The archive below persists the live agent, so its limit goes back first.
      await deps.agentManager.setLimitReached(originalId, input.previousLimitReached);
      await deps.agentManager.setLabels(originalId, { [MOVED_TO_AGENT_ID_LABEL]: previousMovedTo });
    } else if (previousMovedTo) {
      await deps.agentManager.updateAgentMetadata(originalId, {
        labels: { [MOVED_TO_AGENT_ID_LABEL]: previousMovedTo },
      });
    }
    await archiveAgentCommand(
      { agentManager: deps.agentManager, agentStorage: deps.agentStorage, logger: deps.logger },
      originalId,
    );
  } catch (error) {
    deps.logger.error({ err: error, agentId: originalId }, "move back: failed to restore original");
  }
}

export interface MoveResultPayload {
  ok: boolean;
  agentId: string | null;
  strategy: "native" | "handoff" | null;
  fellBackFromNative: boolean;
  error: string | null;
}

/** Runs a move and folds success or failure into the wire result shape. */
export async function runMove(action: () => Promise<MoveAgentResult>): Promise<MoveResultPayload> {
  try {
    const result = await action();
    return {
      ok: true,
      agentId: result.agentId,
      strategy: result.strategy,
      fellBackFromNative: result.fellBackFromNative,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      agentId: null,
      strategy: null,
      fellBackFromNative: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
