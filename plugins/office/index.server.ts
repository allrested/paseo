import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createHub } from "./server/hub.js";
import { liveHubPorts } from "./server/live-ports.js";
import { createPaseoHolder } from "./server/paseo-holder.js";
import { nodeTimers } from "./server/timers.js";
import { officeStateSubscription } from "./shared/contracts.js";

// Runs inside the daemon process: every handler, hook and timer catches its own errors.
export default function contribute(server: PluginServerContext): () => Promise<void> {
  const log = (message: string) => console.error(message);
  const holder = createPaseoHolder();
  const hub = createHub(liveHubPorts(holder, nodeTimers, log));
  // The handler's promise settles when the subscriber leaves (or the directory cannot start),
  // and settling closes the subscription; see Hub.attach.
  server.handle(officeStateSubscription, (_input, context) => {
    holder.remember(context.paseo);
    return hub.attach(context);
  });
  return () => hub.stop();
}
