import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolContext, AgentToolResult, PluginHookAgent } from "@getpaseo/plugin/server";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createAndroidTools } from "./agent-tools.js";
import { createScreenRecorder } from "./recorder.js";
import type { AndroidDevice } from "./device.js";
import { DeviceUnreachableError, UNREACHABLE } from "./errors.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("png")]);
const NOW = new Date("2026-11-13T10:20:30.123Z");

const DUMP = `<hierarchy><node text="Network &amp; internet" resource-id="a:id/title" content-desc="" clickable="true" focused="false" scrollable="false" bounds="[0,100][720,200]" /><node text="Battery" resource-id="" content-desc="" clickable="true" focused="false" scrollable="false" bounds="[0,200][720,300]" /></hierarchy>`;

let root = "";
let workspace = "";
let outside = "";

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "android-tools-")));
  workspace = join(root, "ws");
  outside = join(root, "other");
  await mkdir(workspace);
  await mkdir(outside);
});
afterAll(() => rm(root, { recursive: true, force: true }));

function agent(id: string, cwd = workspace): PluginHookAgent {
  return {
    id,
    workspaceId: "w1",
    parentAgentId: null,
    provider: "claude",
    cwd,
    title: null,
    background: false,
    metadata: {},
  };
}

function fakeDevice(overrides: Partial<AndroidDevice> = {}) {
  const calls: string[] = [];
  // A recording runs until the device gets pkill, as screenrecord does.
  let endRecording = () => undefined as void;
  const device: AndroidDevice = {
    ensure: async () => {},
    shell: async (command) => {
      if (command[0] === "pkill") endRecording();
      return "";
    },
    screenshot: async () => PNG,
    dump: async () => DUMP,
    focus: async () => ({ packageName: "com.android.settings", activity: ".Settings" }),
    tap: async (x, y) => {
      calls.push(`tap ${x},${y}`);
    },
    swipe: async (from, to, ms) => {
      calls.push(`swipe ${from.x},${from.y} ${to.x},${to.y} ${ms}`);
    },
    key: async (keycode) => {
      calls.push(`key ${keycode}`);
    },
    text: async (value) => {
      calls.push(`text ${value}`);
    },
    install: async (apk) => {
      calls.push(`install ${apk}`);
    },
    launch: async (name) => {
      calls.push(`launch ${name}`);
    },
    stop: async (name) => {
      calls.push(`stop ${name}`);
    },
    logs: async (input) => {
      calls.push(`logs ${input.packageName ?? "-"} ${input.lines}`);
      return "log line\n";
    },
    size: async () => ({ width: 720, height: 1280 }),
    record: async (remote, seconds) => {
      calls.push(`record ${remote} ${seconds}`);
      return {
        done: new Promise<void>((resolve) => {
          endRecording = resolve;
        }),
      };
    },
    pull: async (remote, local) => {
      calls.push(`pull ${remote}`);
      await writeFile(local, "mp4");
    },
    ...overrides,
  };
  return { device, calls };
}

function setup(overrides: Partial<AndroidDevice> = {}, workspacePath: string | null = workspace) {
  const { device, calls } = fakeDevice(overrides);
  const recorder = createScreenRecorder({ device, now: () => NOW });
  const tools = createAndroidTools({
    device,
    recorder,
    workspacePath: () => workspacePath,
    now: () => NOW,
  });
  async function run(
    name: string,
    input: object,
    who: PluginHookAgent = agent("a1"),
  ): Promise<AgentToolResult> {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    const parsed = tool.input.parse(input);
    return tool.execute(parsed, { agent: who } as AgentToolContext);
  }
  return { tools, run, calls };
}

test("there are eleven tools with these names", () => {
  expect(setup().tools.map((tool) => tool.name)).toEqual([
    "android_snapshot",
    "android_tap",
    "android_type",
    "android_key",
    "android_swipe",
    "android_screenshot",
    "android_record_start",
    "android_record_stop",
    "android_install",
    "android_launch",
    "android_logs",
  ]);
});

test("record start then stop saves the video in the workspace and answers its path", async () => {
  const { run, calls } = setup();
  expect(await run("android_record_start", {})).toEqual({
    text: "Recording the Android screen. Call android_record_stop to save it.",
  });
  const stopped = await run("android_record_stop", {});
  const expected = join(workspace, ".paseo", "android", "recording-2026-11-13T10-20-30-123Z.mp4");
  expect(stopped).toEqual({
    text: `Recording saved to ${expected}`,
    structuredContent: { path: expected },
  });
  expect(await readFile(expected, "utf8")).toBe("mp4");
  expect(calls[0]).toBe(`record /sdcard/paseo-recording-${NOW.getTime()}.mp4 180`);
});

test("record stop without a recording, and a second start, say why", async () => {
  const { run } = setup();
  expect(await run("android_record_stop", {})).toEqual({
    text: "No recording to save: call android_record_start first",
    isError: true,
  });
  await run("android_record_start", {});
  expect(await run("android_record_start", {})).toEqual({
    text: "A recording is already running",
    isError: true,
  });
});

