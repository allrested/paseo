import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface MemoryRoots {
  procRoot: string;
  cgroupRoot: string;
}

const DEFAULT_ROOTS: MemoryRoots = { procRoot: "/proc", cgroupRoot: "/sys/fs/cgroup" };
const MEM_AVAILABLE_LINE = /^MemAvailable:\s+(\d+) kB$/m;
// The unified (v2) hierarchy is the line with hierarchy id 0 and no controller list.
const CGROUP_V2_LINE = /^0::(\/.*)$/m;
const COUNT = /^\d+$/;

export function parseMemAvailableBytes(meminfo: string): number | null {
  const match = MEM_AVAILABLE_LINE.exec(meminfo);
  return match ? Number(match[1]) * 1024 : null;
}

/** This process's cgroup v2 path from /proc/self/cgroup; null on a cgroup v1 system. */
export function parseCgroupV2Path(cgroup: string): string | null {
  const match = CGROUP_V2_LINE.exec(cgroup);
  return match ? match[1] : null;
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// "max" (no limit), a missing file and anything that is not a byte count read as null.
function readCount(path: string): number | null {
  const text = readText(path)?.trim();
  if (text === undefined || !COUNT.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

// memory.max minus memory.current of the daemon's own cgroup. Agents and their commands are the
// daemon's descendants, so they share it. A hybrid v1/v2 host has no memory files in the v2
// hierarchy and falls back to MemAvailable alone.
function readCgroupHeadroom(roots: MemoryRoots): number | null {
  const cgroup = readText(join(roots.procRoot, "self", "cgroup"));
  const path = cgroup === null ? null : parseCgroupV2Path(cgroup);
  if (path === null) return null;
  const directory = join(roots.cgroupRoot, path);
  const max = readCount(join(directory, "memory.max"));
  const current = readCount(join(directory, "memory.current"));
  if (max === null || current === null) return null;
  return Math.max(0, max - current);
}

/**
 * The spec's memory signal: the smaller of the host's MemAvailable (a container sees the host's
 * /proc/meminfo, so the other instance and the browsers count) and the cgroup v2 headroom. Null
 * without /proc, and the gate then admits on slots alone. Synchronous: /proc and cgroupfs reads
 * never wait on a disk, and the gate calls this every 2 s at most.
 */
export function readFreeMemory(roots: MemoryRoots = DEFAULT_ROOTS): number | null {
  const meminfo = readText(join(roots.procRoot, "meminfo"));
  const available = meminfo === null ? null : parseMemAvailableBytes(meminfo);
  const headroom = readCgroupHeadroom(roots);
  if (available === null) return headroom;
  if (headroom === null) return available;
  return Math.min(available, headroom);
}
