import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PluginHandlerContext,
  PluginServerContext,
  PluginSessionOpenRequest,
  PluginSettingsState,
} from "@getpaseo/plugin/server";
import { afterEach, expect, test, vi } from "vitest";
import contribute, { createAndroidPlugin } from "./index.server.js";
import type { AndroidDevice } from "./server/device.js";
import { nodeClock, type Clock } from "./server/timers.js";
import type { androidHostSettings } from "./shared/settings.js";

type SettingsState = PluginSettingsState<typeof androidHostSettings.schema>;
type Handler = (input: object, context: PluginHandlerContext) => unknown;

const ON: SettingsState = { status: "ready", revision: "1", values: { agentTools: true } };
const OFF: SettingsState = { status: "ready", revision: "2", values: { agentTools: false } };
const OWN_TOOL = { name: "other_tool", description: "Another plugin's tool", inputSchema: {} };
const NAMES = [
  "android_snapshot",
  "android_tap",
  "android_type",
  "android_key",
  "android_swipe",
  "android_screenshot",
  "android_install",
  "android_launch",
  "android_logs",
];

interface Recorded {
  hooks: Map<string, Handler>;
  handlers: Map<string, Handler>;
  settingsRegistered: number;
  reads: number;
}

function fakeServer(recorded: Recorded, read: () => Promise<SettingsState>): PluginServerContext {
  return {
    registerSettings: () => {
      recorded.settingsRegistered += 1;
      return {
        read: () => {
          recorded.reads += 1;
          return read();
        },
        subscribe: () => () => undefined,
      };
    },
    handle: (contract: { name: string }, handler: Handler) => {
      recorded.handlers.set(contract.name, handler);
    },
    addHook: (name: string, hook: Handler) => {
      recorded.hooks.set(name, hook);
      return () => {
        recorded.hooks.delete(name);
      };
    },
  };
}

const context: PluginHandlerContext = { signal: new AbortController().signal } as never;
const clock: Clock = {
  now: () => 0,
  setTimeout: () => {
    throw new Error("the Android plugin must not start timers");
  },
};

function openRequest(overrides: Partial<PluginSessionOpenRequest> = {}): PluginSessionOpenRequest {
  return {
    agentId: "agent-1",
    workspaceId: "w1",
    provider: "claude",
    cwd: "/workspace",
    reason: "create",
    purpose: "interactive",
    title: "Planner",
    background: false,
    labels: {},
    metadata: {},
    tools: [OWN_TOOL],
    env: {},
    mcpServers: {},
    ...overrides,
  };
}

function setup(
  read: () => Promise<SettingsState>,
  device: AndroidDevice | null = {} as never,
  useClock: Clock = clock,
) {
  const recorded: Recorded = {
    hooks: new Map(),
    handlers: new Map(),
    settingsRegistered: 0,
    reads: 0,
  };
  const logs: string[] = [];
  const stop = createAndroidPlugin(fakeServer(recorded, read), {
    device,
    clock: useClock,
    log: (message) => logs.push(message),
  });
  const open = (overrides: Partial<PluginSessionOpenRequest> = {}) =>
    recorded.hooks.get("agent.open.before")?.(
      { request: openRequest(overrides) },
      context,
    ) as Promise<PluginSessionOpenRequest | undefined>;
  return { recorded, logs, stop, open };
}

test("an interactive session keeps its own tools and gets the nine Android tools", async () => {
  const { open, stop } = setup(async () => ON);
  const result = await open();
  expect(result?.tools.map((tool) => tool.name)).toEqual(["other_tool", ...NAMES]);
  expect({ ...result, tools: [] }).toEqual(openRequest({ tools: [] }));
  await stop();
});

test("no tools while the setting is off, and a change holds from the next session on", async () => {
  const states = [ON, OFF, ON];
  const { open, stop, recorded } = setup(async () => states[recorded.reads - 1] ?? ON);
  const results = [await open(), await open(), await open()];
  expect(results.map((result) => result?.tools.length)).toEqual([10, undefined, 10]);
  await stop();
});

test("a session opened to read history gets no tools, and the setting is not read for it", async () => {
  const { open, stop, recorded } = setup(async () => ON);
  expect(await open({ purpose: "history" })).toBeUndefined();
  expect(recorded.reads).toBe(0);
  await stop();
});

test("a setting that cannot be read leaves the session as it is and is logged", async () => {
  const { open, stop, logs } = setup(async () => {
    throw new Error("settings store is down");
  });
  expect(await open()).toBeUndefined();
  expect(logs).toEqual(["[android] agent.open.before failed: settings store is down"]);
  await stop();
});

test("the state call says the device is available and whether agent tools are on", async () => {
  const states = [ON, OFF];
  const { recorded, stop } = setup(async () => states.shift() ?? ON);
  const state = recorded.handlers.get("android.state.request");
  expect(await state?.({}, context)).toEqual({
    available: true,
    agentTools: true,
    maestro: false,
  });
  expect(await state?.({}, context)).toEqual({
    available: true,
    agentTools: false,
    maestro: false,
  });
  await stop();
});

