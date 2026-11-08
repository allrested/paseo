import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { errorCode, errorMessage } from "./errors.js";

export type ConfigObject = Record<string, unknown>;

export type ConfigRead =
  | { status: "ok"; config: ConfigObject; mode: number }
  | { status: "missing" }
  | { status: "unreadable"; reason: string };

export interface ReadOptions {
  /** Read through a symbolic link. Only files this plugin never writes are read that way. */
  followLinks: boolean;
}

export async function readClaudeConfig(file: string, options: ReadOptions): Promise<ConfigRead> {
  let text: string;
  let mode: number;
  try {
    if ((await lstat(file)).isSymbolicLink() && !options.followLinks) {
      return { status: "unreadable", reason: "is a symbolic link" };
    }
    mode = (await stat(file)).mode & 0o777;
    text = await readFile(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { status: "missing" };
    return { status: "unreadable", reason: `could not be read (${errorMessage(error)})` };
  }
  const config = parseObject(text);
  if (config === null) return { status: "unreadable", reason: "is not a valid JSON object" };
  return { status: "ok", config, mode };
}

function parseObject(text: string): ConfigObject | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return isConfigObject(value) ? value : null;
}

function isConfigObject(value: unknown): value is ConfigObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON with object keys sorted at every depth, so key order never counts as a change. */
export function canonicalJson(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortKeys(item));
  if (!isConfigObject(value)) return value;
  const sorted: ConfigObject = {};
  for (const key of Object.keys(value).sort((left, right) => (left < right ? -1 : 1))) {
    sorted[key] = sortKeys(value[key]);
  }
  return sorted;
}

/** Replaces the file through a temp file beside it, keeping `mode`. */
export async function writeClaudeConfig(
  file: string,
  config: ConfigObject,
  mode: number,
): Promise<void> {
  const temp = join(dirname(file), `.${basename(file)}.claude-accounts-${process.pid}.tmp`);
  await rm(temp, { force: true });
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { mode, flag: "wx" });
  await chmod(temp, mode);
  await rename(temp, file);
}

export type LockedRun<T> = { status: "done"; value: T } | { status: "locked"; stale: boolean };

// Claude Code writes its config under proper-lockfile, which takes `<file>.lock` with mkdir and
// treats a lock older than 10 s as abandoned. This plugin never removes a lock it did not take.
const STALE_LOCK_MS = 60_000;

export async function withConfigLock<T>(
  file: string,
  run: () => Promise<T>,
): Promise<LockedRun<T>> {
  const lock = `${file}.lock`;
  try {
    await mkdir(lock);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    return { status: "locked", stale: await isStale(lock) };
  }
  try {
    return { status: "done", value: await run() };
  } finally {
    await removeLock(lock);
  }
}

async function isStale(lock: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(lock)).mtimeMs > STALE_LOCK_MS;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function removeLock(lock: string): Promise<void> {
  try {
    await rmdir(lock);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}
