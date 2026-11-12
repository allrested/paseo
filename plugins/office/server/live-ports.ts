import { ACTIVITY_TAIL_LIMIT, startActivityPoller } from "./activity.js";
import type { HubPorts } from "./hub.js";
import { wakeTargetOf } from "./mention-queue.js";
import type { OfficeAgentPorts } from "./office.js";
import { openPaseoDirectory } from "./paseo-directory.js";
import type { PaseoHolder } from "./paseo-holder.js";
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
