import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseStat,
  parseVmRssBytes,
  ProcStatParseError,
  readProcessGroupRss,
  walkProcessTree,
  type ProcessTreeEntry,
} from "./procfs.js";

// comm "x) R 1 700 (y": a parser that splits at the first ")" reads ppid 1 and pgrp 700.
const TRICKY_COMM_STAT =
  "4242 (x) R 1 700 (y) S 501 500 500 0 -1 4194304 2283 0 0 0 9 2 0 0 20 0 11 0 5339488 " +
  "1236512768 10960 18446744073709551615 1 1 0 0 0 0 0 16781312 17442 0 0 0 17 3 0 0 0 0 0 0 0 " +
  "0 0 0 0 0 0\n";

const KERNEL_THREAD_STAT =
  "37 (kworker/0:1-events) I 2 0 0 0 -1 69238880 0 0 0 0 0 4 0 0 20 0 1 0 312 0 0 " +
  "18446744073709551615 0 0 0 0 0 0 0 2147483647 0 0 0 0 17 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n";

// VmHWM sits right before VmRSS in a real status file, so the parser must not take it.
const PROCESS_STATUS =
  "Name:\tnode\nUmask:\t0022\nState:\tS (sleeping)\nTgid:\t4242\nPid:\t4242\nPPid:\t1\n" +
  "VmPeak:\t 1236512 kB\nVmSize:\t 1207532 kB\nVmHWM:\t   61236 kB\nVmRSS:\t   43840 kB\n" +
  "RssAnon:\t   30212 kB\nThreads:\t11\n";

const KERNEL_THREAD_STATUS =
  "Name:\tkworker/0:1-events\nUmask:\t0000\nState:\tI (idle)\nTgid:\t37\nPid:\t37\nPPid:\t2\n" +
  "Kthread:\t1\nThreads:\t1\n";

describe("parseStat", () => {
  it("counts fields from the last parenthesis, so comm may hold spaces and parentheses", () => {
    expect(parseStat(TRICKY_COMM_STAT)).toEqual({ ppid: 501, pgrp: 500, startTime: 5339488 });
  });

  it("reads a kernel thread", () => {
    expect(parseStat(KERNEL_THREAD_STAT)).toEqual({ ppid: 2, pgrp: 0, startTime: 312 });
  });

  it("rejects a line without a comm field or cut short before starttime", () => {
    expect(() => parseStat("4242 truncated")).toThrow(ProcStatParseError);
    expect(() => parseStat("4242 (node) S 1 4242 4242 0 -1\n")).toThrow(ProcStatParseError);
  });
});

describe("parseVmRssBytes", () => {
  it("converts the VmRSS line from kB to bytes, ignoring VmHWM", () => {
    expect(parseVmRssBytes(PROCESS_STATUS)).toBe(43840 * 1024);
  });

  it("reads a zero VmRSS as zero bytes", () => {
    expect(parseVmRssBytes("Name:\tsleep\nVmRSS:\t       0 kB\nThreads:\t1\n")).toBe(0);
  });

  it("returns null for a kernel thread, which has no VmRSS line", () => {
    expect(parseVmRssBytes(KERNEL_THREAD_STATUS)).toBeNull();
  });
});

interface FakeProcess {
  pid: number;
  comm: string;
  ppid: number;
  pgrp: number;
  state: string;
  rssKb: number | null;
}

// starttime (field 22) is pid * 10, so a test can tell which process a start time came from.
function statLine(fake: FakeProcess): string {
  return (
    `${fake.pid} (${fake.comm}) ${fake.state} ${fake.ppid} ${fake.pgrp} ${fake.pgrp} 0 -1 ` +
    `4194560 964 0 2 0 20 56 0 0 20 0 1 0 ${fake.pid * 10} 2273280 121 18446744073709551615 ` +
    "1 1 0 0 0 0 0 3145728 0 0 0 0 17 1 0 0 0 0 0 0 0 0 0 0 0 0 0\n"
  );
}

