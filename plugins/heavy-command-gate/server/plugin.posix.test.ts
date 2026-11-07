import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PluginSessionOpenRequest,
  PluginSettings,
  PluginSettingsState,
} from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GateStatus } from "../shared/rpc.js";
import { gateSettings, type GateSettingsSchema } from "../shared/settings.js";
import { createGate, type GateDeps } from "./gate.js";
import { gatePaths, type GatePaths } from "./paths.js";
import { startGatePlugin, withShimPath, type GatePlugin } from "./plugin.js";
import type { ShimConfig, ShimHello } from "./protocol.js";
import { SHIMMED_COMMANDS, toShimConfig, type InterpreterResult } from "./shim/install.js";
import { listenGateSocket } from "./socket-server.js";

type SettingsState = PluginSettingsState<GateSettingsSchema>;
type SettingsListener = (state: SettingsState) => void | Promise<void>;

interface FakeSettings extends PluginSettings<GateSettingsSchema> {
  resolveRead(state: SettingsState): void;
  emit(state: SettingsState): void;
}

const GIB = 1024 ** 3;
const DAEMON_PATH = "/usr/local/bin:/usr/bin:/bin";
const NODE: InterpreterResult = { ok: true, path: process.execPath };

let root = "";
let paths: GatePaths = gatePaths("");
const logs: string[] = [];
const plugins: GatePlugin[] = [];
const sockets: Socket[] = [];

function ready(values: object, revision = "r1"): SettingsState {
  return { status: "ready", revision, values: gateSettings.schema.parse(values) };
}

// read() resolves when the test says so; subscribe() never replays, as the SDK's does not.
function createFakeSettings(): FakeSettings {
  const listeners = new Set<SettingsListener>();
  let resolveStored: (state: SettingsState) => void = () => undefined;
  const stored = new Promise<SettingsState>((resolve) => {
    resolveStored = resolve;
  });
  return {
    read: () => stored,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    resolveRead(state) {
      resolveStored(state);
    },
    emit(state) {
      for (const listener of listeners) void listener(state);
    },
  };
}

function start(settings: FakeSettings, interpreter: InterpreterResult = NODE): GatePlugin {
  const plugin = startGatePlugin({
    paths,
    settings,
    interpreter,
    daemonPath: DAEMON_PATH,
    deps: {
      readFreeMemory: () => 8 * GIB,
      readRss: () => null,
      log(message) {
        logs.push(message);
      },
    },
  });
  plugins.push(plugin);
  return plugin;
}

function openRequest(env: Record<string, string> = {}): PluginSessionOpenRequest {
  return {
    agentId: "agent-1",
    workspaceId: null,
    provider: "claude",
    cwd: "/tmp",
    reason: "create",
    purpose: "interactive",
    title: null,
    labels: {},
    tools: [],
    env,
    mcpServers: {},
  };
}

function readConfig(): unknown {
  return JSON.parse(readFileSync(paths.configPath, "utf8"));
}

function hello(agentId: string, command: string): ShimHello {
  return {
    type: "hello",
    version: 1,
    command,
    estimateBytes: GIB,
    agentId,
    process: { pid: 4242, startTime: 1, pidNamespace: null, bootId: null, initStartTime: null },
  };
}

