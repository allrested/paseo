import { expect, test } from "vitest";
import type { AdbRunner } from "./adb.js";
import { createAndroidDevice, quoteForDevice } from "./device.js";
import { DeviceUnreachableError, TIMED_OUT, UNREACHABLE } from "./errors.js";

const SERIAL = "dev:5555";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("rest")]);

type Answer = string | Buffer | Error;
interface Fake {
  adb: AdbRunner;
  calls: string[][];
  options: Array<{ timeoutMs?: number; binary?: boolean } | undefined>;
  answer(prefix: string, answer: Answer | (() => Answer)): void;
}

/** Answers by the start of the argv after `-s <serial>` (or the whole argv for `connect`). */
function fakeAdb(): Fake {
  const answers = new Map<string, Answer | (() => Answer)>([
    ["connect", "connected to dev:5555\n"],
    ["get-state", "device\n"],
  ]);
  const fake: Fake = {
    calls: [],
    options: [],
    answer: (prefix, answer) => {
      answers.set(prefix, answer);
    },
    adb: {
      async run(args, options) {
        fake.calls.push([...args]);
        fake.options.push(options);
        const rest = args[0] === "-s" ? args.slice(2) : args;
        let found: Answer | (() => Answer) = "";
        let best = -1;
        for (const [prefix, answer] of answers) {
          if (rest.join(" ").startsWith(prefix) && prefix.length > best) {
            found = answer;
            best = prefix.length;
          }
        }
        const value = typeof found === "function" ? found() : found;
        if (value instanceof Error) throw value;
        return Buffer.from(value);
      },
    },
  };
  return fake;
}

function setup() {
  const fake = fakeAdb();
  const device = createAndroidDevice({ serial: SERIAL, adb: fake.adb });
  return { fake, device };
}

const argvOf = (fake: Fake, from = 0) => fake.calls.slice(from);

test("quoteForDevice single-quotes every argument", () => {
  expect(quoteForDevice("a b")).toBe("'a b'");
  expect(quoteForDevice("it's")).toBe(`'it'\\''s'`);
  expect(quoteForDevice("$(reboot)")).toBe("'$(reboot)'");
  expect(quoteForDevice(";rm -rf /")).toBe("';rm -rf /'");
  expect(quoteForDevice("")).toBe("''");
});

test("ensure connects once, then trusts the connection", async () => {
  const { fake, device } = setup();
  await device.ensure();
  await device.ensure();
  expect(fake.calls).toEqual([
    ["connect", SERIAL],
    ["-s", SERIAL, "get-state"],
  ]);
});

test("a serial that is not host:port is not connected, only checked", async () => {
  const fake = fakeAdb();
  await createAndroidDevice({ serial: "emulator-5554", adb: fake.adb }).ensure();
  expect(fake.calls).toEqual([["-s", "emulator-5554", "get-state"]]);
});

test.each([
  [
    "connect says unable to connect",
    "connect",
    "failed to connect to 'dev:5555': Connection refused",
  ],
  ["connect rejects", "connect", new Error("adb timed out after 5000 ms")],
  ["the state is offline", "get-state", "offline\n"],
  ["the state call says offline", "get-state", new Error("error: device offline")],
  ["the state call times out", "get-state", new Error("adb timed out after 15000 ms")],
  ["no device is there", "get-state", new Error("error: no devices/emulators found")],
] as const)("ensure answers unreachable when %s", async (_name, prefix, answer) => {
  const { fake, device } = setup();
  fake.answer(prefix, answer);
  const error = await device.ensure().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(DeviceUnreachableError);
  expect((error as Error).message).toBe(UNREACHABLE);
});

test("after an unreachable answer the next call connects again", async () => {
  const { fake, device } = setup();
  let up = false;
  fake.answer("connect", () => (up ? "connected to dev:5555" : "unable to connect to dev:5555"));
  await expect(device.tap(1, 2)).rejects.toBeInstanceOf(DeviceUnreachableError);
  up = true;
  await device.tap(1, 2);
  expect(fake.calls.at(-1)).toEqual(["-s", SERIAL, "shell", "'input'", "'tap'", "'1'", "'2'"]);
});

test("a call that fails because the device went offline is unreachable and reconnects after", async () => {
  const { fake, device } = setup();
  await device.ensure();
  fake.answer("shell", new Error("error: device offline"));
  await expect(device.tap(1, 2)).rejects.toBeInstanceOf(DeviceUnreachableError);
  fake.answer("shell", "");
  const before = fake.calls.length;
  await device.tap(1, 2);
  expect(argvOf(fake, before)[0]).toEqual(["connect", SERIAL]);
});

test("any other failure keeps adb's words and is not unreachable", async () => {
  const { fake, device } = setup();
  fake.answer("shell", new Error("Exception occurred while executing"));
  const error = await device.tap(1, 2).catch((e: unknown) => e);
  expect(error).not.toBeInstanceOf(DeviceUnreachableError);
  expect((error as Error).message).toBe("Exception occurred while executing");
});

