import { mkdir } from "node:fs/promises";
import { delimiter } from "node:path";
import { clearInterval, setInterval } from "node:timers";
import type {
  PluginSessionOpenRequest,
  PluginSettings,
  PluginSettingsState,
} from "@getpaseo/plugin/server";
import type { GateStatus } from "../shared/rpc.js";
import {
  gateSettings,
  gbToBytes,
  type GateSettings,
  type GateSettingsSchema,
} from "../shared/settings.js";
import { createGate, describeError, type GateConfig, type GateDeps } from "./gate.js";
import { readFreeMemory } from "./memory.js";
import type { GatePaths } from "./paths.js";
import { readShimRss } from "./procfs.js";
import {
  installShims,
  toShimConfig,
  writeShimConfig,
  type InterpreterResult,
} from "./shim/install.js";
import { listenGateSocket, type GateSocketServer } from "./socket-server.js";

type SettingsState = PluginSettingsState<GateSettingsSchema>;
type Phase = "starting" | "ready" | "unavailable";

export interface GatePluginOptions {
  paths: GatePaths;
  settings: PluginSettings<GateSettingsSchema>;
  interpreter: InterpreterResult;
  /** The daemon's PATH: the base for agents launched without a PATH of their own. */
  daemonPath: string | undefined;
  deps?: Partial<GateDeps>;
}

export interface GatePlugin {
  /** The agent.open.before handler: the request with the shim directory first on PATH. */
  openHook(request: PluginSessionOpenRequest): Promise<PluginSessionOpenRequest | undefined>;
  status(resolveTitle: (agentId: string) => Promise<string | null>): Promise<GateStatus>;
  stop(): Promise<void>;
}

/**
 * request.env is only the launch overlay, so PATH is usually absent and the agent inherits the
 * daemon's. The hook then sets PATH from the daemon's with the shim directory first. Returns
 * undefined, leaving the request alone, when there is no PATH to extend.
 */
export function withShimPath(
  request: PluginSessionOpenRequest,
  binDir: string,
  daemonPath: string | undefined,
): PluginSessionOpenRequest | undefined {
  const base = request.env.PATH ?? daemonPath;
  if (base === undefined) return undefined;
  const entries = base.split(delimiter).filter((entry) => entry !== binDir);
  // The daemon replaces env with the returned map, so the launch env is carried over.
  return { ...request, env: { ...request.env, PATH: [binDir, ...entries].join(delimiter) } };
}

function toGateConfig(values: GateSettings): GateConfig {
  return {
    enabled: values.enabled,
    slots: values.slots,
    reserveBytes: gbToBytes(values.reserveGb),
  };
}

async function titleOrNull(
  resolveTitle: (agentId: string) => Promise<string | null>,
  agentId: string,
): Promise<string | null> {
  try {
    return await resolveTitle(agentId);
  } catch {
    // An agent the daemon no longer knows, such as a shim run from a shell with a stale id.
    return null;
  }
}

function defaultGateDeps(): GateDeps {
  return {
    now: () => Date.now(),
    readFreeMemory: () => readFreeMemory(),
    readRss: (shim) => readShimRss(shim),
    startTimer(callback, ms) {
      const timer = setInterval(() => {
        // The plugin runs inside the daemon, which exits on an uncaught exception.
        try {
          callback();
        } catch (error) {
          console.error("heavy-command-gate: re-evaluating the queue failed", error);
        }
      }, ms);
      // Waiting shims must not keep the daemon, or a test process, alive.
      timer.unref();
      return () => clearInterval(timer);
    },
    log: (message) => console.error(message),
  };
}

/**
 * Starts the gate behind the returned handle. Order: refuse without a usable node; claim the socket
 * (a live owner means another daemon on this home, so stand down and write nothing); read the
 * settings unless a save arrived first; write gate.mjs, the links and config.json; then ready.
 * Only a ready gate puts the shims on an agent's PATH, so an agent never meets a missing config.
 */
