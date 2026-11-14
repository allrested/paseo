import { randomUUID } from "node:crypto";
import { access, appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MOVED_FROM_AGENT_ID_LABEL,
  MOVED_FROM_AGENT_IDS_LABEL,
  MOVED_TO_AGENT_ID_LABEL,
  PARENT_AGENT_ID_LABEL,
} from "@getpaseo/protocol/agent-labels";
import {
  createDaemonTestContext,
  type DaemonTestContext,
} from "../../test-utils/daemon-test-context.js";
import {
  createTestAgentClient,
  createTestAgentClients,
} from "../../test-utils/fake-agent-client.js";
import { sendPromptToAgent } from "../agent-prompt.js";
import type { AgentStorage, StoredAgentRecord } from "../agent-storage.js";
import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
import { claudeProjectDir } from "../providers/claude/project-dir.js";
import { ScheduleStore } from "../../schedule/store.js";
import { moveAgent, moveAgentBack, type MoveAgentDeps } from "./move-agent.js";

const SOURCE_PROMPT = "Reply with MOVE_SOURCE_OK. Do not use tools.";
const LIMIT_PROMPT = "Emit a turn failure: Claude AI usage limit reached|1762300800";

function itemTypes(rows: readonly AgentTimelineRow[]): string[] {
  return rows.map((row) => row.item.type);
}

function providersOf(records: readonly StoredAgentRecord[]): string[] {
  return records.map((record) => record.provider);
}

function segmentIds(record: StoredAgentRecord | null | undefined): string[] | undefined {
  return record?.moveHistory?.segments.map((segment) => segment.agentId);
}

/** Archive state and labels of each agent, to show a refused move changed nothing. */
async function archiveStates(storage: AgentStorage, ids: readonly string[]) {
  const states: { archived: boolean; labels: Record<string, string> | undefined }[] = [];
  for (const id of ids) {
    const record = await storage.get(id);
    states.push({ archived: Boolean(record?.archivedAt), labels: record?.labels });
  }
  return states;
}

/** Archives the agent once, inside the next readiness wait of a move's target check. */
function archiveDuringTargetCheck(deps: MoveAgentDeps, agentId: string): void {
  const { agentManager, providerSnapshotManager } = deps;
  const getProvider = providerSnapshotManager.getProvider.bind(providerSnapshotManager);
  vi.spyOn(providerSnapshotManager, "getProvider").mockImplementationOnce(async (args) => {
    await agentManager.archiveAgent(agentId);
    return getProvider(args);
  });
}