function statusText(fake: FakeProcess): string {
  const memory =
    fake.rssKb === null
      ? ""
      : `VmHWM:\t ${fake.rssKb * 2} kB\nVmRSS:\t ${fake.rssKb} kB\nRssAnon:\t ${fake.rssKb} kB\n`;
  return (
    `Name:\t${fake.comm}\nState:\t${fake.state}\nTgid:\t${fake.pid}\nPid:\t${fake.pid}\n` +
    `PPid:\t${fake.ppid}\n${memory}Threads:\t1\n`
  );
}

function writeProcess(procRoot: string, entry: string, fake: FakeProcess): void {
  mkdirSync(join(procRoot, entry), { recursive: true });
  writeFileSync(join(procRoot, entry, "stat"), statLine(fake));
  writeFileSync(join(procRoot, entry, "status"), statusText(fake));
}

function ascending(a: number, b: number): number {
  return a - b;
}

function byPid(a: ProcessTreeEntry, b: ProcessTreeEntry): number {
  return a.pid - b.pid;
}

// Group 500 is the server: sh -> npm exec -> a child with a hostile comm, plus a zombie. 600 and
// 601 are a language server that called setsid, so they sit in their own group under 501.
const FAKE_PROCESSES: FakeProcess[] = [
  { pid: 1, comm: "tini", ppid: 0, pgrp: 1, state: "S", rssKb: 484 },
  { pid: 2, comm: "kthreadd", ppid: 0, pgrp: 0, state: "S", rssKb: null },
  { pid: 37, comm: "kworker/0:1-events", ppid: 2, pgrp: 0, state: "I", rssKb: null },
  { pid: 500, comm: "sh", ppid: 1, pgrp: 500, state: "S", rssKb: 1000 },
  { pid: 501, comm: "npm exec @upsta", ppid: 500, pgrp: 500, state: "S", rssKb: 50000 },
  { pid: 502, comm: "x) R 1 700 (y", ppid: 501, pgrp: 500, state: "S", rssKb: 2000 },
  { pid: 503, comm: "node", ppid: 500, pgrp: 500, state: "Z", rssKb: null },
  { pid: 600, comm: "uvx", ppid: 501, pgrp: 600, state: "S", rssKb: 40000 },
  { pid: 601, comm: "pyright-langse", ppid: 600, pgrp: 600, state: "S", rssKb: 4000 },
  { pid: 700, comm: "bash", ppid: 1, pgrp: 700, state: "S", rssKb: 3000 },
  { pid: 701, comm: "tail (logs)", ppid: 700, pgrp: 700, state: "S", rssKb: 900 },
  { pid: 900, comm: "sh", ppid: 1, pgrp: 900, state: "Z", rssKb: null },
];

