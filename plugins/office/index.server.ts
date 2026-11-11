import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readThreeAsset } from "./server/asset.js";
import { errorMessage } from "./server/errors.js";
import { createHub } from "./server/hub.js";
import { liveHubPorts } from "./server/live-ports.js";
import { createPaseoHolder } from "./server/paseo-holder.js";
import { nodeTimers } from "./server/timers.js";
import { assetRpc, officeStateSubscription } from "./shared/contracts.js";

/** What the daemon passes a built-in beside the server context (as in plugins/default-skills). */
interface BuiltinPluginInfo {
  directory: string;
}

// Runs inside the daemon process: every handler, hook and timer catches its own errors.
export default function contribute(
  server: PluginServerContext,
  builtin?: BuiltinPluginInfo,
): () => Promise<void> {
  const log = (message: string) => console.error(message);
  const vendorDirectory = builtin ? join(builtin.directory, "vendor") : null;
  const holder = createPaseoHolder();
  const hub = createHub(liveHubPorts(holder, nodeTimers, log));
  // The handler's promise settles when the subscriber leaves (or the directory cannot start),
  // and settling closes the subscription; see Hub.attach.
  server.handle(officeStateSubscription, (_input, context) => {
    holder.remember(context.paseo);
    return hub.attach(context);
  });
  server.handle(assetRpc, async () => {
    try {
      return await readThreeAsset(vendorDirectory);
    } catch (error) {
      log(`[office] unable to serve three.js: ${errorMessage(error)}`);
      throw error;
    }
  });
  return () => hub.stop();
}