describe("moveAgent", () => {
  let ctx: DaemonTestContext | null = null;
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "move-agent-"));
  });

  afterEach(async () => {
    await ctx?.cleanup();
    ctx = null;
    await rm(cwd, { recursive: true, force: true });
  });

  function requireCtx(): DaemonTestContext {
    if (!ctx) throw new Error("test daemon not started");
    return ctx;
  }

  function deps(): MoveAgentDeps {
    const { daemon, logger } = requireCtx().daemon;
    return {
      agentManager: daemon.agentManager,
      agentStorage: daemon.agentStorage,
      providerSnapshotManager: daemon.providerSnapshotManager,
      logger,
    };
  }

  async function createRanClaudeAgent(env?: Record<string, string>): Promise<string> {
    const current = requireCtx();
    const source = await current.client.createAgent({
      config: { provider: "claude", cwd, modeId: "bypassPermissions" },
      ...(env ? { env } : {}),
    });
    // A client message id makes the prompt a user message in the timeline, as a typed one is.
    await current.daemon.daemon.agentManager.runAgent(source.id, SOURCE_PROMPT, {
      clientMessageId: randomUUID(),
    });
    return source.id;
  }

  /** Runs one turn with a plain string prompt, after any turn already running has finished. */
  async function runTurn(agentId: string, prompt: string): Promise<void> {
    const { agentManager } = requireCtx().daemon.daemon;
    await agentManager.waitForAgentEvent(agentId);
    await agentManager.runAgent(agentId, prompt, { clientMessageId: randomUUID() });
  }

  /** Fails a turn with a usage-limit error and waits for the agent to record the limit. */
  async function hitLimit(agentId: string): Promise<void> {
    const { agentManager } = requireCtx().daemon.daemon;
    await agentManager.runAgent(agentId, LIMIT_PROMPT).catch(() => {});
    await vi.waitFor(
      () => expect(agentManager.getAgent(agentId)?.limitReached?.message).toContain("usage limit"),
      { timeout: 10_000 },
    );
  }

  async function waitForRunning(agentId: string): Promise<void> {
    const { agentManager } = requireCtx().daemon.daemon;
    await vi.waitFor(() => expect(agentManager.getAgent(agentId)?.lifecycle).toBe("running"), {
      timeout: 10_000,
    });
  }

  async function lastSeq(agentId: string): Promise<number | undefined> {
    return (await requireCtx().daemon.daemon.agentManager.getTimelineRows(agentId)).at(-1)?.seq;
  }

  /** A yearly schedule aimed at `agentId`; it never comes due during a test. */
  async function createHeartbeat(agentId: string): Promise<string> {
    const created = await requireCtx().client.scheduleCreate({
      name: "watch-the-build",
      prompt: "check the build",
      cadence: { type: "cron", expression: "0 0 1 1 *" },
      target: { type: "agent", agentId },
      runOnCreate: false,
    });
    if (!created.schedule) throw new Error(created.error ?? "schedule not created");
    return created.schedule.id;
  }

  async function scheduleState(id: string): Promise<{ agentId: string | null; status: string }> {
    const { paseoHome, logger } = requireCtx().daemon;
    const stored = (await new ScheduleStore(join(paseoHome, "schedules"), logger).list()).find(
      (schedule) => schedule.id === id,
    );
    if (!stored) throw new Error(`schedule ${id} is gone`);
    return {
      agentId: stored.target.type === "agent" ? stored.target.agentId : null,
      status: stored.status,
    };
  }

  /** Moves a Claude agent with a home transcript to "claude-work", which shares the session. */
  async function moveNatively(): Promise<{ sourceId: string; movedId: string; home: string }> {
    const sourceId = await createRanClaudeAgent({ CLAUDE_CONFIG_DIR: join(cwd, ".claude") });
    const sessionId =
      requireCtx().daemon.daemon.agentManager.getAgent(sourceId)?.persistence?.sessionId;
    const sourceDir = await claudeProjectDir(cwd, { configDir: join(cwd, ".claude") });
    await mkdir(sourceDir, { recursive: true });
    const home = join(sourceDir, `${sessionId}.jsonl`);
    await writeFile(home, '{"type":"user"}\n');
    const moved = await moveAgent(deps(), {
      agentId: sourceId,
      target: { provider: "claude-work" },
      continueWork: false,
    });
    expect(moved.strategy).toBe("native");
    return { sourceId, movedId: moved.agentId, home };
  }

  /** The "claude-work" copy of a natively moved agent's transcript. */
  async function workTranscript(agentId: string): Promise<string> {
    const sessionId =
      requireCtx().daemon.daemon.agentManager.getAgent(agentId)?.persistence?.sessionId;
    const dir = await claudeProjectDir(cwd, { configDir: join(cwd, ".claude-work") });
    return join(dir, `${sessionId}.jsonl`);
  }

  describe("across providers", () => {
    beforeEach(async () => {
      ctx = await createDaemonTestContext();
    });

    it("hands a Claude agent to Codex in the same workspace and archives the original", async () => {
      const sourceId = await createRanClaudeAgent();

      const result = await moveAgent(deps(), {
        agentId: sourceId,
        target: { provider: "codex" },
        continueWork: false,
      });

      expect(result).toMatchObject({ strategy: "handoff", fellBackFromNative: false });
      const storage = requireCtx().daemon.daemon.agentStorage;
      const moved = await storage.get(result.agentId);
      const original = await storage.get(sourceId);
      expect(moved?.provider).toBe("codex");
      expect(moved?.workspaceId).toBe(original?.workspaceId);
      expect(moved?.labels[MOVED_FROM_AGENT_ID_LABEL]).toBe(sourceId);
      expect(moved?.pendingMoveContext?.text).toContain("Moved from");
      expect(moved?.pendingMoveContext?.text).toContain("[Assistant] Hello world");
      expect(original?.labels[MOVED_TO_AGENT_ID_LABEL]).toBe(result.agentId);
      expect(original?.archivedAt).toBeTruthy();
    });

    it("starts the moved agent immediately when continueWork is on", async () => {
      const sourceId = await createRanClaudeAgent();

      const result = await moveAgent(deps(), {
        agentId: sourceId,
        target: { provider: "codex" },
        continueWork: true,
      });

      const daemon = requireCtx().daemon.daemon;
      const moved = await daemon.agentStorage.get(result.agentId);
      expect(moved?.pendingMoveContext ?? null).toBeNull();
      const rows = await daemon.agentManager.getTimelineRows(result.agentId);
      expect(itemTypes(rows)).toContain("user_message");
    });

    it("moves back to the original agent and archives the moved one", async () => {
      const sourceId = await createRanClaudeAgent();
      const moved = await moveAgent(deps(), {
        agentId: sourceId,
        target: { provider: "codex" },
        continueWork: false,
      });

      const back = await moveAgentBack(deps(), { agentId: moved.agentId, continueWork: false });

      expect(back).toMatchObject({ agentId: sourceId, strategy: "handoff" });
      const storage = requireCtx().daemon.daemon.agentStorage;
      const original = await storage.get(sourceId);
      const left = await storage.get(moved.agentId);
      expect(original?.archivedAt ?? null).toBeNull();
      expect(original?.labels[MOVED_TO_AGENT_ID_LABEL]).toBeUndefined();
      expect(original?.pendingMoveContext?.text).toContain("Moved from");
      expect(left?.archivedAt).toBeTruthy();
      expect(left?.labels[MOVED_TO_AGENT_ID_LABEL]).toBe(sourceId);
    });

    it("clears the limit on the agent it moves back to", async () => {
      const aId = await createRanClaudeAgent();
      await hitLimit(aId);
      const b = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "codex" },
        continueWork: false,
      });

      await moveAgentBack(deps(), { agentId: b.agentId, continueWork: false });

      const daemon = requireCtx().daemon.daemon;
      expect(daemon.agentManager.getAgent(aId)?.limitReached ?? null).toBeNull();
      await daemon.agentManager.flush();
      expect((await daemon.agentStorage.get(aId))?.limitReached ?? null).toBeNull();
    });

    it("hands sub-agents to the moved agent instead of archiving them with the original", async () => {
      const sourceId = await createRanClaudeAgent();
      const child = await requireCtx().client.createAgent({
        config: { provider: "claude", cwd, modeId: "bypassPermissions" },
        labels: { [PARENT_AGENT_ID_LABEL]: sourceId },
      });

      const result = await moveAgent(deps(), {
        agentId: sourceId,
        target: { provider: "codex" },
        continueWork: false,
      });

      const storage = requireCtx().daemon.daemon.agentStorage;
      const childRecord = await storage.get(child.id);
      expect(childRecord?.labels[PARENT_AGENT_ID_LABEL]).toBe(result.agentId);
      expect(childRecord?.archivedAt ?? null).toBeNull();
      expect((await storage.get(sourceId))?.archivedAt).toBeTruthy();
    });

    it("refuses a second move of the same agent while the first is running", async () => {
      const sourceId = await createRanClaudeAgent();
      const target = { provider: "codex" };

      // The lock is taken synchronously when moveAgent is called, so the second call always
      // finds the first one in flight.
      const [first, second] = await Promise.allSettled([
        moveAgent(deps(), { agentId: sourceId, target, continueWork: false }),
        moveAgent(deps(), { agentId: sourceId, target, continueWork: false }),
      ]);

      expect(first.status).toBe("fulfilled");
      expect(second).toMatchObject({ status: "rejected", reason: { code: "busy" } });
      const original = await requireCtx().daemon.daemon.agentStorage.get(sourceId);
      expect(original?.archivedAt).toBeTruthy();
    });

    it("carries the first agent's work and task through two handoffs", async () => {
      const aId = await createRanClaudeAgent();
      const b = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "codex" },
        continueWork: true,
      });
      await runTurn(b.agentId, "say 'timeline test'");

      const c = await moveAgent(deps(), {
        agentId: b.agentId,
        target: { provider: "claude" },
        continueWork: false,
      });

      const record = await requireCtx().daemon.daemon.agentStorage.get(c.agentId);
      const text = record?.pendingMoveContext?.text;
      expect(text).toContain("Original task: Reply with MOVE_SOURCE_OK");
      expect(text).toContain("[Assistant] Hello world");
      expect(text).toContain("[Assistant] timeline test");
      expect(text).not.toContain("Original task: Continue");
      expect(segmentIds(record)).toEqual([aId, b.agentId]);
    });

    it("keeps a history that was never delivered when moved again", async () => {
      const aId = await createRanClaudeAgent();
      const b = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "codex" },
        continueWork: false,
      });

      const c = await moveAgent(deps(), {
        agentId: b.agentId,
        target: { provider: "claude" },
        continueWork: false,
      });

      const record = await requireCtx().daemon.daemon.agentStorage.get(c.agentId);
      expect(record?.pendingMoveContext?.text).toContain("[Assistant] Hello world");
      expect(record?.pendingMoveContext?.text).not.toContain("No chat history to display");
      expect(segmentIds(record)).toEqual([aId, b.agentId]);
      expect(record?.moveHistory?.segments[1]?.entries).toEqual([]);
    });

    it("moves back two hops to the first agent in the chain", async () => {
      const aId = await createRanClaudeAgent();
      const b = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "codex" },
        continueWork: false,
      });
      await runTurn(b.agentId, "say 'timeline test'");
      const c = await moveAgent(deps(), {
        agentId: b.agentId,
        target: { provider: "claude" },
        continueWork: false,
      });
      await runTurn(c.agentId, "say 'state saved'");

      const back = await moveAgentBack(deps(), {
        agentId: c.agentId,
        toAgentId: aId,
        continueWork: false,
      });

      expect(back).toMatchObject({ agentId: aId, strategy: "handoff" });
      const storage = requireCtx().daemon.daemon.agentStorage;
      const a = await storage.get(aId);
      const left = await storage.get(c.agentId);
      const middle = await storage.get(b.agentId);
      expect(a?.archivedAt ?? null).toBeNull();
      expect(a?.labels[MOVED_TO_AGENT_ID_LABEL]).toBeUndefined();
      expect(a?.pendingMoveContext?.text).toContain("Moved from");
      expect(a?.pendingMoveContext?.text).toContain("[Assistant] timeline test");
      expect(a?.pendingMoveContext?.text).toContain("[Assistant] state saved");
      expect(a?.pendingMoveContext?.text).not.toContain("[Assistant] Hello world");
      expect(a?.labels[MOVED_FROM_AGENT_ID_LABEL]).toBe(c.agentId);
      expect(segmentIds(a)).toEqual([aId, b.agentId, c.agentId]);
      expect(a?.moveHistory?.sinceSeq).toBe(await lastSeq(aId));
      expect(left?.archivedAt).toBeTruthy();
      expect(left?.labels[MOVED_TO_AGENT_ID_LABEL]).toBe(aId);
      expect(middle?.archivedAt).toBeTruthy();
      expect(middle?.labels[MOVED_TO_AGENT_ID_LABEL]).toBe(c.agentId);
    });

    it("links the returned-to agent so it can move back again", async () => {
      const aId = await createRanClaudeAgent();
      const b = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "codex" },
        continueWork: true,
      });
      await runTurn(b.agentId, "say 'timeline test'");
      await moveAgentBack(deps(), { agentId: b.agentId, continueWork: false });
      await runTurn(aId, "Respond with exactly: A2_DONE");

      const again = await moveAgentBack(deps(), { agentId: aId, continueWork: false });

      expect(again.agentId).toBe(b.agentId);
      const storage = requireCtx().daemon.daemon.agentStorage;
      const moved = await storage.get(b.agentId);
      const a = await storage.get(aId);
      expect(moved?.pendingMoveContext?.text).toContain("A2_DONE");
      expect(moved?.pendingMoveContext?.text).not.toContain("[Assistant] Hello world");
      expect(moved?.pendingMoveContext?.text).not.toContain("timeline test");
      expect(moved?.labels[MOVED_FROM_AGENT_ID_LABEL]).toBe(aId);
      expect(a?.labels[MOVED_TO_AGENT_ID_LABEL]).toBe(b.agentId);
      expect(a?.archivedAt).toBeTruthy();
    });

    it("refuses a move back to an agent outside the chain and changes nothing", async () => {
      const aId = await createRanClaudeAgent();
      const outsiderId = await createRanClaudeAgent();
      const b = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "codex" },
        continueWork: false,
      });

      await expect(
        moveAgentBack(deps(), { agentId: b.agentId, toAgentId: outsiderId, continueWork: false }),
      ).rejects.toMatchObject({ code: "not_found", message: expect.stringContaining(outsiderId) });
      // An empty id is a bad target, not "no target": it must not fall back to the direct original.
      await expect(
        moveAgentBack(deps(), { agentId: b.agentId, toAgentId: "", continueWork: false }),
      ).rejects.toMatchObject({ code: "not_found", message: expect.stringContaining("chain") });

      const storage = requireCtx().daemon.daemon.agentStorage;
      const a = await storage.get(aId);
      const moved = await storage.get(b.agentId);
      const outsider = await storage.get(outsiderId);
      expect(a?.archivedAt).toBeTruthy();
      expect(a?.labels[MOVED_TO_AGENT_ID_LABEL]).toBe(b.agentId);
      expect(moved?.archivedAt ?? null).toBeNull();
      expect(moved?.labels[MOVED_TO_AGENT_ID_LABEL]).toBeUndefined();
      expect(outsider?.archivedAt ?? null).toBeNull();
    });

    it("refuses to move or move back an archived agent", async () => {
      const aId = await createRanClaudeAgent();
      const b = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "codex" },
        continueWork: false,
      });
      const c = await moveAgent(deps(), {
        agentId: b.agentId,
        target: { provider: "claude" },
        continueWork: false,
      });
      const storage = requireCtx().daemon.daemon.agentStorage;
      const ids = [aId, b.agentId, c.agentId];
      const before = await archiveStates(storage, ids);
      const count = (await storage.listAll()).length;

      await expect(
        moveAgent(deps(), { agentId: aId, target: { provider: "codex" }, continueWork: false }),
      ).rejects.toMatchObject({ code: "not_found", message: expect.stringContaining(b.agentId) });
      await expect(
        moveAgentBack(deps(), { agentId: b.agentId, continueWork: false }),
      ).rejects.toMatchObject({ code: "not_found", message: expect.stringContaining(c.agentId) });

      expect(await archiveStates(storage, ids)).toEqual(before);
      expect((await storage.listAll()).length).toBe(count);
    });

    it("refuses an agent archived while the target check waits", async () => {
      const aId = await createRanClaudeAgent();
      const b = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "codex" },
        continueWork: false,
      });
      const sourceId = await createRanClaudeAgent();
      const { agentStorage } = deps();
      const count = (await agentStorage.listAll()).length;

      archiveDuringTargetCheck(deps(), sourceId);
      await expect(
        moveAgent(deps(), { agentId: sourceId, target: { provider: "codex" }, continueWork: true }),
      ).rejects.toMatchObject({ code: "not_found" });
      archiveDuringTargetCheck(deps(), b.agentId);
      await expect(
        moveAgentBack(deps(), { agentId: b.agentId, continueWork: true }),
      ).rejects.toMatchObject({ code: "not_found" });

      expect((await agentStorage.listAll()).length).toBe(count);
      expect((await agentStorage.get(aId))?.labels[MOVED_TO_AGENT_ID_LABEL]).toBe(b.agentId);
      expect((await agentStorage.get(b.agentId))?.labels[MOVED_TO_AGENT_ID_LABEL]).toBeUndefined();
    });

    it("refuses a move back to an agent that is active again", async () => {
      const aId = await createRanClaudeAgent();
      const b = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "codex" },
        continueWork: false,
      });
      const { agentManager, agentStorage, logger } = deps();
      await sendPromptToAgent({ agentManager, agentStorage, logger, agentId: aId, prompt: "hi" });
      await agentManager.waitForAgentEvent(aId);

      await expect(
        moveAgentBack(deps(), { agentId: b.agentId, continueWork: false }),
      ).rejects.toMatchObject({ code: "busy" });

      const a = await agentStorage.get(aId);
      const moved = await agentStorage.get(b.agentId);
      expect(a?.archivedAt ?? null).toBeNull();
      expect(moved?.archivedAt ?? null).toBeNull();
      expect(a?.labels[MOVED_TO_AGENT_ID_LABEL]).toBe(b.agentId);
      expect(moved?.labels[MOVED_TO_AGENT_ID_LABEL]).toBeUndefined();
    });

    it("lets only one of two live successors move back to the same original", async () => {
      const aId = await createRanClaudeAgent();
      const b = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "codex" },
        continueWork: false,
      });
      const { agentManager, agentStorage, logger } = deps();
      await sendPromptToAgent({ agentManager, agentStorage, logger, agentId: aId, prompt: "hi" });
      await agentManager.waitForAgentEvent(aId);
      const c = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "codex" },
        continueWork: false,
      });

      const [first, second] = await Promise.allSettled([
        moveAgentBack(deps(), { agentId: b.agentId, continueWork: false }),
        moveAgentBack(deps(), { agentId: c.agentId, continueWork: false }),
      ]);

      expect([first.status, second.status].sort()).toEqual(["fulfilled", "rejected"]);
      expect(first.status === "rejected" ? first : second).toMatchObject({
        status: "rejected",
        reason: { code: "busy" },
      });
    });

    it("refuses an unknown target without touching the original", async () => {
      const sourceId = await createRanClaudeAgent();

      await expect(
        moveAgent(deps(), { agentId: sourceId, target: { provider: "nope" }, continueWork: false }),
      ).rejects.toMatchObject({ code: "unavailable" });

      const original = await requireCtx().daemon.daemon.agentStorage.get(sourceId);
      expect(original?.archivedAt ?? null).toBeNull();
    });
  });

  describe("when the target provider is unavailable", () => {
    let interrupts = 0;
    let releaseHold: () => void = () => {};

    beforeEach(async () => {
      interrupts = 0;
      const hold = new Promise<void>((resolve) => {
        releaseHold = resolve;
      });
      ctx = await createDaemonTestContext({
        agentClients: {
          ...createTestAgentClients(),
          claude: createTestAgentClient("claude", {
            beforeTurnComplete: (prompt) =>
              typeof prompt === "string" && prompt.includes("HOLD") ? hold : Promise.resolve(),
            onInterrupt: () => {
              interrupts += 1;
            },
          }),
          codex: createTestAgentClient("codex", { available: false }),
        },
        providerOverrides: { opencode: { enabled: false } },
      });
    });

    // Runs before the outer afterEach, so a held turn never blocks the daemon cleanup.
    afterEach(() => releaseHold());

    it("refuses a target whose CLI is missing without stopping the running turn", async () => {
      const sourceId = await createRanClaudeAgent();
      const { agentManager, agentStorage } = requireCtx().daemon.daemon;
      const run = agentManager.runAgent(sourceId, "HOLD");
      await waitForRunning(sourceId);

      await expect(
        moveAgent(deps(), {
          agentId: sourceId,
          target: { provider: "codex" },
          continueWork: false,
        }),
      ).rejects.toMatchObject({ code: "unavailable" });

      expect(interrupts).toBe(0);
      expect(agentManager.getAgent(sourceId)?.lifecycle).toBe("running");
      expect((await agentStorage.get(sourceId))?.archivedAt ?? null).toBeNull();
      expect(providersOf(await agentStorage.listAll())).not.toContain("codex");
      releaseHold();
      await run;
    });

    it("refuses a disabled target", async () => {
      const sourceId = await createRanClaudeAgent();

      await expect(
        moveAgent(deps(), {
          agentId: sourceId,
          target: { provider: "opencode" },
          continueWork: false,
        }),
      ).rejects.toMatchObject({ code: "unavailable" });

      const original = await requireCtx().daemon.daemon.agentStorage.get(sourceId);
      expect(original?.archivedAt ?? null).toBeNull();
    });
  });

  describe("the agents a session was moved from", () => {
    beforeEach(async () => {
      ctx = await createDaemonTestContext();
    });

    async function chainOf(agentId: string): Promise<string | undefined> {
      const record = await requireCtx().daemon.daemon.agentStorage.get(agentId);
      return record?.labels[MOVED_FROM_AGENT_IDS_LABEL];
    }

    it("are all named on the live agent after two moves, nearest first", async () => {
      const aId = await createRanClaudeAgent();
      const b = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "codex" },
        continueWork: false,
      });
      expect(await chainOf(b.agentId)).toBe(aId);

      const c = await moveAgent(deps(), {
        agentId: b.agentId,
        target: { provider: "opencode" },
        continueWork: false,
      });

      expect(await chainOf(c.agentId)).toBe(`${b.agentId},${aId}`);
    });

    it("name the agents left behind, and never the agent itself, after a move back", async () => {
      const aId = await createRanClaudeAgent();
      const b = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "codex" },
        continueWork: false,
      });

      await moveAgentBack(deps(), { agentId: b.agentId, continueWork: false });

      expect(await chainOf(aId)).toBe(b.agentId);
    });

    it("keep the earliest agent after a move back to a middle agent and a move on from it", async () => {
      const aId = await createRanClaudeAgent();
      const b = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "codex" },
        continueWork: false,
      });
      const c = await moveAgent(deps(), {
        agentId: b.agentId,
        target: { provider: "opencode" },
        continueWork: false,
      });
      await moveAgentBack(deps(), { agentId: c.agentId, continueWork: false });
      expect((await chainOf(b.agentId))?.split(",").sort()).toEqual([aId, c.agentId].sort());

      const d = await moveAgent(deps(), {
        agentId: b.agentId,
        target: { provider: "opencode" },
        continueWork: false,
      });

      const chain = (await chainOf(d.agentId))?.split(",") ?? [];
      expect(chain[0]).toBe(b.agentId);
      expect([...chain].sort()).toEqual([aId, b.agentId, c.agentId].sort());
    });

    it("are put back on a middle agent when a move back to it fails", async () => {
      const aId = await createRanClaudeAgent();
      const b = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "codex" },
        continueWork: false,
      });
      const c = await moveAgent(deps(), {
        agentId: b.agentId,
        target: { provider: "opencode" },
        continueWork: false,
      });
      const real = deps();
      const agentManager = new Proxy(real.agentManager, {
        get(target, property) {
          if (property === "archiveAgent") {
            return async (agentId: string) => {
              if (agentId === c.agentId) throw new Error("archive failed");
              return target.archiveAgent(agentId);
            };
          }
          const value: unknown = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      await expect(
        moveAgentBack({ ...real, agentManager }, { agentId: c.agentId, continueWork: false }),
      ).rejects.toMatchObject({ code: "failed" });

      expect(await chainOf(b.agentId)).toBe(aId);
      expect(await chainOf(c.agentId)).toBe(`${b.agentId},${aId}`);
    });

    it("are put back as they were when a move back fails", async () => {
      const aId = await createRanClaudeAgent();
      const b = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "codex" },
        continueWork: false,
      });
      const real = deps();
      const agentManager = new Proxy(real.agentManager, {
        get(target, property) {
          if (property === "archiveAgent") {
            return async (agentId: string) => {
              if (agentId === b.agentId) throw new Error("archive failed");
              return target.archiveAgent(agentId);
            };
          }
          const value: unknown = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      await expect(
        moveAgentBack({ ...real, agentManager }, { agentId: b.agentId, continueWork: false }),
      ).rejects.toMatchObject({ code: "failed" });

      expect(await chainOf(aId)).toBeUndefined();
      expect(await chainOf(b.agentId)).toBe(aId);
    });
  });

  describe("when the target is not signed in", () => {
    let interrupts = 0;
    let releaseHold: () => void = () => {};

    beforeEach(async () => {
      interrupts = 0;
      const hold = new Promise<void>((resolve) => {
        releaseHold = resolve;
      });
      ctx = await createDaemonTestContext({
        agentClients: {
          ...createTestAgentClients(),
          claude: createTestAgentClient("claude", {
            beforeTurnComplete: (prompt) =>
              typeof prompt === "string" && prompt.includes("HOLD") ? hold : Promise.resolve(),
            onInterrupt: () => {
              interrupts += 1;
            },
          }),
        },
      });
    });

    // Runs before the outer afterEach, so a held turn never blocks the daemon cleanup.
    afterEach(() => releaseHold());

    /** The CLI of `provider` says nobody is signed in; every other login is unknown. */
    function signOut(provider: string): void {
      const { agentManager } = requireCtx().daemon.daemon;
      const carry = agentManager.moveCarry;
      if (!carry) throw new Error("test daemon has no move carry");
      agentManager.setMoveCarry({
        ...carry,
        targetLogin: async (providerId) => (providerId === provider ? "signed_out" : "unknown"),
      });
    }

    it("refuses the move without stopping the running turn", async () => {
      const sourceId = await createRanClaudeAgent();
      const { agentManager, agentStorage } = requireCtx().daemon.daemon;
      signOut("codex");
      const run = agentManager.runAgent(sourceId, "HOLD");
      await waitForRunning(sourceId);

      await expect(
        moveAgent(deps(), {
          agentId: sourceId,
          target: { provider: "codex" },
          continueWork: false,
        }),
      ).rejects.toMatchObject({ code: "unavailable", message: "Codex is not signed in" });

      expect(interrupts).toBe(0);
      expect(agentManager.getAgent(sourceId)?.lifecycle).toBe("running");
      expect((await agentStorage.get(sourceId))?.archivedAt ?? null).toBeNull();
      expect(providersOf(await agentStorage.listAll())).not.toContain("codex");
      releaseHold();
      await run;
    });

    it("refuses a move back to an account that signed out since", async () => {
      const sourceId = await createRanClaudeAgent();
      const moved = await moveAgent(deps(), {
        agentId: sourceId,
        target: { provider: "codex" },
        continueWork: false,
      });
      signOut("claude");

      await expect(
        moveAgentBack(deps(), { agentId: moved.agentId, continueWork: false }),
      ).rejects.toMatchObject({ code: "unavailable", message: "Claude is not signed in" });

      const { agentStorage } = requireCtx().daemon.daemon;
      expect((await agentStorage.get(moved.agentId))?.archivedAt ?? null).toBeNull();
      expect((await agentStorage.get(sourceId))?.archivedAt).toBeTruthy();
    });

    it("moves when the login is unknown", async () => {
      const sourceId = await createRanClaudeAgent();
      signOut("opencode");

      const moved = await moveAgent(deps(), {
        agentId: sourceId,
        target: { provider: "codex" },
        continueWork: false,
      });

      expect(moved.strategy).toBe("handoff");
    });
  });

  describe("when the new agent fails to start", () => {
    // Counts turns the new Codex agent tried to start: proves it existed before the rollback.
    let codexTurnStarts = 0;

    beforeEach(async () => {
      codexTurnStarts = 0;
      ctx = await createDaemonTestContext({
        agentClients: {
          ...createTestAgentClients(),
          codex: createTestAgentClient("codex", {
            onStartTurn: () => {
              codexTurnStarts += 1;
              throw new Error("codex refused the turn");
            },
          }),
        },
      });
    });

    it("removes the new agent and leaves the original active", async () => {
      const sourceId = await createRanClaudeAgent();

      await expect(
        moveAgent(deps(), { agentId: sourceId, target: { provider: "codex" }, continueWork: true }),
      ).rejects.toMatchObject({ code: "failed" });

      expect(codexTurnStarts).toBe(1);
      const storage = requireCtx().daemon.daemon.agentStorage;
      const original = await storage.get(sourceId);
      expect(original?.archivedAt ?? null).toBeNull();
      expect(original?.labels[MOVED_TO_AGENT_ID_LABEL]).toBeUndefined();
      const records = await storage.listAll();
      expect(providersOf(records)).not.toContain("codex");
    });
  });

  describe("when finish fails after re-parenting children", () => {
    beforeEach(async () => {
      ctx = await createDaemonTestContext();
    });

    it("leaves the original active with its children and labels restored", async () => {
      const sourceId = await createRanClaudeAgent();
      const child = await requireCtx().client.createAgent({
        config: { provider: "claude", cwd, modeId: "bypassPermissions" },
        labels: { [PARENT_AGENT_ID_LABEL]: sourceId },
      });
      const real = deps();
      // Linking the original (the step after re-parenting) fails; clearing the link still works.
      const agentManager = new Proxy(real.agentManager, {
        get(target, property) {
          if (property === "setLabels") {
            return async (agentId: string, labels: Record<string, string | null>) => {
              if (labels[MOVED_TO_AGENT_ID_LABEL]) throw new Error("link failed");
              return target.setLabels(agentId, labels);
            };
          }
          const value: unknown = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      await expect(
        moveAgent(
          { ...real, agentManager },
          { agentId: sourceId, target: { provider: "codex" }, continueWork: false },
        ),
      ).rejects.toMatchObject({ code: "failed", message: "link failed" });

      const storage = requireCtx().daemon.daemon.agentStorage;
      const original = await storage.get(sourceId);
      expect(original?.archivedAt ?? null).toBeNull();
      expect(original?.labels[MOVED_TO_AGENT_ID_LABEL]).toBeUndefined();
      expect((await storage.get(child.id))?.labels[PARENT_AGENT_ID_LABEL]).toBe(sourceId);
      expect(providersOf(await storage.listAll())).not.toContain("codex");
    });

    it("a move back whose link fails restores the target's moved-from", async () => {
      const aId = await createRanClaudeAgent();
      const b = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "codex" },
        continueWork: false,
      });
      const real = deps();
      // Linking the agent being left fails after the target got its moved-from link.
      const agentManager = new Proxy(real.agentManager, {
        get(target, property) {
          if (property === "setLabels") {
            return async (agentId: string, labels: Record<string, string | null>) => {
              if (agentId === b.agentId && labels[MOVED_TO_AGENT_ID_LABEL]) {
                throw new Error("link failed");
              }
              return target.setLabels(agentId, labels);
            };
          }
          const value: unknown = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      await expect(
        moveAgentBack({ ...real, agentManager }, { agentId: b.agentId, continueWork: false }),
      ).rejects.toMatchObject({ code: "failed", message: "link failed" });

      const storage = requireCtx().daemon.daemon.agentStorage;
      const a = await storage.get(aId);
      expect(a?.archivedAt).toBeTruthy();
      expect(a?.labels[MOVED_TO_AGENT_ID_LABEL]).toBe(b.agentId);
      expect(a?.labels[MOVED_FROM_AGENT_ID_LABEL]).toBeUndefined();
      expect(a?.moveHistory ?? null).toBeNull();
      expect(a?.pendingMoveContext ?? null).toBeNull();
      expect((await storage.get(b.agentId))?.archivedAt ?? null).toBeNull();
    });
  });

  describe("what was aimed at the agent being left", () => {
    /** Turn prompts that are finish notifications, with the agent that received each. */
    let notices: Array<{ cwd: string; prompt: string }> = [];

    async function waitForOneNotice(): Promise<void> {
      await vi.waitFor(() => expect(notices).toHaveLength(1), { timeout: 10_000 });
    }

    beforeEach(async () => {
      notices = [];
      ctx = await createDaemonTestContext({
        agentClients: createTestAgentClients({
          onStartTurn: (prompt, config) => {
            const text = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
            if (text.includes('kind="agent-notification"')) {
              notices.push({ cwd: config.cwd, prompt: text });
            }
          },
        }),
      });
    });

    it("a heartbeat is aimed at the successor and stays active", async () => {
      const sourceId = await createRanClaudeAgent();
      const heartbeat = await createHeartbeat(sourceId);

      const moved = await moveAgent(deps(), {
        agentId: sourceId,
        target: { provider: "codex" },
        continueWork: false,
      });

      expect(await scheduleState(heartbeat)).toEqual({ agentId: moved.agentId, status: "active" });
    });

    it("move back returns the heartbeat to the original", async () => {
      const sourceId = await createRanClaudeAgent();
      const heartbeat = await createHeartbeat(sourceId);
      const moved = await moveAgent(deps(), {
        agentId: sourceId,
        target: { provider: "codex" },
        continueWork: false,
      });

      await moveAgentBack(deps(), { agentId: moved.agentId, continueWork: false });

      expect(await scheduleState(heartbeat)).toEqual({ agentId: sourceId, status: "active" });
    });

    it("a move that fails while archiving leaves the heartbeat with the original", async () => {
      const sourceId = await createRanClaudeAgent();
      const heartbeat = await createHeartbeat(sourceId);
      const real = deps();
      // The archive is the step after the schedules are re-pointed.
      const agentManager = new Proxy(real.agentManager, {
        get(target, property) {
          if (property === "archiveAgent") {
            return async (agentId: string) => {
              if (agentId === sourceId) throw new Error("archive failed");
              return target.archiveAgent(agentId);
            };
          }
          const value: unknown = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      await expect(
        moveAgent(
          { ...real, agentManager },
          { agentId: sourceId, target: { provider: "codex" }, continueWork: false },
        ),
      ).rejects.toMatchObject({ code: "failed" });

      expect(await scheduleState(heartbeat)).toEqual({ agentId: sourceId, status: "active" });
    });

    it("a sub-agent moved with continue on reports its successor's finish to the parent, once", async () => {
      const parentId = await createRanClaudeAgent();
      const child = await requireCtx().client.createAgent({
        config: { provider: "claude", cwd, modeId: "bypassPermissions" },
        labels: { [PARENT_AGENT_ID_LABEL]: parentId },
      });
      await runTurn(child.id, SOURCE_PROMPT);

      const moved = await moveAgent(deps(), {
        agentId: child.id,
        target: { provider: "codex" },
        continueWork: true,
      });
      await requireCtx().daemon.daemon.agentManager.waitForAgentEvent(moved.agentId);

      await waitForOneNotice();
      // Long enough for a second notification to arrive if one were sent.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(notices).toHaveLength(1);
      expect(notices[0]!.prompt).toContain(`Agent ${moved.agentId} (`);
      expect(notices[0]!.prompt).not.toContain(`Agent ${child.id} (`);
    });

    it("a failed move that had sent the continue turn tells the parent nothing", async () => {
      const parentId = await createRanClaudeAgent();
      const child = await requireCtx().client.createAgent({
        config: { provider: "claude", cwd, modeId: "bypassPermissions" },
        labels: { [PARENT_AGENT_ID_LABEL]: parentId },
      });
      await runTurn(child.id, SOURCE_PROMPT);
      const heartbeat = await createHeartbeat(child.id);
      const real = deps();
      const agentManager = new Proxy(real.agentManager, {
        get(target, property) {
          if (property === "archiveAgent") {
            return async (agentId: string) => {
              if (agentId === child.id) throw new Error("archive failed");
              return target.archiveAgent(agentId);
            };
          }
          const value: unknown = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      await expect(
        moveAgent(
          { ...real, agentManager },
          { agentId: child.id, target: { provider: "codex" }, continueWork: true },
        ),
      ).rejects.toMatchObject({ code: "failed" });
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(notices).toHaveLength(0);
      expect(await scheduleState(heartbeat)).toEqual({ agentId: child.id, status: "active" });
    });

    it("asks for a notice for whoever waited on the agent being left, only when it continues", async () => {
      const sourceId = await createRanClaudeAgent();
      const { agentManager } = requireCtx().daemon.daemon;
      const carry = agentManager.moveCarry;
      if (!carry) throw new Error("test daemon has no move carry");
      const asked: Array<{ agentId: string; fromAgentId: string }> = [];
      agentManager.setMoveCarry({
        ...carry,
        notifyWatchersOnFinish: async (input) => {
          asked.push({ agentId: input.agentId, fromAgentId: input.fromAgentId });
          return undefined;
        },
      });

      const moved = await moveAgent(deps(), {
        agentId: sourceId,
        target: { provider: "codex" },
        continueWork: true,
      });
      await agentManager.waitForAgentEvent(moved.agentId);
      await moveAgentBack(deps(), { agentId: moved.agentId, continueWork: false });

      expect(asked).toEqual([{ agentId: moved.agentId, fromAgentId: sourceId }]);
    });

    it("moves and continues when the notice cannot be registered", async () => {
      const sourceId = await createRanClaudeAgent();
      const { agentManager } = requireCtx().daemon.daemon;
      const carry = agentManager.moveCarry;
      if (!carry) throw new Error("test daemon has no move carry");
      agentManager.setMoveCarry({
        ...carry,
        notifyWatchersOnFinish: async () => {
          throw new Error("store unavailable");
        },
      });

      const moved = await moveAgent(deps(), {
        agentId: sourceId,
        target: { provider: "codex" },
        continueWork: true,
      });

      expect(moved.strategy).toBe("handoff");
      const { agentStorage } = requireCtx().daemon.daemon;
      expect((await agentStorage.get(sourceId))?.archivedAt).toBeTruthy();
    });

    it("with continue off the parent is told nothing", async () => {
      const parentId = await createRanClaudeAgent();
      const child = await requireCtx().client.createAgent({
        config: { provider: "claude", cwd, modeId: "bypassPermissions" },
        labels: { [PARENT_AGENT_ID_LABEL]: parentId },
      });
      await runTurn(child.id, SOURCE_PROMPT);

      await moveAgent(deps(), {
        agentId: child.id,
        target: { provider: "codex" },
        continueWork: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(notices).toHaveLength(0);
    });
  });

  describe("when a chained move back fails", () => {
    let failClaudeTurns = false;

    beforeEach(async () => {
      failClaudeTurns = false;
      ctx = await createDaemonTestContext({
        agentClients: {
          ...createTestAgentClients(),
          claude: createTestAgentClient("claude", {
            onStartTurn: () => {
              if (failClaudeTurns) throw new Error("claude refused the turn");
            },
          }),
        },
      });
    });

    it("re-links the original to the agent it moved to, not to the agent being left", async () => {
      const aId = await createRanClaudeAgent();
      await hitLimit(aId);
      const b = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "codex" },
        continueWork: false,
      });
      const c = await moveAgent(deps(), {
        agentId: b.agentId,
        target: { provider: "claude" },
        continueWork: false,
      });
      // A (claude) is unarchived first, then fails when asked to continue.
      failClaudeTurns = true;

      await expect(
        moveAgentBack(deps(), { agentId: c.agentId, toAgentId: aId, continueWork: true }),
      ).rejects.toMatchObject({ code: "failed" });

      const storage = requireCtx().daemon.daemon.agentStorage;
      const a = await storage.get(aId);
      const middle = await storage.get(b.agentId);
      const current = await storage.get(c.agentId);
      expect(a?.archivedAt).toBeTruthy();
      expect(a?.labels[MOVED_TO_AGENT_ID_LABEL]).toBe(b.agentId);
      expect(a?.labels[MOVED_FROM_AGENT_ID_LABEL]).toBeUndefined();
      expect(a?.moveHistory ?? null).toBeNull();
      expect(a?.pendingMoveContext ?? null).toBeNull();
      expect(current?.archivedAt ?? null).toBeNull();
      expect(current?.labels[MOVED_TO_AGENT_ID_LABEL]).toBeUndefined();
      expect(middle?.archivedAt).toBeTruthy();
      expect(middle?.labels[MOVED_TO_AGENT_ID_LABEL]).toBe(c.agentId);
      expect(a?.limitReached?.message).toContain("usage limit");
    });
  });

  describe("when a native move back fails", () => {
    let failClaudeTurns = false;

    beforeEach(async () => {
      failClaudeTurns = false;
      ctx = await createDaemonTestContext({
        agentClients: {
          ...createTestAgentClients(),
          claude: createTestAgentClient("claude", {
            onStartTurn: () => {
              if (failClaudeTurns) throw new Error("claude refused the turn");
            },
          }),
          "claude-work": createTestAgentClient("claude-work"),
        },
        providerOverrides: {
          "claude-work": {
            extends: "claude",
            label: "Claude (work)",
            env: { CLAUDE_CONFIG_DIR: join(cwd, ".claude-work") },
          },
        },
      });
    });

    it("removes the transcript copy it created and keeps the moved agent", async () => {
      const { sourceId, movedId, home } = await moveNatively();
      await rm(home);
      failClaudeTurns = true;

      await expect(
        moveAgentBack(deps(), { agentId: movedId, continueWork: true }),
      ).rejects.toMatchObject({ code: "failed" });

      await expect(access(home)).rejects.toMatchObject({ code: "ENOENT" });
      const storage = requireCtx().daemon.daemon.agentStorage;
      expect((await storage.get(movedId))?.archivedAt ?? null).toBeNull();
      const original = await storage.get(sourceId);
      expect(original?.archivedAt).toBeTruthy();
      expect(original?.labels[MOVED_TO_AGENT_ID_LABEL]).toBe(movedId);
    });

    it("keeps a transcript that existed before the copy", async () => {
      const { movedId, home } = await moveNatively();
      const before = await readFile(home, "utf8");
      await writeFile(await workTranscript(movedId), `${before}{"type":"later"}\n`);
      failClaudeTurns = true;

      await expect(
        moveAgentBack(deps(), { agentId: movedId, continueWork: true }),
      ).rejects.toMatchObject({ code: "failed" });

      expect(await readFile(home, "utf8")).toBe(before);
    });
  });

  describe("between two logins of the same CLI", () => {
    // The fake client gives every session a random persistence.sessionId, so the native branch
    // (copy the transcript, resume the same session under the target provider) is the one that
    // runs here. "claude-work" gets its own fake client because a derived provider would otherwise
    // build a real Claude client.
    beforeEach(async () => {
      ctx = await createDaemonTestContext({
        agentClients: {
          ...createTestAgentClients(),
          "claude-work": createTestAgentClient("claude-work"),
          "claude-alt": createTestAgentClient("claude-alt"),
          "codex-work": createTestAgentClient("codex-work"),
        },
        providerOverrides: {
          "claude-work": {
            extends: "claude",
            label: "Claude (work)",
            env: { CLAUDE_CONFIG_DIR: join(cwd, ".claude-work") },
          },
          "claude-alt": {
            extends: "claude",
            label: "Claude (alt)",
            env: { CLAUDE_CONFIG_DIR: join(cwd, ".claude-alt") },
          },
          "codex-work": { extends: "codex", label: "Codex (work)" },
        },
      });
    });

    it("copies the transcript and resumes the same session under the target login", async () => {
      const sourceId = await createRanClaudeAgent({ CLAUDE_CONFIG_DIR: join(cwd, ".claude") });
      const daemon = requireCtx().daemon.daemon;
      const sessionId = daemon.agentManager.getAgent(sourceId)?.persistence?.sessionId;
      expect(sessionId).toBeTruthy();
      const sourceDir = await claudeProjectDir(cwd, { configDir: join(cwd, ".claude") });
      await mkdir(sourceDir, { recursive: true });
      await writeFile(join(sourceDir, `${sessionId}.jsonl`), '{"type":"user"}\n');

      const result = await moveAgent(deps(), {
        agentId: sourceId,
        target: { provider: "claude-work" },
        continueWork: false,
      });

      expect(result).toMatchObject({ strategy: "native", fellBackFromNative: false });
      const targetDir = await claudeProjectDir(cwd, { configDir: join(cwd, ".claude-work") });
      await access(join(targetDir, `${sessionId}.jsonl`));
      const moved = daemon.agentManager.getAgent(result.agentId);
      expect(moved?.provider).toBe("claude-work");
      expect(moved?.persistence?.sessionId).toBe(sessionId);
      const original = await daemon.agentStorage.get(sourceId);
      expect(original?.archivedAt).toBeTruthy();
      expect(original?.labels[MOVED_TO_AGENT_ID_LABEL]).toBe(result.agentId);
      expect(moved?.labels[MOVED_FROM_AGENT_ID_LABEL]).toBe(sourceId);
    });

    it("moves a natively moved agent back by copying the newer transcript home", async () => {
      const sourceId = await createRanClaudeAgent({ CLAUDE_CONFIG_DIR: join(cwd, ".claude") });
      const daemon = requireCtx().daemon.daemon;
      const sessionId = daemon.agentManager.getAgent(sourceId)?.persistence?.sessionId;
      const sourceDir = await claudeProjectDir(cwd, { configDir: join(cwd, ".claude") });
      await mkdir(sourceDir, { recursive: true });
      await writeFile(join(sourceDir, `${sessionId}.jsonl`), '{"type":"user"}\n');
      const moved = await moveAgent(deps(), {
        agentId: sourceId,
        target: { provider: "claude-work" },
        continueWork: false,
      });
      const targetDir = await claudeProjectDir(cwd, { configDir: join(cwd, ".claude-work") });
      await writeFile(join(targetDir, `${sessionId}.jsonl`), '{"type":"user"}\n{"type":"later"}\n');

      const back = await moveAgentBack(deps(), { agentId: moved.agentId, continueWork: false });

      expect(back).toMatchObject({ agentId: sourceId, strategy: "native" });
      expect(await readFile(join(sourceDir, `${sessionId}.jsonl`), "utf8")).toContain("later");
      const original = await daemon.agentStorage.get(sourceId);
      const left = await daemon.agentStorage.get(moved.agentId);
      expect(original?.archivedAt ?? null).toBeNull();
      expect(original?.pendingMoveContext ?? null).toBeNull();
      expect(left?.archivedAt).toBeTruthy();
      expect(left?.labels[MOVED_TO_AGENT_ID_LABEL]).toBe(sourceId);
      const rows = await daemon.agentManager.getTimelineRows(sourceId);
      expect(rows.length).toBeGreaterThan(0);
      expect(original?.moveHistory?.sinceSeq).toBe(rows.at(-1)?.seq);
    });

    it("falls back to a handoff when the original's transcript diverged", async () => {
      const { sourceId, movedId, home } = await moveNatively();
      await appendFile(home, '{"type":"other"}\n');
      const before = await readFile(home, "utf8");

      const back = await moveAgentBack(deps(), { agentId: movedId, continueWork: false });

      expect(back).toMatchObject({
        agentId: sourceId,
        strategy: "handoff",
        fellBackFromNative: true,
      });
      expect(await readFile(home, "utf8")).toBe(before);
      const original = await requireCtx().daemon.daemon.agentStorage.get(sourceId);
      expect(original?.pendingMoveContext?.text).toContain("Moved from");
    });

    it("carries an undelivered history across a native move", async () => {
      const aId = await createRanClaudeAgent({ CLAUDE_CONFIG_DIR: join(cwd, ".claude") });
      const b = await moveAgent(deps(), {
        agentId: aId,
        target: { provider: "claude-work" },
        continueWork: false,
      });
      expect(b.strategy).toBe("handoff");
      const storage = requireCtx().daemon.daemon.agentStorage;
      const pending = (await storage.get(b.agentId))?.pendingMoveContext;
      expect(pending?.text).toContain("Moved from");
      const transcript = await workTranscript(b.agentId);
      await mkdir(join(transcript, ".."), { recursive: true });
      await writeFile(transcript, '{"type":"user"}\n');

      const c = await moveAgent(deps(), {
        agentId: b.agentId,
        target: { provider: "claude-alt" },
        continueWork: false,
      });

      expect(c.strategy).toBe("native");
      const record = await storage.get(c.agentId);
      expect(record?.pendingMoveContext?.text).toBe(pending?.text);
      expect(segmentIds(record)).toEqual([aId, b.agentId]);
    });

    it("falls back to a history handoff when the transcript is missing", async () => {
      const sourceId = await createRanClaudeAgent({ CLAUDE_CONFIG_DIR: join(cwd, ".claude") });

      const result = await moveAgent(deps(), {
        agentId: sourceId,
        target: { provider: "claude-work" },
        continueWork: false,
      });

      expect(result).toMatchObject({ strategy: "handoff", fellBackFromNative: true });
      const daemon = requireCtx().daemon.daemon;
      const moved = await daemon.agentStorage.get(result.agentId);
      expect(moved?.provider).toBe("claude-work");
      expect(moved?.pendingMoveContext?.text).toContain("Moved from");
      expect(daemon.agentManager.getAgent(result.agentId)?.currentModeId).toBe("bypassPermissions");

      // The two agents run different sessions, so a move back has nothing to share.
      const back = await moveAgentBack(deps(), { agentId: result.agentId, continueWork: false });
      expect(back).toEqual({ agentId: sourceId, strategy: "handoff", fellBackFromNative: false });
    });

    it("reports no native fallback between two logins of a CLI with no native move", async () => {
      const current = requireCtx();
      const source = await current.client.createAgent({
        config: { provider: "codex", cwd, modeId: "full-access" },
      });
      await current.daemon.daemon.agentManager.runAgent(source.id, SOURCE_PROMPT, {
        clientMessageId: randomUUID(),
      });

      const result = await moveAgent(deps(), {
        agentId: source.id,
        target: { provider: "codex-work" },
        continueWork: false,
      });

      expect(result).toMatchObject({ strategy: "handoff", fellBackFromNative: false });
      expect(current.daemon.daemon.agentManager.getAgent(result.agentId)?.currentModeId).toBe(
        "full-access",
      );
    });

    it("carries the agent's options to a handoff between two logins of the same CLI", async () => {
      const current = requireCtx();
      const source = await current.client.createAgent({
        config: { provider: "codex", cwd, providerOptions: { test_feature: true } },
      });
      await current.daemon.daemon.agentManager.runAgent(source.id, SOURCE_PROMPT, {
        clientMessageId: randomUUID(),
      });

      const result = await moveAgent(deps(), {
        agentId: source.id,
        target: { provider: "codex-work" },
        continueWork: false,
      });

      expect(result).toMatchObject({ strategy: "handoff", fellBackFromNative: false });
      expect(
        current.daemon.daemon.agentManager.getAgent(result.agentId)?.config.providerOptions,
      ).toEqual({ test_feature: true });
    });
  });

  describe("after a native hop", () => {
    // The successor's hydrate replays A_REPLAYED, which stands for the turns of the agent it
    // took the session from.
    beforeEach(async () => {
      ctx = await createDaemonTestContext({
        agentClients: {
          ...createTestAgentClients(),
          "claude-work": createTestAgentClient("claude-work", {
            historyEvents: [
              {
                type: "timeline",
                provider: "claude-work",
                item: { type: "assistant_message", text: "A_REPLAYED" },
              },
            ],
          }),
        },
        providerOverrides: {
          "claude-work": {
            extends: "claude",
            label: "Claude (work)",
            env: { CLAUDE_CONFIG_DIR: join(cwd, ".claude-work") },
          },
        },
      });
    });

    it("a later handoff does not resend the turns the native hop replayed", async () => {
      const { movedId } = await moveNatively();
      await runTurn(movedId, "say 'timeline test'");

      const c = await moveAgent(deps(), {
        agentId: movedId,
        target: { provider: "codex" },
        continueWork: false,
      });

      const text = (await requireCtx().daemon.daemon.agentStorage.get(c.agentId))
        ?.pendingMoveContext?.text;
      expect(text).toContain("[Assistant] Hello world");
      expect(text).toContain("[Assistant] timeline test");
      expect(text).not.toContain("A_REPLAYED");
    });

    it("a move back whose transcript copy fails sends only the moved agent's own turns", async () => {
      const { sourceId, movedId } = await moveNatively();
      await runTurn(movedId, "say 'timeline test'");
      await rm(await workTranscript(movedId));

      const back = await moveAgentBack(deps(), { agentId: movedId, continueWork: false });

      expect(back).toEqual({ agentId: sourceId, strategy: "handoff", fellBackFromNative: true });
      const text = (await requireCtx().daemon.daemon.agentStorage.get(sourceId))?.pendingMoveContext
        ?.text;
      expect(text).toContain("[Assistant] timeline test");
      expect(text).not.toContain("A_REPLAYED");
      expect(text).not.toContain("[Assistant] Hello world");
    });
  });
});
