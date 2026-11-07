import {
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { parseStat } from "./local/procfs.js";

// The record shared-mcp writes (plugins/shared-mcp/server/process-runner.ts:56-64), so one reader
// serves both plugins' files. startTime is field 22 of /proc/<pid>/stat: with ownerPid it tells a
// file left by a dead daemon from one a live daemon owns, and a group from a later process that
// reuses its pid. pidNamespace, bootId and initStartTime say which processes the pids name: after
// a container restart or a reboot the same pids name others. A record lacking any of them is stale.
export const PidRecordSchema = z.object({
  pgid: z.number().int(),
  startTime: z.number().int().nullable(),
  ownerPid: z.number().int().positive(),
  ownerStartTime: z.number().int().nullable(),
  pidNamespace: z.string().nullish(),
  bootId: z.string().nullish(),
  initStartTime: z.number().int().nullish(),
});
export type PidRecord = z.output<typeof PidRecordSchema>;

export interface PidSpace {
  pidNamespace: string | null;
  bootId: string | null;
  initStartTime: number | null;
}

export type ReclaimOutcome = "kept" | "stale" | "killed";

const KILL_GRACE_MS = 2_000;
const POLL_MS = 50;
const PID_FILE = /\.pid$/;

function readOrNull(read: () => string): string | null {
  try {
    return read();
  } catch {
    return null;
  }
}

export function readStartTime(pid: number, procRoot: string): number | null {
  const stat = readOrNull(() => readFileSync(join(procRoot, String(pid), "stat"), "utf8"));
  if (stat === null) return null;
  try {
    return parseStat(stat).startTime;
  } catch {
    return null;
  }
}

// The pid namespace (`pid:[<inode>]`), the boot this process runs in, and the start time of the
// namespace's pid 1 (a namespace inode can be reissued to a restarted container on the same boot,
// whose pid 1 starts later). Each is null without /proc.
export function readPidSpace(procRoot: string): PidSpace {
  return {
    pidNamespace: readOrNull(() => readlinkSync(join(procRoot, "self", "ns", "pid"))),
    bootId: readOrNull(() =>
      readFileSync(join(procRoot, "sys", "kernel", "random", "boot_id"), "utf8").trim(),
    ),
    initStartTime: readStartTime(1, procRoot),
  };
}

// False when the record comes from another pid namespace, boot or container run, does not say,
// or this process cannot tell its own.
export function isCurrentPidSpace(record: PidRecord, procRoot: string): boolean {
  const current = readPidSpace(procRoot);
  return (
    current.pidNamespace !== null &&
    current.bootId !== null &&
    current.initStartTime !== null &&
    record.pidNamespace === current.pidNamespace &&
    record.bootId === current.bootId &&
    record.initStartTime === current.initStartTime
  );
}

// false when the target is gone (ESRCH) or belongs to someone else (EPERM).
export function sendSignal(target: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(target, signal);
    return true;
  } catch {
    return false;
  }
}

// The same pid as this process means an earlier plugin run in this daemon, or a dead daemon whose
// pid this one reused: both are gone.
export function ownerIsAlive(record: PidRecord, procRoot: string, selfPid = process.pid): boolean {
  if (record.ownerPid === selfPid) return false;
  if (record.ownerStartTime === null) return sendSignal(record.ownerPid, 0);
  return readStartTime(record.ownerPid, procRoot) === record.ownerStartTime;
}

// A live leader must match the recorded start time. A live group whose leader has exited is taken
// to be the recorded one: the kernel does not reuse a pid while a group with that id exists. Same
// rule as shared-mcp's isRecordedGroup (process-runner.ts:472-476).
export function isRecordedGroup(record: PidRecord, procRoot: string): boolean {
  if (record.startTime === null || !sendSignal(-record.pgid, 0)) return false;
  const leaderStartTime = readStartTime(record.pgid, procRoot);
  return leaderStartTime === null || leaderStartTime === record.startTime;
}

// Written through a rename, so a daemon that dies mid-write leaves a stray .tmp file and never a
// truncated pid file. Throws when the file cannot be written; the caller kills the group then.
export function writePidFile(file: string, pgid: number, procRoot: string): void {
  const record: PidRecord = {
    pgid,
    startTime: readStartTime(pgid, procRoot),
    ownerPid: process.pid,
    ownerStartTime: readStartTime(process.pid, procRoot),
    ...readPidSpace(procRoot),
  };
  const tmpFile = `${file}.tmp`;
  writeFileSync(tmpFile, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  renameSync(tmpFile, file);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// null for a missing file and for one that does not hold a record.
export function readPidRecord(file: string): PidRecord | null {
  const text = readOrNull(() => readFileSync(file, "utf8"));
  if (text === null) return null;
  const record = PidRecordSchema.safeParse(parseJson(text));
  return record.success ? record.data : null;
}

export function removePidFile(file: string): void {
  rmSync(file, { force: true });
}

export function listPidFiles(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((name) => PID_FILE.test(name)).sort();
}

// SIGTERM to the group, then SIGKILL once graceMs passes with a member left. Group 0 is every
// kernel thread and group 1 the init tree, so those are never signalled. The waits are unref'd,
// so a pending kill never holds the daemon open.
export async function killGroup(pgid: number, graceMs = KILL_GRACE_MS): Promise<void> {
  if (pgid <= 1 || !sendSignal(-pgid, "SIGTERM")) return;
  const deadline = Date.now() + graceMs;
  while (sendSignal(-pgid, 0)) {
    if (Date.now() >= deadline) {
      sendSignal(-pgid, "SIGKILL");
      return;
    }
    await delay(POLL_MS, undefined, { ref: false });
  }
}

// A file from another pid space, or naming no live recorded group, is stale and only removed. A
// file whose owner is dead and whose group is still the recorded one gets the group killed first.
// A file whose owner lives is left alone: another daemon on the same PASEO_HOME owns it.
export async function reclaimPidFile(
  file: string,
  procRoot: string,
  selfPid = process.pid,
): Promise<ReclaimOutcome> {
  const record = readPidRecord(file);
  if (record !== null && record.pgid > 1 && isCurrentPidSpace(record, procRoot)) {
    if (ownerIsAlive(record, procRoot, selfPid)) return "kept";
    if (isRecordedGroup(record, procRoot)) {
      await killGroup(record.pgid);
      removePidFile(file);
      return "killed";
    }
  }
  removePidFile(file);
  return "stale";
}
