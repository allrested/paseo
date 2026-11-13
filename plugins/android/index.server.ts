import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createAdbRunner, findOnPath } from "./server/adb.js";
import { createAndroidTools } from "./server/agent-tools.js";
import { createAndroidDevice, type AndroidDevice } from "./server/device.js";
import { errorMessage } from "./server/errors.js";
import { nodeClock, type Clock } from "./server/timers.js";
import { androidStateRpc } from "./shared/contracts.js";
import { androidHostSettings } from "./shared/settings.js";

export interface AndroidPluginDeps {
  /** The device, or null when the feature is off. */
  device: AndroidDevice | null;
  clock: Clock;
  log(message: string): void;
}

// Runs inside the daemon process: every handler and hook catches its own errors.
export function createAndroidPlugin(
  server: PluginServerContext,
  deps: AndroidPluginDeps,
): () => Promise<void> {
  const { device, clock, log } = deps;
  if (device === null) return async () => undefined;

  const settings = server.registerSettings(androidHostSettings);
  const tools = createAndroidTools({
    device,
    workspacePath: (agent) => agent.cwd || null,
    now: () => new Date(clock.now()),
  });

  async function agentToolsOn(): Promise<boolean> {
    const state = await settings.read();
    return state.status !== "ready" || state.values.agentTools;
  }

  server.handle(androidStateRpc, async () => {
    try {
      return { available: true, agentTools: await agentToolsOn() };
    } catch (error) {
      log(`[android] state failed: ${errorMessage(error)}`);
      return { available: true, agentTools: false };
    }
  });

  const removeHook = server.addHook("agent.open.before", async ({ request }) => {
    try {
      if (request.purpose !== "interactive") return undefined;
      // Read here and not kept, so a change holds from the next session on.
      if (!(await agentToolsOn())) return undefined;
      return { ...request, tools: [...request.tools, ...tools] };
    } catch (error) {
      log(`[android] agent.open.before failed: ${errorMessage(error)}`);
      return undefined;
    }
  });

  return async () => {
    removeHook();
  };
}

export default function contribute(server: PluginServerContext): () => Promise<void> {
  // Built-ins run in the daemon process, so process.env is the daemon's env.
  const serial = process.env.PASEO_ANDROID_ADB;
  const adbPath = serial ? findOnPath("adb", process.env) : null;
  if (serial && !adbPath)
    console.error("[android] PASEO_ANDROID_ADB is set but adb is not on PATH");
  const device =
    serial && adbPath ? createAndroidDevice({ serial, adb: createAdbRunner({ adbPath }) }) : null;
  return createAndroidPlugin(server, {
    device,
    clock: nodeClock,
    log: (message) => console.error(message),
  });
}