test("snapshot answers with the app and one line per element", async () => {
  const { run } = setup();
  expect((await run("android_snapshot", {})).text).toBe(
    [
      "App: com.android.settings/.Settings",
      '@a1 "Network & internet" [button] id=a:id/title',
      '@a2 "Battery" [button]',
    ].join("\n"),
  );
});

test("tap by ref taps the centre of that element of the agent's last snapshot", async () => {
  const { run, calls } = setup();
  await run("android_snapshot", {});
  const result = await run("android_tap", { ref: "@a2" });
  expect(calls).toEqual(["tap 360,250"]);
  expect(result.isError).toBeUndefined();
  expect(result.text).toContain("@a2");
});

test("tap by point taps there", async () => {
  const { run, calls } = setup();
  await run("android_tap", { x: 40, y: 50 });
  expect(calls).toEqual(["tap 40,50"]);
});

test("a tap needs a ref or a point, not both and not neither", async () => {
  const { tools } = setup();
  const tap = tools.find((tool) => tool.name === "android_tap")!;
  expect(tap.input.safeParse({}).success).toBe(false);
  expect(tap.input.safeParse({ ref: "@a1", x: 1, y: 2 }).success).toBe(false);
  expect(tap.input.safeParse({ x: 1 }).success).toBe(false);
});

test("an unknown ref, a ref with no snapshot, and another agent's snapshot all say to take a new one", async () => {
  const { run, calls } = setup();
  const stale = "Take a new snapshot: that ref is not on the screen any more";
  expect(await run("android_tap", { ref: "@a1" })).toEqual({ text: stale, isError: true });
  await run("android_snapshot", {}, agent("a1"));
  expect((await run("android_tap", { ref: "@a9" })).text).toBe(stale);
  expect((await run("android_tap", { ref: "@a1" }, agent("a2"))).text).toBe(stale);
  expect(calls).toEqual([]);
});

test("each agent's refs come from its own snapshot", async () => {
  let dump = DUMP;
  const { run, calls } = setup({ dump: async () => dump });
  await run("android_snapshot", {}, agent("a1"));
  dump = `<hierarchy><node text="Other" clickable="true" bounds="[0,0][100,100]" /></hierarchy>`;
  await run("android_snapshot", {}, agent("a2"));
  await run("android_tap", { ref: "@a1" }, agent("a1"));
  await run("android_tap", { ref: "@a1" }, agent("a2"));
  expect(calls).toEqual(["tap 360,150", "tap 50,50"]);
});

test("type, key and swipe reach the device", async () => {
  const { run, calls } = setup();
  await run("android_type", { text: "wifi" });
  await run("android_key", { key: "back" });
  await run("android_key", { key: "ENTER" });
  await run("android_key", { key: "KEYCODE_VOLUME_UP" });
  await run("android_swipe", { from: { x: 1, y: 2 }, to: { x: 3, y: 4 } });
  expect(calls).toEqual([
    "text wifi",
    "key KEYCODE_BACK",
    "key KEYCODE_ENTER",
    "key KEYCODE_VOLUME_UP",
    "swipe 1,2 3,4 300",
  ]);
});

test.each([
  ["up", "swipe 360,640 360,128 300"],
  ["down", "swipe 360,640 360,1152 300"],
  ["left", "swipe 360,640 72,640 300"],
  ["right", "swipe 360,640 648,640 300"],
])("a swipe %s starts in the middle of the screen and moves 40% of it", async (direction, call) => {
  const { run, calls } = setup();
  const answer = await run("android_swipe", { direction });
  expect(answer.isError).toBeUndefined();
  expect(calls).toEqual([call]);
});

test("a swipe by direction takes a duration too", async () => {
  const { run, calls } = setup();
  await run("android_swipe", { direction: "up", durationMs: 600 });
  expect(calls).toEqual(["swipe 360,640 360,128 600"]);
});

test("a swipe needs two points or a direction, not both and not neither", () => {
  const swipe = setup().tools.find((tool) => tool.name === "android_swipe")!;
  const point = { x: 1, y: 2 };
  expect(swipe.input.safeParse({}).success).toBe(false);
  expect(swipe.input.safeParse({ from: point }).success).toBe(false);
  expect(swipe.input.safeParse({ from: point, to: point, direction: "up" }).success).toBe(false);
  expect(swipe.input.safeParse({ direction: "sideways" }).success).toBe(false);
  expect(swipe.input.safeParse({ from: point, to: point }).success).toBe(true);
  expect(swipe.input.safeParse({ direction: "left" }).success).toBe(true);
});

test("a swipe by direction reports an unreachable device", async () => {
  const { run } = setup({
    size: async () => {
      throw new DeviceUnreachableError();
    },
  });
  expect(await run("android_swipe", { direction: "up" })).toEqual({
    text: UNREACHABLE,
    isError: true,
  });
});

test("a key that is not a key name is refused by the schema", () => {
  const key = setup().tools.find((tool) => tool.name === "android_key")!;
  expect(key.input.safeParse({ key: "back; reboot" }).success).toBe(false);
});

