import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostSummary } from "../../shared/rpc.js";
import { readHostSummary } from "./host-summary.js";

const MEMINFO = [
  "MemTotal:       16042308 kB",
  "MemFree:         3529520 kB",
  "MemAvailable:    7686108 kB",
  "Buffers:         1041016 kB",
  "Cached:          2485564 kB",
  "SwapTotal:      12582908 kB",
  "SwapFree:        6615772 kB",
  "",
].join("\n");

let root: string;
let procRoot: string;
let cgroupRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rm-host-"));
  procRoot = join(root, "proc");
  cgroupRoot = join(root, "cgroup");
  mkdirSync(procRoot);
  mkdirSync(cgroupRoot);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeProc(name: string, text: string): void {
  writeFileSync(join(procRoot, name), text);
}

function writeCgroup(name: string, text: string): void {
  writeFileSync(join(cgroupRoot, name), text);
}

describe("readHostSummary", () => {
  it("reads an uncapped cgroup v2 container, as in this container", () => {
    writeProc("meminfo", MEMINFO);
    writeProc("loadavg", "1.54 1.88 2.22 1/10058 224556\n");
    writeCgroup("memory.current", "3221225472\n");
    writeCgroup("memory.max", "max\n");
    writeCgroup("memory.swap.current", "104857600\n");

    const expected: HostSummary = {
      memoryUsedBytes: 3221225472,
      memoryLimitBytes: null,
      swapUsedBytes: 104857600,
      swapTotalBytes: 12582908 * 1024,
      hostAvailableBytes: 7686108 * 1024,
      hostTotalBytes: 16042308 * 1024,
      load1: 1.54,
      load5: 1.88,
      load15: 2.22,
      cores: 2,
    };
    expect(readHostSummary({ procRoot, cgroupRoot, cores: 2 })).toEqual(expected);
  });

  it("reads a numeric memory.max as the cap", () => {
    writeProc("meminfo", MEMINFO);
    writeCgroup("memory.current", "1073741824\n");
    writeCgroup("memory.max", "8589934592\n");

    const summary = readHostSummary({ procRoot, cgroupRoot, cores: 4 });
    expect(summary.memoryUsedBytes).toBe(1073741824);
    expect(summary.memoryLimitBytes).toBe(8589934592);
  });

  it("falls back to SwapTotal - SwapFree without memory.swap.current", () => {
    writeProc("meminfo", MEMINFO);

    expect(readHostSummary({ procRoot, cgroupRoot, cores: 2 }).swapUsedBytes).toBe(
      (12582908 - 6615772) * 1024,
    );
  });

  it("returns nulls without cgroup v2 or /proc, and keeps the core count", () => {
    const expected: HostSummary = {
      memoryUsedBytes: null,
      memoryLimitBytes: null,
      swapUsedBytes: null,
      swapTotalBytes: null,
      hostAvailableBytes: null,
      hostTotalBytes: null,
      load1: null,
      load5: null,
      load15: null,
      cores: 8,
    };
    expect(readHostSummary({ procRoot, cgroupRoot, cores: 8 })).toEqual(expected);
  });

  it("treats a meminfo or loadavg that does not parse as unreadable", () => {
    writeProc("meminfo", "garbage\n");
    writeProc("loadavg", "garbage\n");

    const summary = readHostSummary({ procRoot, cgroupRoot, cores: 2 });
    expect(summary.hostTotalBytes).toBeNull();
    expect(summary.load1).toBeNull();
  });
});
