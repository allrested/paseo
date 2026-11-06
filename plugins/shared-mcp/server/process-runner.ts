import { spawn, type ChildProcessByStdio } from "node:child_process";
import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
  type WriteStream,
} from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { parseStat, walkProcessTree, type ProcessTreeEntry, type ProcStat } from "./procfs.js";

const DEFAULT_GRACE_MS = 5_000;
// SIGKILL cannot be caught; this only bounds the wait for members nobody has reaped yet.
const KILL_WAIT_MS = 2_000;
const POLL_MS = 50;
// A process that left the group after its parent exited is no longer linked to the tree, so it is
// never signalled, and it can hold the pipes open after the group is gone.
const STDIO_DRAIN_MS = 1_000;
const LOG_RING_LIMIT = 200;
// Bounds what one line costs in the ring, the log file and the status payload. readline itself
// still holds an unfinished line in memory until its newline arrives.
const MAX_LINE_CHARS = 4_000;
const DEFAULT_PROC_ROOT = "/proc";

// Paseo's own variables, PASEO_PASSWORD and PASEO_HOME among them, never reach a server: most are
// third-party npx and uvx packages. The keys below are the rest of what Paseo removes from every
// process it launches (packages/server/src/server/paseo-env.ts and PARENT_SESSION_ENV_VARS in
// agent/provider-launch-config.ts). Plugins cannot import server code.
const STRIPPED_ENV_PREFIX = "PASEO_";
const STRIPPED_ENV_KEYS = new Set([
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_NO_ATTACH_CONSOLE",
  "ESBUILD_BINARY_PATH",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_AGENT_SDK_VERSION",
]);

// startTime is field 22 of /proc/<pid>/stat. With ownerPid it tells a pid file left by a dead
// daemon apart from one a live daemon (or a test pointed at the same home) still owns, and a group
// apart from a later process that reuses its pid. Both are null where /proc does not exist. A pgid
// of 1 or less parses, so reclaimOrphan can drop the file as stale.
const PidRecordSchema = z.object({
  pgid: z.number().int(),
  startTime: z.number().int().nullable(),
  ownerPid: z.number().int().positive(),
  ownerStartTime: z.number().int().nullable(),
});
type PidRecord = z.output<typeof PidRecordSchema>;

type ServerChild = ChildProcessByStdio<null, Readable, Readable>;

// One kill of a server's process tree. The SIGKILL deadline can only move earlier.
interface Termination {
  /** Resolves once the group and every listed process outside it are gone. Never rejects. */
  done: Promise<void>;
  /** Moves the SIGKILL to graceMs from now when that is earlier than the current deadline. */
  hurry(graceMs: number): void;
}

export class LogRing {
  private readonly entries: string[] = [];

  constructor(private readonly limit = LOG_RING_LIMIT) {}

  push(line: string): void {
    this.entries.push(line);
    if (this.entries.length > this.limit) this.entries.shift();
  }

  lines(): string[] {
    return [...this.entries];
  }
}

export interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface RunningProcess {
  pid: number;
  /** Resolves when the group is gone, output is flushed and the pid file removed. Never rejects. */
  exited: Promise<ExitInfo>;
  /**
   * Lists the process tree and sends SIGTERM before the first await, SIGKILL after graceMs, then
   * waits for `exited`. A later call with a shorter grace brings the SIGKILL forward. That can take
   * graceMs + 2 s (members still unreaped after SIGKILL) + 1 s (pipes held by a process the tree
   * no longer reaches).
   */
  stop(graceMs?: number): Promise<void>;
}

export interface SpawnSpec {
  command: string;
  cwd?: string;
  env: Record<string, string>;
  logFile: string;
  pidFile: string;
  /** Receives every output line and every runner error. Runs inside the daemon: must not throw. */
  onLine(line: string): void;
  /** Where process stats are read. /proc unless a test points it elsewhere. */
  procRoot?: string;
}

