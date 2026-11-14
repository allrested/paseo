import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createAdbRunner, findOnPath } from "./server/adb.js";
import { createAndroidTools } from "./server/agent-tools.js";
import { createAndroidDevice, type AndroidDevice } from "./server/device.js";
import { createMaestroRunner, type MaestroRunner } from "./server/maestro.js";
import { createScreenRecorder } from "./server/recorder.js";
import { registerMaestro } from "./server/maestro-rpc.js";
import { errorMessage } from "./server/errors.js";
import { nodeClock, type Clock } from "./server/timers.js";
import { createAndroidStreams } from "./server/stream.js";
import { androidInputRpc, androidStateRpc, androidStreamSubscription } from "./shared/contracts.js";
import { androidHostSettings } from "./shared/settings.js";

export interface AndroidPluginDeps {
  /** The device, or null when the feature is off. */
  device: AndroidDevice | null;
  /** Runs the workspace's Maestro flows from the panel; null when maestro is not on PATH. */
  maestro?: MaestroRunner | null;
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
    recorder: createScreenRecorder({ device, now: () => new Date(clock.now()) }),
    workspacePath: (agent) => agent.cwd || null,
    now: () => new Date(clock.now()),
  });

  async function agentToolsOn(): Promise<boolean> {
    const state = await settings.read();
    return state.status !== "ready" || state.values.agentTools;
  }

  server.handle(androidStateRpc, async () => {
    try {
      return { available: true, agentTools: await agentToolsOn(), maestro: Boolean(deps.maestro) };
    } catch (error) {
      log(`[android] state failed: ${errorMessage(error)}`);
      return { available: true, agentTools: false, maestro: Boolean(deps.maestro) };
    }
  });

  const streams = createAndroidStreams({
    device,
    clock,
    newStreamId: () => randomUUID(),
    log,
  });
  // The handler settles when the viewer leaves or the stream ends, and settling closes the
  // subscription. It never rejects.
  server.handle(androidStreamSubscription, (_input, context) => streams.attach(context));
  server.handle(androidInputRpc, (input) => streams.input(input));
  if (deps.maestro) registerMaestro(server, deps.maestro, log);

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
    await streams.stop();
    await deps.maestro?.close();
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
  const maestroPath = device ? findOnPath("maestro", process.env) : null;
  const maestro =
    serial && maestroPath
      ? createMaestroRunner({
          command: maestroPath,
          serial,
          runsDir: join(
            process.env.PASEO_HOME || join(homedir(), ".paseo"),
            "android",
            "maestro-runs",
          ),
          env: process.env,
          clock: nodeClock,
          newId: () => `${Date.now()}-${randomUUID().slice(0, 8)}`,
          log: (message) => console.error(message),
        })
      : null;
  return createAndroidPlugin(server, {
    device,
    maestro,
    clock: nodeClock,
    log: (message) => console.error(message),
  });
}