test("launch and logs reach the device", async () => {
  const { run, calls } = setup();
  await run("android_launch", { package: "com.example.app" });
  expect((await run("android_logs", { package: "com.example.app" })).text).toBe("log line\n");
  await run("android_logs", { lines: 20 });
  expect(calls).toEqual(["launch com.example.app", "logs com.example.app 100", "logs - 20"]);
});

test("launch stops a package when asked, and starts it by default or when asked", async () => {
  const { run, calls } = setup();
  const stopped = await run("android_launch", { package: "com.example.app", action: "stop" });
  await run("android_launch", { package: "com.example.app", action: "start" });
  await run("android_launch", { package: "com.example.app" });
  expect(stopped).toEqual({ text: "Stopped com.example.app." });
  expect(calls).toEqual([
    "stop com.example.app",
    "launch com.example.app",
    "launch com.example.app",
  ]);
});

test("launch refuses an action that is not start or stop", () => {
  const launch = setup().tools.find((tool) => tool.name === "android_launch")!;
  expect(launch.input.safeParse({ package: "com.example.app", action: "kill" }).success).toBe(
    false,
  );
});

test("a long log is cut from the front", async () => {
  const { run } = setup({ logs: async () => `${"x".repeat(30_000)}END` });
  const text = (await run("android_logs", {})).text ?? "";
  expect(text.length).toBeLessThan(21_000);
  expect(text.endsWith("END")).toBe(true);
});

test("screenshot writes a PNG under the workspace's .paseo/android and answers its path", async () => {
  const { run } = setup();
  const result = await run("android_screenshot", {});
  const expected = join(workspace, ".paseo", "android", "android-2026-11-13T10-20-30-123Z.png");
  expect(result.text).toContain(expected);
  expect(result.structuredContent).toEqual({ path: expected });
  expect(await readFile(expected)).toEqual(PNG);
});

test("screenshot without a workspace folder says so", async () => {
  const { run } = setup({}, null);
  const result = await run("android_screenshot", {});
  expect(result.isError).toBe(true);
});

test("install takes an APK inside the workspace, relative or absolute", async () => {
  const { run, calls } = setup();
  await writeFile(join(workspace, "app.apk"), "x");
  await run("android_install", { path: "app.apk" });
  await run("android_install", { path: join(workspace, "app.apk") });
  expect(calls).toEqual([
    `install ${join(workspace, "app.apk")}`,
    `install ${join(workspace, "app.apk")}`,
  ]);
});

test("install takes an APK in the home folder", async () => {
  const home = await realpath(homedir());
  const { run } = setup();
  // The file need not exist for the refusal to differ: a missing file under home is not found, not refused.
  const result = await run("android_install", {
    path: join(home, "definitely-missing-paseo-test.apk"),
  });
  expect(result.text).toContain("does not exist");
  expect(result.text).not.toContain("outside");
});

test("install refuses an APK outside the workspace and home, a symlink that leaves, and a non-APK", async () => {
  const { run, calls } = setup();
  await writeFile(join(outside, "evil.apk"), "x");
  await symlink(join(outside, "evil.apk"), join(workspace, "link.apk"));
  await writeFile(join(workspace, "notes.txt"), "x");
  const refused = await run("android_install", { path: join(outside, "evil.apk") });
  expect(refused.isError).toBe(true);
  expect(refused.text).toContain("outside");
  expect((await run("android_install", { path: "link.apk" })).text).toContain("outside");
  expect((await run("android_install", { path: "../other/evil.apk" })).text).toContain("outside");
  expect((await run("android_install", { path: "notes.txt" })).text).toContain(".apk");
  expect((await run("android_install", { path: "/etc/passwd" })).isError).toBe(true);
  expect(calls).toEqual([]);
});

test("every tool answers with the unreachable words when the device throws them", async () => {
  const unreachable = async () => {
    throw new DeviceUnreachableError();
  };
  const { tools, run } = setup({
    ensure: unreachable,
    dump: unreachable,
    focus: unreachable,
    tap: unreachable,
    swipe: unreachable,
    key: unreachable,
    text: unreachable,
    install: unreachable,
    launch: unreachable,
    logs: unreachable,
    screenshot: unreachable,
    record: unreachable,
  });
  await writeFile(join(workspace, "u.apk"), "x");
  const inputs: Record<string, object> = {
    android_snapshot: {},
    android_tap: { x: 1, y: 2 },
    android_type: { text: "a" },
    android_key: { key: "back" },
    android_swipe: { from: { x: 1, y: 2 }, to: { x: 3, y: 4 } },
    android_screenshot: {},
    android_record_start: {},
    android_install: { path: "u.apk" },
    android_launch: { package: "com.example.app" },
    android_logs: {},
  };
  // android_record_stop asks the device only once a recording runs.
  for (const tool of tools.filter((candidate) => candidate.name !== "android_record_stop")) {
    expect(await run(tool.name, inputs[tool.name]!), tool.name).toEqual({
      text: UNREACHABLE,
      isError: true,
    });
  }
});

test("any other failure is answered as text, never thrown", async () => {
  const { run } = setup({
    tap: async () => {
      throw new Error("input failed");
    },
  });
  expect(await run("android_tap", { x: 1, y: 2 })).toEqual({ text: "input failed", isError: true });
});
