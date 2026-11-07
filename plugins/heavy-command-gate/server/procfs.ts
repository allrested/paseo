import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import type { ShimProcess } from "./protocol.js";

export interface PidSpace {
  pidNamespace: string | null;
  bootId: string | null;
  initStartTime: number | null;
}

const PID_ENTRY = /^\d+$/;
const VM_RSS_LINE = /^VmRSS:\s+(\d+) kB$/m;

// Field 2 (comm) is the raw process name and may hold spaces and parentheses, so fields are counted
// from the last ")". After ") " come [0] state, [1] ppid ... [19] starttime (field 22).
function statField(stat: string, index: number): number | null {
  const commEnd = stat.lastIndexOf(")");
  if (commEnd < 0) return null;
  const value = Number(stat.slice(commEnd + 2).split(" ")[index]);
  return Number.isSafeInteger(value) ? value : null;
}

export function parseStatPpid(stat: string): number | null {
  return statField(stat, 1);
}

export function parseStatStartTime(stat: string): number | null {
  return statField(stat, 19);
}

export function parseVmRssBytes(status: string): number | null {
  const match = VM_RSS_LINE.exec(status);
  return match ? Number(match[1]) * 1024 : null;
}

function readOrNull(read: () => string): string | null {
  try {
    return read();
  } catch {
    return null;
  }
}

export function readStartTime(pid: number, procRoot = "/proc"): number | null {
  const stat = readOrNull(() => readFileSync(join(procRoot, String(pid), "stat"), "utf8"));
  return stat === null ? null : parseStatStartTime(stat);
}

/** Which processes pids name here; each field is null without /proc. */
export function readPidSpace(procRoot = "/proc"): PidSpace {
  return {
    pidNamespace: readOrNull(() => readlinkSync(join(procRoot, "self", "ns", "pid"))),
    bootId: readOrNull(() =>
      readFileSync(join(procRoot, "sys", "kernel", "random", "boot_id"), "utf8").trim(),
    ),
    initStartTime: readStartTime(1, procRoot),
  };
}

// A namespace inode can be reissued to a restarted container on the same boot, and that
// container's pid 1 always starts later, so all three must match. Unknown never matches.
export function samePidSpace(a: PidSpace, b: PidSpace): boolean {
  return (
    a.pidNamespace !== null &&
    a.bootId !== null &&
    a.initStartTime !== null &&
    a.pidNamespace === b.pidNamespace &&
    a.bootId === b.bootId &&
    a.initStartTime === b.initStartTime
  );
}

/**
 * VmRSS of the pid and every descendant by ppid; null when none of them could be read. A process
 * without VmRSS (a zombie) adds 0. One /proc scan per call, synchronous like shared-mcp's walk.
 */
export function readTreeRss(rootPid: number, procRoot = "/proc"): number | null {
  let names: string[];
  try {
    names = readdirSync(procRoot);
  } catch {
    return null;
  }
  const children = new Map<number, number[]>();
  for (const name of names) {
    if (!PID_ENTRY.test(name)) continue;
    const stat = readOrNull(() => readFileSync(join(procRoot, name, "stat"), "utf8"));
    const ppid = stat === null ? null : parseStatPpid(stat);
    if (ppid === null) continue;
    const siblings = children.get(ppid);
    if (siblings) siblings.push(Number(name));
    else children.set(ppid, [Number(name)]);
  }
  // A Set iterator also visits members added during the loop, so this walks the whole subtree.
  const tree = new Set([rootPid]);
  for (const pid of tree) {
    for (const child of children.get(pid) ?? []) tree.add(child);
  }
  let total: number | null = null;
  for (const pid of tree) {
    const status = readOrNull(() => readFileSync(join(procRoot, String(pid), "status"), "utf8"));
    if (status !== null) total = (total ?? 0) + (parseVmRssBytes(status) ?? 0);
  }
  return total;
}

/** The RSS of a shim's process tree, or null when its pid may name another process by now. */
export function readShimRss(shim: ShimProcess, procRoot = "/proc"): number | null {
  if (shim.startTime === null) return null;
  if (!samePidSpace(shim, readPidSpace(procRoot))) return null;
  if (readStartTime(shim.pid, procRoot) !== shim.startTime) return null;
  return readTreeRss(shim.pid, procRoot);
}