// A shim's side of the protocol: connect, send the hello, keep the connection.
function sendHello(message: ShimHello): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(paths.socketPath);
    sockets.push(socket);
    socket.on("error", reject);
    // A shim reads its notices. A socket holding unread data never emits end, so it never closes.
    socket.resume();
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(message)}\n`);
      resolve(socket);
    });
  });
}

function idleDeps(): GateDeps {
  return {
    now: () => Date.now(),
    readFreeMemory: () => null,
    readRss: () => null,
    startTimer: () => () => undefined,
    log: () => undefined,
  };
}

async function noTitle(): Promise<string | null> {
  return null;
}

function waitForStatus(
  plugin: GatePlugin,
  accept: (status: GateStatus) => boolean,
  resolveTitle: (agentId: string) => Promise<string | null> = noTitle,
): Promise<GateStatus> {
  return vi.waitFor(
    async () => {
      const status = await plugin.status(resolveTitle);
      if (!accept(status)) throw new Error(`not there yet: ${JSON.stringify(status)}`);
      return status;
    },
    { timeout: 5_000, interval: 50 },
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "heavy-gate-plugin-"));
  paths = gatePaths(join(root, "heavy-command-gate"));
  logs.length = 0;
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const plugin of plugins.splice(0)) await plugin.stop();
  rmSync(root, { recursive: true, force: true });
});

describe("withShimPath", () => {
  it("keeps the launch env and moves an existing shim entry to the front", () => {
    const request = openRequest({ PATH: `/opt/tools:${paths.binDir}:/usr/bin`, FOO: "bar" });
    expect(withShimPath(request, paths.binDir, DAEMON_PATH)).toEqual({
      ...request,
      env: { PATH: `${paths.binDir}:/opt/tools:/usr/bin`, FOO: "bar" },
    });
  });

  it("leaves a request alone when neither it nor the daemon has a PATH", () => {
    expect(withShimPath(openRequest(), paths.binDir, undefined)).toBeUndefined();
  });
});

describe("startGatePlugin", () => {
  it("installs the shims and the config from the stored settings, then puts them first on PATH", async () => {
    const settings = createFakeSettings();
    const plugin = start(settings);
    settings.resolveRead(ready({ slots: 2, patterns: [{ command: "tsc", estimateGb: 3 }] }));
    const opened = await plugin.openHook(openRequest());
    expect(opened?.env).toEqual({ PATH: `${paths.binDir}:${DAEMON_PATH}` });
    expect(readFileSync(paths.script, "utf8").split("\n")[0]).toBe(`#!${process.execPath}`);
    for (const name of SHIMMED_COMMANDS) {
      expect(lstatSync(join(paths.binDir, name)).isSymbolicLink()).toBe(true);
    }
    const expected: ShimConfig = {
      version: 1,
      enabled: true,
      patterns: [{ words: ["tsc"], estimateBytes: 3 * GIB }],
    };
    expect(readConfig()).toEqual(expected);
    expect(logs).toEqual([]);
  });

  it("puts the shims before the PATH an agent was launched with, once the gate is ready", async () => {
    const settings = createFakeSettings();
    const plugin = start(settings);
    const opening = plugin.openHook(openRequest({ PATH: "/custom/bin" }));
    settings.resolveRead(ready({}));
    expect((await opening)?.env.PATH).toBe(`${paths.binDir}:/custom/bin`);
  });

  it("rewrites config.json and reconfigures the gate when the settings are saved", async () => {
    const settings = createFakeSettings();
    const plugin = start(settings);
    settings.resolveRead(ready({}));
    await plugin.openHook(openRequest());
    settings.emit(ready({ enabled: false, slots: 3, reserveGb: 2 }, "r2"));
    await vi.waitFor(() => expect(readConfig()).toMatchObject({ enabled: false }), {
      timeout: 5_000,
    });
    expect(await plugin.status(noTitle)).toMatchObject({
      state: "off",
      error: null,
      slots: 3,
      reserveBytes: 2 * GIB,
    });
  });

  it("keeps the settings in force when the stored ones are invalid", async () => {
    const settings = createFakeSettings();
    const plugin = start(settings);
    settings.resolveRead({ status: "invalid", revision: "r1", error: "slots: Slots out of range" });
    await plugin.openHook(openRequest());
    expect(readConfig()).toEqual(toShimConfig(gateSettings.schema.parse({})));
    expect(await plugin.status(noTitle)).toMatchObject({
      state: "on",
      slots: 1,
      reserveBytes: GIB,
    });
    expect(logs).toEqual([
      "heavy-command-gate: settings are invalid, keeping the ones in force: slots: Slots out of range",
    ]);
  });

  it("lets a save that arrives before the stored settings are read win over them", async () => {
    const settings = createFakeSettings();
    const plugin = start(settings);
    settings.emit(ready({ slots: 4 }, "r2"));
    settings.resolveRead(ready({ slots: 2 }));
    await plugin.openHook(openRequest());
    expect((await plugin.status(noTitle)).slots).toBe(4);
    expect(readConfig()).toEqual(toShimConfig(gateSettings.schema.parse({ slots: 4 })));
  });

  it("stands down when another daemon's gate owns the socket", async () => {
    mkdirSync(paths.home, { recursive: true });
    const otherGate = createGate({
      config: { enabled: true, slots: 1, reserveBytes: GIB },
      deps: idleDeps(),
    });
    const other = await listenGateSocket({ socketPath: paths.socketPath, gate: otherGate });
    try {
      const settings = createFakeSettings();
      const plugin = start(settings);
      settings.resolveRead(ready({}));
      expect(await plugin.openHook(openRequest())).toBeUndefined();
      expect(existsSync(paths.script)).toBe(false);
      expect(existsSync(paths.configPath)).toBe(false);
      const reason = `another Paseo daemon owns ${paths.socketPath}`;
      expect(await plugin.status(noTitle)).toMatchObject({ state: "unavailable", error: reason });
      expect(logs).toEqual([`heavy-command-gate: unavailable, agents get no shims: ${reason}`]);
    } finally {
      await other?.close();
      otherGate.stop();
    }
  });

  it("writes nothing into another daemon's home when a save arrives after it stood down", async () => {
    mkdirSync(paths.home, { recursive: true });
    const otherGate = createGate({
      config: { enabled: true, slots: 1, reserveBytes: GIB },
      deps: idleDeps(),
    });
    const other = await listenGateSocket({ socketPath: paths.socketPath, gate: otherGate });
    try {
      const settings = createFakeSettings();
      const plugin = start(settings);
      settings.resolveRead(ready({}));
      expect(await plugin.openHook(openRequest())).toBeUndefined();
      settings.emit(ready({ slots: 3 }, "r2"));
      expect((await plugin.status(noTitle)).slots).toBe(3);
      // stop() waits for every queued config write, so a write that should not happen is on disk.
      await plugin.stop();
      expect(existsSync(paths.configPath)).toBe(false);
      expect(existsSync(paths.script)).toBe(false);
    } finally {
      await other?.close();
      otherGate.stop();
    }
  });

  it("is unavailable without a usable node, and writes nothing", async () => {
    const settings = createFakeSettings();
    const plugin = start(settings, { ok: false, reason: "no node binary on the daemon PATH" });
    expect(await plugin.openHook(openRequest())).toBeUndefined();
    expect(existsSync(paths.home)).toBe(false);
    expect(await plugin.status(noTitle)).toMatchObject({
      state: "unavailable",
      error: "no node binary on the daemon PATH",
      running: [],
      waiting: [],
    });
    expect(logs).toEqual([
      "heavy-command-gate: unavailable, agents get no shims: no node binary on the daemon PATH",
    ]);
  });

  it("reports running and waiting commands with agent titles, null where the lookup fails", async () => {
    const settings = createFakeSettings();
    const plugin = start(settings);
    settings.resolveRead(ready({}));
    await plugin.openHook(openRequest());
    await sendHello(hello("agent-1", "tsc --noEmit"));
    await waitForStatus(plugin, (status) => status.running.length === 1);
    await sendHello(hello("agent-2", "vitest run"));
    async function resolveTitle(agentId: string): Promise<string | null> {
      if (agentId === "agent-1") return "Fix the parser";
      throw new Error("no such agent");
    }
    const status = await waitForStatus(plugin, (next) => next.waiting.length === 1, resolveTitle);
    // 8 GiB read, less agent-1's 1 GiB estimate: readRss gives null, so none of it counts as used.
    expect(status).toMatchObject({ state: "on", freeBytes: 7 * GIB });
    expect(status.running).toEqual([
      expect.objectContaining({
        agentId: "agent-1",
        agentTitle: "Fix the parser",
        command: "tsc --noEmit",
      }),
    ]);
    expect(status.waiting).toEqual([
      expect.objectContaining({
        agentId: "agent-2",
        agentTitle: null,
        position: 1,
        waitingOn: "slot",
      }),
    ]);
  });

  it("stop ends every shim connection, removes the socket and can run twice", async () => {
    const settings = createFakeSettings();
    const plugin = start(settings);
    settings.resolveRead(ready({}));
    await plugin.openHook(openRequest());
    await sendHello(hello("agent-1", "tsc --noEmit"));
    const waiter = await sendHello(hello("agent-2", "vitest run"));
    await waitForStatus(plugin, (status) => status.waiting.length === 1);
    const closed = new Promise<void>((resolve) => {
      waiter.once("close", () => resolve());
    });
    await Promise.all([plugin.stop(), plugin.stop()]);
    await closed;
    expect(existsSync(paths.socketPath)).toBe(false);
    expect(await plugin.openHook(openRequest())).toBeUndefined();
  });

  it("installs nothing and frees the socket when stop comes before the stored settings are read", async () => {
    const settings = createFakeSettings();
    const plugin = start(settings);
    // The socket is claimed before the settings are read, so start is waiting on the read now.
    await vi.waitFor(() => expect(existsSync(paths.socketPath)).toBe(true), { timeout: 5_000 });
    const stopping = plugin.stop();
    settings.resolveRead(ready({}));
    await stopping;
    expect(existsSync(paths.script)).toBe(false);
    expect(existsSync(paths.configPath)).toBe(false);
    expect(existsSync(paths.socketPath)).toBe(false);
  });
});