test.each([
  [
    "an install",
    (device: ReturnType<typeof setup>["device"]) => device.install("/tmp/a.apk"),
    "install",
  ],
  [
    "a screen dump",
    (device: ReturnType<typeof setup>["device"]) => device.dump(),
    "exec-out uiautomator",
  ],
  ["a tap", (device: ReturnType<typeof setup>["device"]) => device.tap(1, 2), "shell"],
] as const)(
  "%s that times out on a connected device is a slow command, not an unreachable one",
  async (_name, run, prefix) => {
    const { fake, device } = setup();
    await device.ensure();
    fake.answer(prefix, new Error("adb timed out after 120000 ms"));
    const before = fake.calls.length;

    const error = await run(device).catch((e: unknown) => e);

    expect(error).not.toBeInstanceOf(DeviceUnreachableError);
    expect((error as Error).message).toBe(TIMED_OUT);
    // The device is still connected: the next call does not connect again.
    fake.answer(prefix, "");
    await device.tap(1, 2);
    expect(argvOf(fake, before).some((argv) => argv[0] === "connect")).toBe(false);
  },
);

test.each([
  "Failure [INSTALL_FAILED_INTERNAL_ERROR]: the installer timed out, the device went offline",
  "E/Foo: connection reset while closed",
])("a failing command's own output is not read as a lost link: %s", async (said) => {
  const { fake, device } = setup();
  fake.answer("shell", new Error(said));
  const error = await device.tap(1, 2).catch((e: unknown) => e);
  expect(error).not.toBeInstanceOf(DeviceUnreachableError);
  expect((error as Error).message).toBe(said);
});

test.each([
  "error: closed",
  "error: device 'dev:5555' not found",
  "error: no devices/emulators found",
  "adb: unable to connect for shell",
])("adb's own connection error is unreachable: %s", async (said) => {
  const { fake, device } = setup();
  await device.ensure();
  fake.answer("shell", new Error(said));
  await expect(device.tap(1, 2)).rejects.toBeInstanceOf(DeviceUnreachableError);
});

test("shell quotes each argument for the device's shell", async () => {
  const { fake, device } = setup();
  await device.shell(["echo", "it's", "$(reboot)", ";rm -rf /", "a b", ""]);
  expect(fake.calls.at(-1)).toEqual([
    "-s",
    SERIAL,
    "shell",
    "'echo'",
    `'it'\\''s'`,
    "'$(reboot)'",
    "';rm -rf /'",
    "'a b'",
    "''",
  ]);
});

test("tap, swipe and key send input commands", async () => {
  const { fake, device } = setup();
  await device.tap(10.4, 20.6);
  await device.swipe({ x: 1, y: 2 }, { x: 3, y: 4 }, 300);
  await device.key("KEYCODE_BACK");
  expect(fake.calls.slice(-3)).toEqual([
    ["-s", SERIAL, "shell", "'input'", "'tap'", "'10'", "'21'"],
    ["-s", SERIAL, "shell", "'input'", "'swipe'", "'1'", "'2'", "'3'", "'4'", "'300'"],
    ["-s", SERIAL, "shell", "'input'", "'keyevent'", "'KEYCODE_BACK'"],
  ]);
});

test("a point that is not a number and a key that is not a key name are refused before adb", async () => {
  const { fake, device } = setup();
  await expect(device.tap(Number.NaN, 1)).rejects.toThrow("not a point");
  await expect(device.key("BACK; reboot")).rejects.toThrow("not a key");
  expect(fake.calls).toEqual([]);
});

test("text sends input text with spaces as %s, quoted", async () => {
  const { fake, device } = setup();
  await device.text("hello world");
  expect(fake.calls.at(-1)).toEqual(["-s", SERIAL, "shell", "'input'", "'text'", "'hello%sworld'"]);
  await device.text("$(reboot);it's");
  expect(fake.calls.at(-1)).toEqual([
    "-s",
    SERIAL,
    "shell",
    "'input'",
    "'text'",
    `'$(reboot);it'\\''s'`,
  ]);
});

test("text that input text cannot send says so", async () => {
  const { device } = setup();
  await expect(device.text("café")).rejects.toThrow("ASCII");
  await expect(device.text("a\nb")).rejects.toThrow("ASCII");
});

test("screenshot reads a PNG over exec-out, as binary", async () => {
  const { fake, device } = setup();
  fake.answer("exec-out screencap", PNG);
  expect(await device.screenshot()).toEqual(PNG);
  expect(fake.calls.at(-1)).toEqual(["-s", SERIAL, "exec-out", "screencap", "-p"]);
  expect(fake.options.at(-1)?.binary).toBe(true);
});

test("a screenshot that is not a PNG is an error", async () => {
  const { fake, device } = setup();
  fake.answer("exec-out screencap", "garbage");
  await expect(device.screenshot()).rejects.toThrow("not a PNG");
});

