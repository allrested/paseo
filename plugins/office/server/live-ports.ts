import { ACTIVITY_TAIL_LIMIT, startActivityPoller } from "./activity.js";
import type { HubPorts } from "./hub.js";
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
    openDirectory: (onChange) => openPaseoDirectory(holder.require(), onChange, log),
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