export function startGatePlugin(options: GatePluginOptions): GatePlugin {
  const { paths, settings } = options;
  const deps: GateDeps = { ...defaultGateDeps(), ...options.deps };
  let values: GateSettings = gateSettings.schema.parse({});
  let phase: Phase = "starting";
  let unavailableReason: string | null = null;
  let server: GateSocketServer | null = null;
  let installed = false;
  let superseded = false;
  let stopped = false;
  let writing: Promise<void> = Promise.resolve();
  let stopping: Promise<void> | null = null;
  const gate = createGate({ config: toGateConfig(values), deps });

  function markUnavailable(reason: string): void {
    phase = "unavailable";
    unavailableReason = reason;
    deps.log(`heavy-command-gate: unavailable, agents get no shims: ${reason}`);
  }

  // Saves queue here, so config.json always ends with the newest settings.
  function queueConfigWrite(): void {
    const config = toShimConfig(values);
    writing = writing
      .then(() => writeShimConfig(paths.configPath, config))
      .catch((error: unknown) => {
        deps.log(`heavy-command-gate: writing ${paths.configPath} failed: ${describeError(error)}`);
      });
  }

  function applySettings(state: SettingsState): void {
    if (state.status === "invalid") {
      // The Limits screen shows the same error and offers Restore defaults.
      deps.log(
        `heavy-command-gate: settings are invalid, keeping the ones in force: ${state.error}`,
      );
      return;
    }
    values = state.values;
    gate.configure(toGateConfig(values));
    if (installed) queueConfigWrite();
  }

  // subscribe() never replays the stored value: read() supplies it unless a save arrived first.
  const unsubscribe = settings.subscribe((state) => {
    superseded = true;
    applySettings(state);
  });

  async function readStoredSettings(): Promise<void> {
    try {
      const state = await settings.read();
      if (!superseded) applySettings(state);
    } catch (error) {
      deps.log(`heavy-command-gate: reading settings failed: ${describeError(error)}`);
    }
  }

  async function start(): Promise<void> {
    const { interpreter } = options;
    if (!interpreter.ok) {
      markUnavailable(interpreter.reason);
      return;
    }
    try {
      await mkdir(paths.home, { recursive: true, mode: 0o700 });
      server = await listenGateSocket({ socketPath: paths.socketPath, gate });
      if (server === null) {
        markUnavailable(`another Paseo daemon owns ${paths.socketPath}`);
        return;
      }
      await readStoredSettings();
      if (stopped) return;
      await installShims({ paths, interpreter: interpreter.path });
      const first = values;
      await writeShimConfig(paths.configPath, toShimConfig(first));
      installed = true;
      // A save that arrived during the first write queues behind it.
      if (values !== first) queueConfigWrite();
      phase = "ready";
    } catch (error) {
      markUnavailable(`cannot start: ${describeError(error)}`);
    }
  }

  const ready = start();

  function gateState(): GateStatus["state"] {
    if (phase === "unavailable") return "unavailable";
    return values.enabled ? "on" : "off";
  }

  async function shutdown(): Promise<void> {
    stopped = true;
    unsubscribe();
    await ready;
    // Stopping the gate first makes the leaves that closing the connections triggers no-ops, so
    // nothing is admitted on the way out. Waiting shims see the close and run ungated.
    gate.stop();
    await server?.close();
    await writing;
  }

  return {
    async openHook(request) {
      await ready;
      if (phase !== "ready" || stopped) return undefined;
      return withShimPath(request, paths.binDir, options.daemonPath);
    },
    async status(resolveTitle) {
      const snapshot = gate.snapshot();
      // One lookup per agent per request, however many commands it has.
      const titles = new Map<string, Promise<string | null>>();
      function titleOf(agentId: string | null): Promise<string | null> {
        if (agentId === null) return Promise.resolve(null);
        const known = titles.get(agentId);
        if (known !== undefined) return known;
        const title = titleOrNull(resolveTitle, agentId);
        titles.set(agentId, title);
        return title;
      }
      const running = await Promise.all(
        snapshot.running.map(async (command) => ({
          ...command,
          agentTitle: await titleOf(command.agentId),
        })),
      );
      const waiting = await Promise.all(
        snapshot.waiting.map(async (command) => ({
          ...command,
          agentTitle: await titleOf(command.agentId),
        })),
      );
      return {
        state: gateState(),
        error: phase === "unavailable" ? unavailableReason : null,
        slots: values.slots,
        reserveBytes: gbToBytes(values.reserveGb),
        freeBytes: snapshot.freeBytes,
        running,
        waiting,
      };
    },
    stop() {
      stopping ??= shutdown();
      return stopping;
    },
  };
}
