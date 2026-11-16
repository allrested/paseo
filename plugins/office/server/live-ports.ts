import { ACTIVITY_TAIL_LIMIT, startActivityPoller } from "./activity.js";
import type { Hub, HubPorts } from "./hub.js";
import type { JanitorPorts } from "./janitor.js";
import { wakeTargetOf } from "./mention-queue.js";
import type { OfficeAgentPorts } from "./office.js";
import { openPaseoDirectory } from "./paseo-directory.js";
import type { PaseoHolder } from "./paseo-holder.js";
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
