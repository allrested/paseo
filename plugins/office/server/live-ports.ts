import { stat } from "node:fs/promises";
import { ACTIVITY_TAIL_LIMIT, startActivityPoller } from "./activity.js";
import { lastAssistantText, type ChatServicePorts } from "./chat-service.js";
import type { Hub, HubPorts } from "./hub.js";
import type { JanitorPorts } from "./janitor.js";
import { wakeTargetOf } from "./mention-queue.js";
import { entryWritten, nodeNotesFs } from "./notes-files.js";
import type { NotesPorts } from "./notes-writer.js";
import type { OfficeAgentPorts } from "./office.js";
import { openPaseoDirectory } from "./paseo-directory.js";
import type { Paseo, PaseoHolder } from "./paseo-holder.js";
import type { SkillFolder } from "./paths.js";
import type { ScriptLogPorts } from "./script-log.js";
import { nodeSkillFiles, type SkillsPorts } from "./skills.js";
import type { Timers } from "./timers.js";

/** Hub ports on the daemon's own API. The holder is set before the first attach. */
export function liveHubPorts(
  holder: PaseoHolder,
  timers: Timers,
  log: (message: string) => void,
): HubPorts {
  return {
    openDirectory: (onChange, onEnd) => openPaseoDirectory(holder.require(), onChange, log, onEnd),
    startActivity: (running, onChange) => {
      const paseo = holder.require();
      const poller = startActivityPoller({
        running,
        tail: async (agentId) => {
          const page = await paseo.agents
            .ref(agentId)
            .timeline.refetch({ direction: "tail", limit: ACTIVITY_TAIL_LIMIT });
          return page.entries.map((entry) => entry.item);
        },
        timers,
        log,
        onChange,
      });
      return () => poller.stop();
    },
    timers,
    log,
    setAgentMetadata: (agentId, patch) => holder.require().agents.ref(agentId).setMetadata(patch),
  };
}

/** Wake ports on the daemon's own API; the holder is set by every hook and handler. */
export function liveAgentPorts(holder: PaseoHolder): OfficeAgentPorts {
  // Resolves null for an agent the daemon does not know; rejects only for an empty id or a start
  // of an id that several agents share.
  const refresh = (agentId: string) => holder.require().agents.ref(agentId).refresh();
  return {
    async status(agentId) {
      const result = await refresh(agentId);
      return wakeTargetOf(result === null ? null : result.agent);
    },
    async resolve(agentId) {
      const result = await refresh(agentId);
      // The daemon finds archived agents by id too; the queue would drop a post for one unsent.
      return result === null || wakeTargetOf(result.agent) === "gone" ? null : result.agent.id;
    },
    // A turn may start between the status read and the send. A prompt with a source agent joins
    // it (the daemon steers agent messages); one as from the user would cut it unless it steers.
    send: (agentId, prompt, source) =>
      holder
        .require()
        .agents.ref(agentId)
        .send(
          prompt,
          source === null ? { activeTurnBehavior: "steer" } : { sourceAgentId: source },
        ),
  };
}

/** The team chat's ports on the daemon's own API; the holder is set by every hook and handler. */
export function liveChatPorts(holder: PaseoHolder): Pick<ChatServicePorts, "send" | "lastAnswer"> {
  return {
    // Steers a running turn, as a wake from the user does, so a busy agent is not cut off.
    send: async (agentId, prompt) =>
      holder.require().agents.ref(agentId).send(prompt, { activeTurnBehavior: "steer" }),
    // The hook's own recipe (PluginHookEvents["agent.turn.after"]): the latest whole turn, kept
    // only when it is the turn that ended. A null turn id has no entries.
    async lastAnswer(agentId, turnId) {
      if (turnId === null) return null;
      const page = await holder
        .require()
        .agents.ref(agentId)
        .timeline.refetch({ direction: "tail", limit: 1, wholeTurns: true });
      const turn = page.entries.filter((entry) => entry.turnId === turnId);
      return lastAssistantText(turn.map((entry) => entry.item));
    },
  };
}

/** Janitor ports on the daemon's own API; the holder is set by the handler that uses them. */
export function liveJanitorPorts(holder: PaseoHolder): JanitorPorts {
  const ref = (agentId: string) => holder.require().agents.ref(agentId);
  return {
    async status(agentId) {
      const result = await ref(agentId).refresh();
      if (result === null) return null;
      // An archived agent keeps the status it was archived in; it takes no prompt.
      return result.agent.archivedAt ? "closed" : result.agent.status;
    },
    async commands(agentId) {
      const { commands, error } = await ref(agentId).commands();
      if (error !== null && commands.length === 0) throw new Error(error);
      return commands.map((command) => command.name);
    },
    send: (agentId, text) => ref(agentId).send(text),
  };
}