describe("process tree over a fake /proc", () => {
  let procRoot: string;

  beforeEach(() => {
    procRoot = mkdtempSync(join(tmpdir(), "shared-mcp-proc-"));
    for (const fake of FAKE_PROCESSES) writeProcess(procRoot, String(fake.pid), fake);
    // Exited between readdir and the stat read.
    mkdirSync(join(procRoot, "504"));
    // Exited between the stat read and the status read.
    mkdirSync(join(procRoot, "505"));
    writeFileSync(
      join(procRoot, "505", "stat"),
      statLine({ pid: 505, comm: "node", ppid: 500, pgrp: 500, state: "S", rssKb: null }),
    );
    // A stat line cut short before pgrp: skipped, and it must not fail the scan of the others.
    mkdirSync(join(procRoot, "506"));
    writeFileSync(join(procRoot, "506", "stat"), "506 (node) S 500\n");
    // Non-numeric entries holding pid-like files must be skipped, or group 500 double-counts.
    const impostor: FakeProcess = {
      pid: 500,
      comm: "sh",
      ppid: 1,
      pgrp: 500,
      state: "S",
      rssKb: 99999,
    };
    writeProcess(procRoot, "self", impostor);
    writeProcess(procRoot, "1x", impostor);
    mkdirSync(join(procRoot, "sys"));
    writeFileSync(join(procRoot, "uptime"), "5339.48 21003.11\n");
  });

  afterEach(() => {
    rmSync(procRoot, { recursive: true, force: true });
  });

  it("walks the group's members and the descendants that left the group, with start times", () => {
    // 600 and 601 called setsid. Their group is 600, so only the ppid chain 501 -> 600 -> 601
    // reaches them from group 500.
    expect(walkProcessTree(500, procRoot).toSorted(byPid)).toEqual([
      { pid: 500, startTime: 5000 },
      { pid: 501, startTime: 5010 },
      { pid: 502, startTime: 5020 },
      { pid: 503, startTime: 5030 },
      { pid: 505, startTime: 5050 },
      { pid: 600, startTime: 6000 },
      { pid: 601, startTime: 6010 },
    ]);
    expect(walkProcessTree(700, procRoot).toSorted(byPid)).toEqual([
      { pid: 700, startTime: 7000 },
      { pid: 701, startTime: 7010 },
    ]);
  });

  it("passes over a pid that vanished mid-walk and a stat line that does not parse", () => {
    const pids = walkProcessTree(500, procRoot).map((entry) => entry.pid);

    // 504 has no stat file and 506 a stat line cut short, so neither can be placed in the tree.
    expect(pids).not.toContain(504);
    expect(pids).not.toContain(506);
    // 505 only lost its status file, which the walk never reads.
    expect(pids).toContain(505);
  });

  it("still finds the members and the setsid'd descendants when the group leader is gone", () => {
    rmSync(join(procRoot, "500"), { recursive: true });

    expect(
      walkProcessTree(500, procRoot)
        .map((entry) => entry.pid)
        .toSorted(ascending),
    ).toEqual([501, 502, 503, 505, 600, 601]);
  });

  it("returns an empty walk for a group with no process or a missing /proc root", () => {
    expect(walkProcessTree(800, procRoot)).toEqual([]);
    expect(walkProcessTree(500, join(procRoot, "missing"))).toEqual([]);
  });

  it("throws on a filesystem error that is not a vanished entry; the RSS reader rejects", async () => {
    // A directory where the stat file should be: readFileSync fails with EISDIR.
    mkdirSync(join(procRoot, "507", "stat"), { recursive: true });

    expect(() => walkProcessTree(500, procRoot)).toThrow(/EISDIR/);
    await expect(readProcessGroupRss(500, procRoot)).rejects.toThrow(/EISDIR/);
  });

  it("sums VmRSS over the tree; members without VmRSS or already gone add zero", async () => {
    expect(await readProcessGroupRss(500, procRoot)).toBe(
      (1000 + 50000 + 2000 + 40000 + 4000) * 1024,
    );
    expect(await readProcessGroupRss(700, procRoot)).toBe((3000 + 900) * 1024);
  });

  it("returns zero for a group whose only member is a zombie", async () => {
    expect(await readProcessGroupRss(900, procRoot)).toBe(0);
  });

  it("returns null for a group with no process", async () => {
    expect(await readProcessGroupRss(800, procRoot)).toBeNull();
  });

  it("returns null when the /proc root does not exist", async () => {
    const missing = join(procRoot, "missing");
    expect(await readProcessGroupRss(500, missing)).toBeNull();
  });
});

describe("process tree over the real /proc", () => {
  it.runIf(process.platform === "linux")("finds this process in its own group", async () => {
    const own = parseStat(await readFile("/proc/self/stat", "utf8"));
    const pidMax = Number((await readFile("/proc/sys/kernel/pid_max", "utf8")).trim());

    expect(walkProcessTree(own.pgrp)).toContainEqual({
      pid: process.pid,
      startTime: own.startTime,
    });
    const rss = await readProcessGroupRss(own.pgrp);
    expect(rss).toBeGreaterThan(0);
    expect((rss ?? Number.NaN) % 1024).toBe(0);
    // A pgid is a pid, and no pid exceeds pid_max.
    expect(await readProcessGroupRss(pidMax + 1)).toBeNull();
  });
});