test("dump returns the XML and drops what uiautomator prints after it", async () => {
  const { fake, device } = setup();
  fake.answer(
    "exec-out uiautomator dump",
    "<?xml version='1.0'?><hierarchy rotation=\"0\"></hierarchy>UI hierchary dumped to: /dev/tty\n",
  );
  expect(await device.dump()).toBe("<?xml version='1.0'?><hierarchy rotation=\"0\"></hierarchy>");
  expect(fake.calls.at(-1)).toEqual(["-s", SERIAL, "exec-out", "uiautomator", "dump", "/dev/tty"]);
});

test("a dump without a hierarchy is an error", async () => {
  const { fake, device } = setup();
  fake.answer("exec-out uiautomator dump", "ERROR: could not get idle state.");
  await expect(device.dump()).rejects.toThrow("could not get idle state");
});

test("focus reads the focused window's package and activity", async () => {
  const { fake, device } = setup();
  fake.answer(
    "shell 'dumpsys' 'window'",
    "  mCurrentFocus=Window{1a2b u0 com.android.settings/com.android.settings.Settings}\n",
  );
  expect(await device.focus()).toEqual({
    packageName: "com.android.settings",
    activity: "com.android.settings.Settings",
  });
});

test("focus is null when no window has it", async () => {
  const { fake, device } = setup();
  fake.answer("shell 'dumpsys' 'window'", "  mCurrentFocus=null\n");
  expect(await device.focus()).toEqual({ packageName: null, activity: null });
});

test("install uses install -r and wants Success", async () => {
  const { fake, device } = setup();
  fake.answer("install", "Performing Streamed Install\nSuccess\n");
  await device.install("/home/u/app debug.apk");
  expect(fake.calls.at(-1)).toEqual(["-s", SERIAL, "install", "-r", "/home/u/app debug.apk"]);
  fake.answer("install", "Failure [INSTALL_FAILED_OLDER_SDK]");
  await expect(device.install("/a.apk")).rejects.toThrow("INSTALL_FAILED_OLDER_SDK");
});

test("launch runs monkey for the package, and says when there is nothing to launch", async () => {
  const { fake, device } = setup();
  fake.answer("shell", "Events injected: 1\n");
  await device.launch("com.example.app");
  expect(fake.calls.at(-1)).toEqual([
    "-s",
    SERIAL,
    "shell",
    "'monkey'",
    "'-p'",
    "'com.example.app'",
    "'-c'",
    "'android.intent.category.LAUNCHER'",
    "'1'",
  ]);
  fake.answer("shell", "** No activities found to run, monkey aborted.\n");
  await expect(device.launch("com.example.none")).rejects.toThrow("No activities found");
});

test("a package name that is not one is refused before adb", async () => {
  const { fake, device } = setup();
  await expect(device.launch("com.x; reboot")).rejects.toThrow("not a package name");
  await expect(device.stop("$(reboot)")).rejects.toThrow("not a package name");
  await expect(device.logs({ packageName: "a b", lines: 5 })).rejects.toThrow("not a package name");
  expect(fake.calls).toEqual([]);
});

test("stop force-stops the package", async () => {
  const { fake, device } = setup();
  await device.stop("com.example.app");
  expect(fake.calls.at(-1)).toEqual([
    "-s",
    SERIAL,
    "shell",
    "'am'",
    "'force-stop'",
    "'com.example.app'",
  ]);
});

test("logs of a package resolve its pid first", async () => {
  const { fake, device } = setup();
  fake.answer("shell 'pidof'", "4321\n");
  fake.answer("shell 'logcat'", "line1\nline2\n");
  expect(await device.logs({ packageName: "com.example.app", lines: 50 })).toBe("line1\nline2\n");
  expect(fake.calls.slice(-2)).toEqual([
    ["-s", SERIAL, "shell", "'pidof'", "'com.example.app'"],
    ["-s", SERIAL, "shell", "'logcat'", "'-d'", "'-t'", "'50'", "'--pid=4321'"],
  ]);
});

test("logs fall back to the whole log when the app is not running", async () => {
  const { fake, device } = setup();
  fake.answer("shell 'pidof'", new Error("exit 1"));
  fake.answer("shell 'logcat'", "all\n");
  expect(await device.logs({ packageName: "com.example.app", lines: 50 })).toBe("all\n");
  expect(fake.calls.at(-1)).toEqual(["-s", SERIAL, "shell", "'logcat'", "'-d'", "'-t'", "'50'"]);
});

test("logs without a package read the whole log", async () => {
  const { fake, device } = setup();
  await device.logs({ lines: 7 });
  expect(fake.calls.at(-1)).toEqual(["-s", SERIAL, "shell", "'logcat'", "'-d'", "'-t'", "'7'"]);
});

test("size reads the override when there is one, else the physical size", async () => {
  const { fake, device } = setup();
  fake.answer("shell 'wm'", "Physical size: 720x1280\n");
  expect(await device.size()).toEqual({ width: 720, height: 1280 });
  fake.answer("shell 'wm'", "Physical size: 720x1280\nOverride size: 360x640\n");
  expect(await device.size()).toEqual({ width: 360, height: 640 });
  fake.answer("shell 'wm'", "nonsense");
  await expect(device.size()).rejects.toThrow("screen size");
});
