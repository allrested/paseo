import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShimProcess } from "./protocol.js";
import {
  parseStatPpid,
  parseStatStartTime,
  parseVmRssBytes,
  readPidSpace,
  readShimRss,
  readStartTime,
  readTreeRss,
  samePidSpace,
  type PidSpace,
} from "./procfs.js";

const MIB = 1024 * 1024;
const SPACE: PidSpace = { pidNamespace: "pid:[4026531836]", bootId: "boot-1", initStartTime: 7 };
const UNKNOWN_SPACE: PidSpace = { pidNamespace: null, bootId: null, initStartTime: null };

let procRoot = "";

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

// A /proc/<pid>/stat line: after "(comm) " come state, ppid, pgrp ... and field 22, starttime.
function statLine(pid: number, comm: string, ppid: number, startTime: number): string {
  const fields = ["S", ppid, pid, pid, 0, -1, 4194560, 100, 0, 0, 0, 5, 2, 0, 0, 20, 0, 1, 0];
  fields.push(startTime, 1000, 200);
  return `${pid} (${comm}) ${fields.join(" ")}\n`;
}

// rssKb null writes a status without VmRSS, as a zombie or a kernel thread has.
function addProcess(pid: number, ppid: number, startTime: number, rssKb: number | null): void {
  write(join(procRoot, String(pid), "stat"), statLine(pid, "node", ppid, startTime));
  const rss = rssKb === null ? "State:\tZ (zombie)\n" : `VmRSS:\t  ${rssKb} kB\n`;
  write(join(procRoot, String(pid), "status"), `Name:\tnode\n${rss}`);
}

function writePidSpace(space: PidSpace): void {
  mkdirSync(join(procRoot, "self", "ns"), { recursive: true });
  symlinkSync(space.pidNamespace ?? "", join(procRoot, "self", "ns", "pid"));
  write(join(procRoot, "sys", "kernel", "random", "boot_id"), `${space.bootId}\n`);
  addProcess(1, 0, space.initStartTime ?? 0, 1000);
}

function shim(pid: number, startTime: number, space: PidSpace = SPACE): ShimProcess {
  return { pid, startTime, ...space };
}

beforeEach(() => {
  procRoot = join(mkdtempSync(join(tmpdir(), "heavy-gate-procfs-")), "proc");
  mkdirSync(procRoot);
});

afterEach(() => {
  rmSync(dirname(procRoot), { recursive: true, force: true });
});

describe("stat and status parsers", () => {
  it("count fields from the last parenthesis, past a name holding spaces and parentheses", () => {
    const stat = statLine(42, "my (odd) name", 7, 123456);
    expect(parseStatPpid(stat)).toBe(7);
    expect(parseStatStartTime(stat)).toBe(123456);
  });

  it("return null for a line without a name", () => {
    expect(parseStatPpid("42 S 7")).toBeNull();
    expect(parseStatStartTime("42 S 7")).toBeNull();
  });

  it("read VmRSS in bytes, and null without the line", () => {
    expect(parseVmRssBytes("Name:\tnode\nVmRSS:\t  2048 kB\n")).toBe(2 * MIB);
    expect(parseVmRssBytes("Name:\tnode\n")).toBeNull();
  });
});

describe("readStartTime", () => {
  it("reads a pid's start time, and null once the pid is gone", () => {
    addProcess(500, 1, 9000, 10);
    expect(readStartTime(500, procRoot)).toBe(9000);
    expect(readStartTime(501, procRoot)).toBeNull();
  });
});

describe("readPidSpace", () => {
  it("reads the pid namespace, the boot id and the start time of pid 1", () => {
    writePidSpace(SPACE);
    expect(readPidSpace(procRoot)).toEqual(SPACE);
  });

  it("reads nulls without /proc", () => {
    expect(readPidSpace(join(procRoot, "missing"))).toEqual(UNKNOWN_SPACE);
  });
});

describe("samePidSpace", () => {
  it("needs every field known and equal", () => {
    expect(samePidSpace(SPACE, { ...SPACE })).toBe(true);
    expect(samePidSpace(SPACE, { ...SPACE, bootId: "boot-2" })).toBe(false);
    expect(samePidSpace(SPACE, { ...SPACE, initStartTime: 8 })).toBe(false);
    expect(samePidSpace(UNKNOWN_SPACE, UNKNOWN_SPACE)).toBe(false);
  });
});

describe("readTreeRss", () => {
  it("sums the pid and every descendant, and nothing else", () => {
    addProcess(100, 1, 10, 1024);
    addProcess(101, 100, 11, 2048);
    addProcess(102, 101, 12, 4096);
    addProcess(200, 1, 13, 8192);
    expect(readTreeRss(100, procRoot)).toBe(7 * MIB);
  });

  it("counts a process without VmRSS as 0, and returns null once the pid is gone", () => {
    addProcess(100, 1, 10, 1024);
    addProcess(101, 100, 11, null);
    expect(readTreeRss(100, procRoot)).toBe(MIB);
    expect(readTreeRss(300, procRoot)).toBeNull();
  });
});

describe("readShimRss", () => {
  it("reads the shim's tree when its pid space and start time match", () => {
    writePidSpace(SPACE);
    addProcess(100, 1, 10, 1024);
    addProcess(101, 100, 11, 3072);
    expect(readShimRss(shim(100, 10), procRoot)).toBe(4 * MIB);
  });

  it("returns null once the pid names a later process", () => {
    writePidSpace(SPACE);
    addProcess(100, 1, 99, 1024);
    expect(readShimRss(shim(100, 10), procRoot)).toBeNull();
  });

  it("returns null for a shim from another pid namespace", () => {
    writePidSpace(SPACE);
    addProcess(100, 1, 10, 1024);
    const elsewhere = { ...SPACE, pidNamespace: "pid:[4026532999]" };
    expect(readShimRss(shim(100, 10, elsewhere), procRoot)).toBeNull();
  });
});