/** Skill ports on the daemon's own disk and API; the holder is set by the handler that uses them. */
export function liveSkillsPorts(
  holder: PaseoHolder,
  hub: Pick<Hub, "workspaceIds">,
  hostFolders: readonly SkillFolder[],
  now: () => number,
  log: (message: string) => void,
): SkillsPorts {
  return {
    files: nodeSkillFiles,
    hostFolders,
    workspaceIds: () => hub.workspaceIds(),
    async workspaceFolder(workspaceId) {
      const snapshot = await holder.require().workspaces.ref(workspaceId).refresh();
      return snapshot?.workspaceDirectory ?? snapshot?.projectRootPath ?? null;
    },
    now,
    log,
  };
}

/** Log ports on the daemon's own API; the holder is set by the handler that uses them. */
export function liveScriptLogPorts(
  holder: PaseoHolder,
  hub: Pick<Hub, "script">,
  now: () => number,
): ScriptLogPorts {
  return {
    script: (workspaceId, name) => hub.script(workspaceId, name),
    async tail(terminalId, rows) {
      // A negative start counts from the end (packages/server/src/terminal/terminal-capture.ts).
      const captured = await holder
        .require()
        .terminals.ref(terminalId)
        .capture({ start: -rows, stripAnsi: true });
      return { lines: captured.lines, total: captured.totalLines };
    },
    now,
  };
}

type AgentConfig = Parameters<Paseo["agents"]["create"]>[0]["config"];

// Claude's "Accept File Edits", which a provider extending Claude lists too. The owner's call:
// nobody watches the 8:00 writer, so it edits the notes without asking.
const ACCEPT_EDITS_MODE = "acceptEdits";

/**
 * The host's default provider, as the host can tell it. The app's new-agent form starts from the
 * provider the device chose last, which the host never sees; so this takes the first enabled,
 * ready provider in the daemon's order, with the model the form gives that provider: its default
 * (else its first selectable one). The mode is the provider's that accepts edits, else its
 * default: Codex's and OpenCode's default modes edit in the workspace without asking already.
 */
async function defaultAgentConfig(paseo: Paseo, cwd: string): Promise<AgentConfig> {
  const { entries } = await paseo.providers.waitForReady({ cwd });
  const entry = entries.find((candidate) => candidate.enabled && candidate.status === "ready");
  if (entry === undefined) throw new Error("No agent provider is ready on this host");
  const models = (entry.models ?? []).filter((model) => model.isSelectable !== false);
  const model = models.find((candidate) => candidate.isDefault) ?? models[0];
  if (model === undefined) {
    throw new Error(`The provider ${entry.label ?? entry.provider} offers no model`);
  }
  const acceptsEdits = (entry.modes ?? []).some((mode) => mode.id === ACCEPT_EDITS_MODE);
  const modeId = acceptsEdits ? ACCEPT_EDITS_MODE : entry.defaultModeId;
  return {
    provider: `${entry.provider}/${model.id}`,
    ...(modeId ? { modeId } : {}),
  };
}

/** The notes writer's ports on the daemon's own API and disk; the caller adds the rest. */
export function liveNotesPorts(
  holder: PaseoHolder,
  hub: Pick<Hub, "read">,
): Pick<NotesPorts, "snapshot" | "isDirectory" | "startAgent" | "archive" | "alive" | "hasEntry"> {
  return {
    snapshot: () => hub.read(),
    isDirectory: (path) =>
      stat(path).then(
        (found) => found.isDirectory(),
        () => false,
      ),
    async startAgent({ cwd, title, prompt }) {
      const paseo = holder.require();
      const config = await defaultAgentConfig(paseo, cwd);
      const workspace = await paseo.workspaces.open(cwd);
      const agent = await workspace.agents.create({ config, title, prompt });
      return agent.id;
    },
    async archive(agentId) {
      await holder.require().agents.ref(agentId).archive();
    },
    async alive(agentId) {
      const result = await holder.require().agents.ref(agentId).refresh();
      if (result === null || result.agent.archivedAt) return false;
      return result.agent.status === "running" || result.agent.status === "initializing";
    },
    hasEntry: ({ folder, ...day }) => entryWritten(folder, day, nodeNotesFs),
  };
}
