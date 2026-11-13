import type { AdbRunner } from "./adb.js";
import { DeviceUnreachableError, errorMessage } from "./errors.js";

export interface Point {
  x: number;
  y: number;
}

export interface AndroidDevice {
  /** `adb connect` when not connected, then a state check. Throws DeviceUnreachableError. */
  ensure(): Promise<void>;
  shell(command: readonly string[]): Promise<string>;
  screenshot(): Promise<Buffer>;
  dump(): Promise<string>;
  focus(): Promise<{ packageName: string | null; activity: string | null }>;
  tap(x: number, y: number): Promise<void>;
  swipe(from: Point, to: Point, durationMs: number): Promise<void>;
  key(keycode: string): Promise<void>;
  text(value: string): Promise<void>;
  install(apkPath: string): Promise<void>;
  launch(packageName: string): Promise<void>;
  stop(packageName: string): Promise<void>;
  logs(input: { packageName?: string; lines: number }): Promise<string>;
  size(): Promise<{ width: number; height: number }>;
}

const INSTALL_TIMEOUT_MS = 120_000;
const CONNECT_TIMEOUT_MS = 8_000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const KEY_NAME = /^[A-Za-z0-9_]+$/;
const UNREACHABLE_WORDS =
  /offline|unable to connect|failed to connect|cannot connect|can't connect|no devices|device '.*' not found|timed out|connection refused|connection reset|^error: closed/im;

/**
 * adb joins the arguments after `shell` with spaces and the device's shell parses the result, so
 * each one is wrapped in single quotes; a quote inside becomes `'\''`.
 */
export function quoteForDevice(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function requirePackage(name: string): string {
  if (!PACKAGE_NAME.test(name)) throw new Error(`"${name}" is not a package name`);
  return name;
}

function requireNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("That is not a point on the screen");
  return String(Math.round(value));
}

export function createAndroidDevice(input: { serial: string; adb: AdbRunner }): AndroidDevice {
  const { serial, adb } = input;
  let connected = false;

  function unreachableOr(error: unknown): Error {
    if (error instanceof DeviceUnreachableError) return error;
    if (UNREACHABLE_WORDS.test(errorMessage(error))) {
      connected = false;
      return new DeviceUnreachableError();
    }
    return error instanceof Error ? error : new Error(errorMessage(error));
  }

  async function ensure(): Promise<void> {
    if (connected) return;
    try {
      if (serial.includes(":")) {
        const said = (
          await adb.run(["connect", serial], { timeoutMs: CONNECT_TIMEOUT_MS })
        ).toString();
        if (!/connected to/i.test(said) || /unable|failed|cannot/i.test(said)) {
          throw new DeviceUnreachableError();
        }
      }
      const state = (await adb.run(["-s", serial, "get-state"])).toString().trim();
      if (state !== "device") throw new DeviceUnreachableError();
      connected = true;
    } catch (error) {
      throw unreachableOr(error);
    }
  }

  async function call(
    args: readonly string[],
    options?: { timeoutMs?: number; binary?: boolean },
  ): Promise<Buffer> {
    await ensure();
    try {
      return await adb.run(["-s", serial, ...args], options);
    } catch (error) {
      throw unreachableOr(error);
    }
  }

  async function shell(command: readonly string[]): Promise<string> {
    return (await call(["shell", ...command.map(quoteForDevice)])).toString();
  }

  return {
    ensure,
    shell,
    async screenshot() {
      const png = await call(["exec-out", "screencap", "-p"], { binary: true });
      if (!png.subarray(0, 4).equals(PNG_MAGIC))
        throw new Error("The device's screenshot is not a PNG");
      return png;
    },
    async dump() {
      const out = (await call(["exec-out", "uiautomator", "dump", "/dev/tty"])).toString();
      const end = out.lastIndexOf("</hierarchy>");
      if (!out.includes("<hierarchy") || end === -1) {
        throw new Error(out.trim().slice(0, 300) || "uiautomator returned no screen");
      }
      return out.slice(0, end + "</hierarchy>".length);
    },
    async focus() {
      const out = await shell(["dumpsys", "window"]);
      const match = /mCurrentFocus=Window\{[^\s}]+ \S+ ([^\s/}]+)\/([^\s}]+)\}/.exec(out);
      return match
        ? { packageName: match[1] ?? null, activity: match[2] ?? null }
        : { packageName: null, activity: null };
    },
    async tap(x, y) {
      await shell(["input", "tap", requireNumber(x), requireNumber(y)]);
    },
    async swipe(from, to, durationMs) {
      await shell([
        "input",
        "swipe",
        requireNumber(from.x),
        requireNumber(from.y),
        requireNumber(to.x),
        requireNumber(to.y),
        requireNumber(durationMs),
      ]);
    },
    async key(keycode) {
      if (!KEY_NAME.test(keycode)) throw new Error(`"${keycode}" is not a key name`);
      await shell(["input", "keyevent", keycode]);
    },
    async text(value) {
      if (!/^[\x20-\x7e]*$/.test(value)) {
        throw new Error("Only printable ASCII can be typed; use android_key for Enter");
      }
      await shell(["input", "text", value.replace(/ /g, "%s")]);
    },
    async install(apkPath) {
      const out = (
        await call(["install", "-r", apkPath], { timeoutMs: INSTALL_TIMEOUT_MS })
      ).toString();
      if (!/^Success/m.test(out))
        throw new Error(out.trim() || "The install did not report Success");
    },
    async launch(packageName) {
      const out = await shell([
        "monkey",
        "-p",
        requirePackage(packageName),
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
      ]);
      if (/No activities found/.test(out)) throw new Error(out.trim());
    },
    async stop(packageName) {
      await shell(["am", "force-stop", requirePackage(packageName)]);
    },
    async logs({ packageName, lines }) {
      const count = String(Math.max(1, Math.floor(lines)));
      let pidFilter: string[] = [];
      if (packageName !== undefined) {
        requirePackage(packageName);
        try {
          const pid = (await shell(["pidof", packageName])).trim().split(/\s+/)[0];
          if (pid && /^\d+$/.test(pid)) pidFilter = [`--pid=${pid}`];
        } catch (error) {
          if (error instanceof DeviceUnreachableError) throw error;
          // pidof exits 1 when the app is not running.
        }
      }
      return shell(["logcat", "-d", "-t", count, ...pidFilter]);
    },
    async size() {
      const out = await shell(["wm", "size"]);
      const override =
        /Override size: (\d+)x(\d+)/.exec(out) ?? /Physical size: (\d+)x(\d+)/.exec(out);
      if (!override) throw new Error("The device did not report its screen size");
      return { width: Number(override[1]), height: Number(override[2]) };
    },
  };
}