// The server runs as `sh -c` in its own process group (pgid == pid), so the npx or uvx children it
// starts die with it. The setup is synchronous on purpose: the pid file exists before the child can
// exit, so the exit path never races its removal.
export function spawnServer(spec: SpawnSpec): RunningProcess {
  const child = startShell(spec);
  const pid = child.pid;
  // Node reports ENOENT, EACCES, EAGAIN, EMFILE and ENFILE from the spawn itself as an "error"
  // event on the next tick, with no pid. The listener in startShell passes that reason to onLine.
  if (pid === undefined) {
    throw new Error(
      `Could not start /bin/sh for: ${spec.command} (the reason follows in the log tail)`,
    );
  }
  const procRoot = spec.procRoot ?? DEFAULT_PROC_ROOT;
  writePidFile(spec, pid, procRoot);
  return watchChild(child, pid, spec, procRoot);
}

function startShell(spec: SpawnSpec): ServerChild {
  try {
    mkdirSync(dirname(spec.logFile), { recursive: true });
    mkdirSync(dirname(spec.pidFile), { recursive: true });
    if (spec.cwd !== undefined) assertDirectory(spec.cwd);
    const child = spawn("/bin/sh", ["-c", spec.command], {
      cwd: spec.cwd,
      env: serverEnv(spec.env),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // An unlistened "error" would crash the daemon this plugin runs in.
    child.on("error", (error) => spec.onLine(`spawn error: ${error.message}`));
    return child;
  } catch (error) {
    throw startFailure(spec, error);
  }
}

// spawn() reports a missing cwd only on the next tick, as a bare `spawn /bin/sh ENOENT`, and throws
// a bare `spawn ENOTDIR` for a file. Checking first puts the path into the message.
function assertDirectory(cwd: string): void {
  if (!statSync(cwd).isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`);
}

// The reason goes to onLine and into the thrown message, so it reaches both the log tail and the
// supervisor's lastError.
function startFailure(spec: SpawnSpec, error: unknown): Error {
  const reason = errorMessage(error);
  spec.onLine(`spawn error: ${reason}`);
  return new Error(`Could not start /bin/sh for: ${spec.command}: ${reason}`, { cause: error });
}

function watchChild(
  child: ServerChild,
  pid: number,
  spec: SpawnSpec,
  procRoot: string,
): RunningProcess {
  const log = createWriteStream(spec.logFile, { flags: "a" });
  log.on("error", (error) => spec.onLine(`log file error: ${error.message}`));
  function emit(line: string): void {
    spec.onLine(line);
    if (log.writable) log.write(`${line}\n`);
  }
  forwardLines(child.stdout, emit);
  forwardLines(child.stderr, emit);
  const closed = new Promise<void>((resolve) => {
    child.once("close", () => resolve());
  });
  const leaderExit = new Promise<ExitInfo>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  let termination: Termination | null = null;
  let reaped = false;

  // One termination per group. A later call can only bring its SIGKILL forward.
  function terminateGroup(graceMs: number): Termination {
    if (termination !== null) {
      termination.hurry(graceMs);
      return termination;
    }
    termination = terminate(pid, graceMs, procRoot, spec.onLine);
    return termination;
  }

  async function settle(): Promise<ExitInfo> {
    const info = await leaderExit;
    // Members the leader started can outlive it and keep holding the port and the pipes.
    await terminateGroup(DEFAULT_GRACE_MS).done;
    reaped = true;
    await waitAtMost(closed, STDIO_DRAIN_MS);
    child.stdout.destroy();
    child.stderr.destroy();
    await closeLog(log);
    await removePidFile(spec.pidFile, spec.onLine);
    return info;
  }

  const exited = settle();
  return {
    pid,
    exited,
    async stop(graceMs = DEFAULT_GRACE_MS) {
      // Once the group is gone its id can be reused by another process: never signal it again.
      if (!reaped) terminateGroup(graceMs);
      await exited;
    },
  };
}

// SIGTERM to the group and to the processes outside it that descend from its members, SIGKILL to
// the same set after graceMs. Resolves once none is left, or KILL_WAIT_MS after the SIGKILL.
// A walk error has nowhere to go from here; the group is signalled all the same.
export async function killProcessGroup(pgid: number, graceMs = DEFAULT_GRACE_MS): Promise<void> {
  await terminate(pgid, graceMs, DEFAULT_PROC_ROOT, () => undefined).done;
}

// A daemon that died without cleanup leaves its groups running with their pid files. Kill such a
// group only when the daemon that wrote the file is gone and the group is still the one it started.
// Rejects after removing a pid file that does not parse, and on any other file error.
export async function reclaimOrphan(pidFile: string): Promise<boolean> {
  const record = await readPidRecord(pidFile);
  if (record === null) return false;
  // spawnServer never records a group of 1 or less, and terminate() would not signal one.
  if (record.pgid <= 1) {
    await rm(pidFile, { force: true });
    return false;
  }
  if (ownerIsAlive(record)) return false;
  const orphan = isRecordedGroup(record);
  if (orphan) await killProcessGroup(record.pgid);
  await rm(pidFile, { force: true });
  return orphan;
}

// The tree is walked before the first signal: once a member dies, the processes it started in a
// session of their own (Serena's language servers) move to init, and nothing links them to the
// server any more. The walk and every SIGTERM finish before this returns, so stop() signals before
// its first await.
function terminate(
  pgid: number,
  graceMs: number,
  procRoot: string,
  report: (line: string) => void,
): Termination {
  // Group 0 is every kernel thread and group 1 the whole init tree, and -pgid of a negative id is a
  // single pid. A group without members has no tree left to walk or signal.
  if (pgid <= 1 || !sendSignal(-pgid, 0)) {
    return { done: Promise.resolve(), hurry: () => undefined };
  }
  const tree = walkTree(pgid, procRoot, report);
  signalTree(pgid, tree, "SIGTERM", procRoot);
  let killAt = Date.now() + graceMs;
  const alive = (): boolean =>
    sendSignal(-pgid, 0) || tree.some((entry) => isStillRunning(entry, procRoot));
  async function escalate(): Promise<void> {
    if (await waitUntilGone(alive, () => killAt)) return;
    signalTree(pgid, tree, "SIGKILL", procRoot);
    const killWaitEnd = Date.now() + KILL_WAIT_MS;
    await waitUntilGone(alive, () => killWaitEnd);
  }
  return {
    done: escalate(),
    hurry(nextGraceMs) {
      killAt = Math.min(killAt, Date.now() + nextGraceMs);
    },
  };
}

// A walk error must neither block nor widen the kill: the group is still signalled, and only the
// descendants outside it are missed.
function walkTree(
  pgid: number,
  procRoot: string,
  report: (line: string) => void,
): ProcessTreeEntry[] {
  try {
    return walkProcessTree(pgid, procRoot);
  } catch (error) {
    report(`process tree walk failed, signalling the group only: ${errorMessage(error)}`);
    return [];
  }
}

// The group signal reaches every member still in the group, so only the walked processes outside
// it are signalled one by one: a second SIGTERM can cut a member's own shutdown short.
function signalTree(
  pgid: number,
  tree: ProcessTreeEntry[],
  signal: NodeJS.Signals,
  procRoot: string,
): void {
  sendSignal(-pgid, signal);
  for (const entry of tree) {
    const stat = readStat(entry.pid, procRoot);
    // A walked pid can belong to another process by now; the start time tells them apart.
    if (stat?.startTime === entry.startTime && stat.pgrp !== pgid) sendSignal(entry.pid, signal);
  }
}

function isStillRunning(entry: ProcessTreeEntry, procRoot: string): boolean {
  return readStat(entry.pid, procRoot)?.startTime === entry.startTime;
}

// null when the process is gone, when /proc does not exist, or when the line does not parse.
// stop() runs this inside the daemon, so no read error may escape.
function readStat(pid: number, procRoot: string): ProcStat | null {
  try {
    return parseStat(readFileSync(join(procRoot, String(pid), "stat"), "utf8"));
  } catch {
    return null;
  }
}

function readStartTime(pid: number, procRoot: string): number | null {
  return readStat(pid, procRoot)?.startTime ?? null;
}

function serverEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(STRIPPED_ENV_PREFIX) || STRIPPED_ENV_KEYS.has(key)) continue;
    env[key] = value;
  }
  return { ...env, ...overrides };
}

function forwardLines(stream: Readable, emit: (line: string) => void): void {
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  lines.on("line", (line) => emit(capLine(line)));
  lines.on("error", (error) => emit(`output error: ${error.message}`));
}

function capLine(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
}

// Written through a rename, so a daemon that dies mid-write leaves a stray .tmp file and never a
// truncated pid file.
function writePidFile(spec: SpawnSpec, pgid: number, procRoot: string): void {
  const record: PidRecord = {
    pgid,
    startTime: readStartTime(pgid, procRoot),
    ownerPid: process.pid,
    ownerStartTime: readStartTime(process.pid, procRoot),
  };
  const tmpFile = `${spec.pidFile}.tmp`;
  try {
    writeFileSync(tmpFile, `${JSON.stringify(record)}\n`);
    renameSync(tmpFile, spec.pidFile);
  } catch (error) {
    // Without its pid file nothing could reclaim the group after a daemon crash.
    sendSignal(-pgid, "SIGKILL");
    throw startFailure(spec, error);
  }
}

// spawnServer never leaves a file that does not parse, so one names no group of ours. It is removed
// and the call rejects, so the caller can report it.
async function readPidRecord(pidFile: string): Promise<PidRecord | null> {
  const text = await readTextIfExists(pidFile);
  if (text === null) return null;
  const record = PidRecordSchema.safeParse(parseJson(text));
  if (record.success) return record.data;
  await rm(pidFile, { force: true });
  throw new Error(`Removed unreadable pid file ${pidFile}`);
}

async function readTextIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// The same pid as this process means an earlier plugin run in this daemon, or a dead daemon whose
// pid this one reused: both are gone.
function ownerIsAlive(record: PidRecord): boolean {
  if (record.ownerPid === process.pid) return false;
  if (record.ownerStartTime === null) return sendSignal(record.ownerPid, 0);
  return readStartTime(record.ownerPid, DEFAULT_PROC_ROOT) === record.ownerStartTime;
}

// The kernel does not reuse a pid while a process group with that id exists, so a live group whose
// leader has exited is still the recorded one. A live leader must match the recorded start time.
function isRecordedGroup(record: PidRecord): boolean {
  if (record.startTime === null || !sendSignal(-record.pgid, 0)) return false;
  const leaderStartTime = readStartTime(record.pgid, DEFAULT_PROC_ROOT);
  return leaderStartTime === null || leaderStartTime === record.startTime;
}

// false when the target is gone (ESRCH) or belongs to someone else (EPERM).
function sendSignal(target: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(target, signal);
    return true;
  } catch {
    return false;
  }
}

// Polls until nothing is left or the deadline passes. The deadline is read on every poll, so a
// later stop() with a shorter grace brings the SIGKILL forward, at most POLL_MS after the deadline.
// Unref'd, so a pending stop never holds the daemon open on its own.
async function waitUntilGone(alive: () => boolean, deadline: () => number): Promise<boolean> {
  while (alive()) {
    if (Date.now() >= deadline()) return false;
    await delay(POLL_MS, undefined, { ref: false });
  }
  return true;
}

async function waitAtMost(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => resolve(), timeoutMs).unref();
  });
  await Promise.race([promise, timeout]);
  clearTimeout(timer);
}

function closeLog(log: WriteStream): Promise<void> {
  if (log.closed) return Promise.resolve();
  return new Promise((resolve) => {
    log.once("close", () => resolve());
    log.end();
  });
}

async function removePidFile(pidFile: string, onLine: (line: string) => void): Promise<void> {
  try {
    await rm(pidFile, { force: true });
  } catch (error) {
    onLine(`pid file not removed: ${errorMessage(error)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