test("a state call whose setting cannot be read answers without tools and does not throw", async () => {
  const { recorded, stop, logs } = setup(async () => {
    throw new Error("down");
  });
  expect(await recorded.handlers.get("android.state.request")?.({}, context)).toEqual({
    available: true,
    agentTools: false,
    maestro: false,
  });
  expect(logs).toEqual(["[android] state failed: down"]);
  await stop();
});

test("the entry serves the state call, the picture stream and its input, and one hook; stopping removes the hook", async () => {
  const { recorded, stop } = setup(async () => ON);
  expect([...recorded.handlers.keys()]).toEqual([
    "android.state.request",
    "android.stream",
    "android.stream.input.request",
  ]);
  expect([...recorded.hooks.keys()]).toEqual(["agent.open.before"]);
  await stop();
  expect(recorded.hooks.size).toBe(0);
});

test("the input call reaches the device, and stopping closes an open stream", async () => {
  const taps: Array<[number, number]> = [];
  const device = {
    size: async () => ({ width: 720, height: 1280 }),
    screenshot: async () => Buffer.from("a"),
    tap: async (x: number, y: number) => {
      taps.push([x, y]);
    },
  } as unknown as AndroidDevice;
  const { recorded, stop } = setup(async () => ON, device, nodeClock);
  const events: Array<{ type: string; streamId?: string }> = [];
  const controller = new AbortController();
  const served = recorded.handlers.get("android.stream")?.({}, {
    signal: controller.signal,
    push: async (event: never) => void events.push(event),
  } as never) as Promise<void>;
  await new Promise((resolve) => setImmediate(resolve));
  expect(events[0]).toMatchObject({ type: "ready", width: 720, height: 1280 });

  const answer = await recorded.handlers.get("android.stream.input.request")?.(
    { streamId: events[0]?.streamId, tap: { x: 5, y: 6 } },
    context,
  );
  expect(answer).toEqual({ ok: true });
  expect(taps).toEqual([[5, 6]]);

  await stop();
  await served;
});

test("with no device the entry registers no hook, no handler, no setting and no timer", async () => {
  const { recorded, stop } = setup(async () => ON, null);
  expect(recorded.hooks.size).toBe(0);
  expect(recorded.handlers.size).toBe(0);
  expect(recorded.settingsRegistered).toBe(0);
  await stop();
});

// The default export decides from the daemon's env and PATH.
const saved = { adb: process.env.PASEO_ANDROID_ADB, path: process.env.PATH };
afterEach(() => {
  vi.restoreAllMocks();
  if (saved.adb === undefined) delete process.env.PASEO_ANDROID_ADB;
  else process.env.PASEO_ANDROID_ADB = saved.adb;
  process.env.PATH = saved.path;
});

async function pathWithAdb(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "android-entry-"));
  await writeFile(join(directory, "adb"), "#!/bin/sh\nexit 0\n");
  await chmod(join(directory, "adb"), 0o755);
  return directory;
}

function registrations(): { recorded: Recorded; stop: () => Promise<void> } {
  const recorded: Recorded = {
    hooks: new Map(),
    handlers: new Map(),
    settingsRegistered: 0,
    reads: 0,
  };
  return { recorded, stop: contribute(fakeServer(recorded, async () => ON)) };
}

test("the default export is on with a serial and adb on PATH", async () => {
  const directory = await pathWithAdb();
  process.env.PASEO_ANDROID_ADB = "127.0.0.1:5555";
  process.env.PATH = `${directory}:/nonexistent`;
  const { recorded, stop } = registrations();
  expect([...recorded.handlers.keys()]).toEqual([
    "android.state.request",
    "android.stream",
    "android.stream.input.request",
  ]);
  expect([...recorded.hooks.keys()]).toEqual(["agent.open.before"]);
  await stop();
  await rm(directory, { recursive: true, force: true });
});

test.each([
  ["the variable is unset", undefined],
  ["the variable is an empty string", ""],
])("the default export registers nothing when %s", async (_name, value) => {
  const directory = await pathWithAdb();
  if (value === undefined) delete process.env.PASEO_ANDROID_ADB;
  else process.env.PASEO_ANDROID_ADB = value;
  process.env.PATH = directory;
  const { recorded, stop } = registrations();
  expect(recorded.hooks.size + recorded.handlers.size + recorded.settingsRegistered).toBe(0);
  await stop();
  await rm(directory, { recursive: true, force: true });
});

test("the default export registers nothing, and says why, when adb is not on PATH", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  process.env.PASEO_ANDROID_ADB = "127.0.0.1:5555";
  process.env.PATH = "/nonexistent";
  const { recorded, stop } = registrations();
  expect(recorded.hooks.size + recorded.handlers.size + recorded.settingsRegistered).toBe(0);
  expect(error).toHaveBeenCalledWith("[android] PASEO_ANDROID_ADB is set but adb is not on PATH");
  await stop();
});
