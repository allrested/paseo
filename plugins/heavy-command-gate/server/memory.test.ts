import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseCgroupV2Path,
  parseMemAvailableBytes,
  readFreeMemory,
  type MemoryRoots,
} from "./memory.js";

const GIB = 1024 ** 3;
const KIB_PER_GIB = 1024 * 1024;

let root = "";
let roots: MemoryRoots = { procRoot: "", cgroupRoot: "" };

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function meminfo(availableGib: number): string {
  return [
    "MemTotal:       16303932 kB",
    "MemFree:          811244 kB",
    `MemAvailable:   ${availableGib * KIB_PER_GIB} kB`,
    "Buffers:          120000 kB",
    "",
  ].join("\n");
}

// The daemon's cgroup v2 entry and its memory files, as a container sees them.
function writeCgroup(path: string, max: string, currentGib: number): void {
  write(join(roots.procRoot, "self", "cgroup"), `0::${path}\n`);
  const directory = join(roots.cgroupRoot, path);
  write(join(directory, "memory.max"), `${max}\n`);
  write(join(directory, "memory.current"), `${currentGib * GIB}\n`);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "heavy-gate-memory-"));
  roots = { procRoot: join(root, "proc"), cgroupRoot: join(root, "cgroup") };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("parseMemAvailableBytes", () => {
  it("reads the MemAvailable line in bytes", () => {
    expect(parseMemAvailableBytes(meminfo(4))).toBe(4 * GIB);
  });

  it("returns null without a MemAvailable line", () => {
    expect(parseMemAvailableBytes("MemTotal:       16303932 kB\n")).toBeNull();
  });
});

describe("parseCgroupV2Path", () => {
  it("reads the unified hierarchy path", () => {
    expect(parseCgroupV2Path("0::/system.slice/docker-abc.scope\n")).toBe(
      "/system.slice/docker-abc.scope",
    );
  });

  it("returns null on a cgroup v1 system", () => {
    expect(parseCgroupV2Path("12:memory:/docker/abc\n11:cpu,cpuacct:/docker/abc\n")).toBeNull();
  });
});

describe("readFreeMemory", () => {
  it("takes the cgroup headroom when it is smaller than MemAvailable", () => {
    write(join(roots.procRoot, "meminfo"), meminfo(4));
    writeCgroup("/paseo", String(6 * GIB), 5);
    expect(readFreeMemory(roots)).toBe(GIB);
  });

  it("takes MemAvailable when it is smaller than the cgroup headroom", () => {
    write(join(roots.procRoot, "meminfo"), meminfo(2));
    writeCgroup("/", String(8 * GIB), 1);
    expect(readFreeMemory(roots)).toBe(2 * GIB);
  });

  it("uses MemAvailable alone when the cgroup has no limit", () => {
    write(join(roots.procRoot, "meminfo"), meminfo(4));
    writeCgroup("/paseo", "max", 5);
    expect(readFreeMemory(roots)).toBe(4 * GIB);
  });

  it("uses MemAvailable alone on a cgroup v1 system", () => {
    write(join(roots.procRoot, "meminfo"), meminfo(4));
    write(join(roots.procRoot, "self", "cgroup"), "12:memory:/docker/abc\n");
    expect(readFreeMemory(roots)).toBe(4 * GIB);
  });

  it("counts a cgroup above its limit as no headroom", () => {
    write(join(roots.procRoot, "meminfo"), meminfo(4));
    writeCgroup("/paseo", String(2 * GIB), 3);
    expect(readFreeMemory(roots)).toBe(0);
  });

  it("returns null without /proc", () => {
    expect(readFreeMemory(roots)).toBeNull();
  });
});
