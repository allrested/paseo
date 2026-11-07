import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostSummary } from "../../shared/rpc.js";
import { parseLoadavg, parseMeminfo, ProcTextError } from "../proc-text.js";

export interface HostPaths {
  procRoot: string;
  /** The cgroup v2 directory of this container: /sys/fs/cgroup under a cgroup namespace. */
  cgroupRoot: string;
  /** os.availableParallelism() in the daemon. */
  cores: number;
}

const BYTE_COUNT = /^\d+$/;

function readText(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function parsed<T>(file: string, parse: (text: string) => T): T | null {
  const text = readText(file);
  if (text === null) return null;
  try {
    return parse(text);
  } catch (error) {
    if (error instanceof ProcTextError) return null;
    throw error;
  }
}

// A cgroup v2 memory file. "max" (no cap), a missing file (cgroup v1, or no cgroup mount) and
// anything that is not a byte count read as null.
function readCgroupBytes(file: string): number | null {
  const text = readText(file)?.trim();
  if (text === undefined || !BYTE_COUNT.test(text)) return null;
  return Number(text);
}

export function readHostSummary({ procRoot, cgroupRoot, cores }: HostPaths): HostSummary {
  const meminfo = parsed(join(procRoot, "meminfo"), parseMeminfo);
  const load = parsed(join(procRoot, "loadavg"), parseLoadavg);
  const hostSwapUsed = meminfo === null ? null : meminfo.swapTotalBytes - meminfo.swapFreeBytes;
  return {
    memoryUsedBytes: readCgroupBytes(join(cgroupRoot, "memory.current")),
    memoryLimitBytes: readCgroupBytes(join(cgroupRoot, "memory.max")),
    swapUsedBytes: readCgroupBytes(join(cgroupRoot, "memory.swap.current")) ?? hostSwapUsed,
    swapTotalBytes: meminfo?.swapTotalBytes ?? null,
    hostAvailableBytes: meminfo?.availableBytes ?? null,
    hostTotalBytes: meminfo?.totalBytes ?? null,
    load1: load?.load1 ?? null,
    load5: load?.load5 ?? null,
    load15: load?.load15 ?? null,
    cores,
  };
}
