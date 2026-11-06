import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ProcStat {
  ppid: number;
  pgrp: number;
  startTime: number;
}

export interface ProcessTreeEntry {
  pid: number;
  startTime: number;
}

interface ProcEntry extends ProcStat {
  pid: number;
}

export class ProcStatParseError extends Error {
  readonly stat: string;

  constructor(stat: string) {
    super(`Unrecognised /proc/<pid>/stat line: ${stat.slice(0, 120)}`);
    this.name = "ProcStatParseError";
    this.stat = stat;
  }
}

const PID_ENTRY = /^\d+$/;
const VM_RSS_LINE = /^VmRSS:\s+(\d+) kB$/m;

// Field 2 (comm) is the raw process name and may hold spaces and parentheses, so fields are
// counted from the last ")". After ") " come 3 state, 4 ppid, 5 pgrp ... 22 starttime (ticks).
export function parseStat(stat: string): ProcStat {
  const commEnd = stat.lastIndexOf(")");
  const fields = stat.slice(commEnd + 2).split(" ");
  const ppid = Number(fields[1]);
  const pgrp = Number(fields[2]);
  const startTime = Number(fields[19]);
  if (commEnd < 0 || ![ppid, pgrp, startTime].every(Number.isSafeInteger)) {
    throw new ProcStatParseError(stat);
  }
  return { ppid, pgrp, startTime };
}

export function parseVmRssBytes(status: string): number | null {
  const match = VM_RSS_LINE.exec(status);
  return match ? Number(match[1]) * 1024 : null;
}

// ENOENT: the entry is gone, or /proc itself is missing (not Linux). ESRCH: the task exited
// after its /proc directory was looked up.
function isGone(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ESRCH")
  );
}

function unlessGone<T>(read: () => T): T | null {
  try {
    return read();
  } catch (error) {
    if (isGone(error)) return null;
    throw error;
  }
}

// A stat line that does not parse gives no ppid or pgrp to place the entry by, so it is skipped
// instead of failing the scan for every other process.
function toProcEntry(name: string, stat: string): ProcEntry | null {
  try {
    return { pid: Number(name), ...parseStat(stat) };
  } catch (error) {
    if (error instanceof ProcStatParseError) return null;
    throw error;
  }
}

function readProcTable(procRoot: string): ProcEntry[] {
  const table: ProcEntry[] = [];
  for (const name of unlessGone(() => readdirSync(procRoot)) ?? []) {
    if (!PID_ENTRY.test(name)) continue;
    const stat = unlessGone(() => readFileSync(join(procRoot, name, "stat"), "utf8"));
    const entry = stat === null ? null : toProcEntry(name, stat);
    if (entry !== null) table.push(entry);
  }
  return table;
}

// The group's members plus everything descended from them by ppid, each with its start time. Some
// servers start children in a session of their own (Serena does this with its language servers),
// and those still belong to the server.
//
// Synchronous on purpose. When a process exits, its children are reparented to init and the ppid
// link is gone, so a scan that yields while a stop signal is on its way loses the setsid'd
// children. The stop path calls this before its first signal, then signals the group and every
// pid returned. /proc reads never wait on a disk: 109 processes took about 1.3 ms here, and one
// read at a time keeps a single file descriptor open.
export function walkProcessTree(pgid: number, procRoot = "/proc"): ProcessTreeEntry[] {
  const table = readProcTable(procRoot);
  const children = new Map<number, ProcEntry[]>();
  for (const entry of table) {
    const siblings = children.get(entry.ppid);
    if (siblings) siblings.push(entry);
    else children.set(entry.ppid, [entry]);
  }
  const tree = new Set(table.filter((entry) => entry.pgrp === pgid));
  // A Set iterator also visits members added during the loop, so this walks the whole subtree.
  for (const member of tree) {
    for (const child of children.get(member.pid) ?? []) tree.add(child);
  }
  return [...tree].map(({ pid, startTime }) => ({ pid, startTime }));
}

// The pids of walkProcessTree. The walk ends before the promise is returned, so a caller can
// signal the group on the next line and still get the tree as it was before the signal.
export async function listProcessTree(pgid: number, procRoot = "/proc"): Promise<number[]> {
  return walkProcessTree(pgid, procRoot).map((entry) => entry.pid);
}

// null when no process of the tree could be read. A zombie or a kernel thread has no VmRSS line
// and adds 0.
export async function readProcessGroupRss(
  pgid: number,
  procRoot = "/proc",
): Promise<number | null> {
  let total: number | null = null;
  for (const { pid } of walkProcessTree(pgid, procRoot)) {
    const status = unlessGone(() => readFileSync(join(procRoot, String(pid), "status"), "utf8"));
    if (status !== null) total = (total ?? 0) + (parseVmRssBytes(status) ?? 0);
  }
  return total;
}
