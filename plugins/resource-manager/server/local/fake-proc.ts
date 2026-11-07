import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Builds a /proc-shaped directory for tests: <root>/<pid>/{stat,status,cmdline,environ}, plus
// self/ns/pid and sys/kernel/random/boot_id when a pid space is given. Typed, so tests that use
// it are checked even though test files are not.
// Pass the space on the first call for a root only: a second call with one throws EEXIST on the
// self/ns/pid symlink. A later call rewrites the pids it lists and leaves the rest, including an
// environ file whose entry now has env: null.

export interface FakeProcess {
  pid: number;
  ppid: number;
  /** Defaults to pid (a group leader). */
  pgrp?: number;
  /** Field 22, in clock ticks. Defaults to 1000. */
  startTime?: number;
  utime?: number;
  stime?: number;
  /** VmRSS in kB. null writes no VmRSS line, as for a kernel thread or a zombie. */
  rssKb?: number | null;
  comm?: string;
  cmdline?: string[];
  /** null writes no environ file, as when another user's process cannot be read. */
  env?: Record<string, string> | null;
}

export interface FakePidSpace {
  pidNamespace: string;
  bootId: string;
}

// After ") ": 3 state, 4 ppid, 5 pgrp, 6 session, 7 tty_nr, 8 tpgid, 9 flags, 10-13 fault
// counts, 14 utime, 15 stime, 16 cutime, 17 cstime, 18 priority, 19 nice, 20 num_threads,
// 21 itrealvalue, 22 starttime, then two more fields.
export function statLine(entry: FakeProcess): string {
  const pgrp = entry.pgrp ?? entry.pid;
  const fields = [
    "S",
    entry.ppid,
    pgrp,
    pgrp,
    0,
    -1,
    4194304,
    0,
    0,
    0,
    0,
    entry.utime ?? 0,
    entry.stime ?? 0,
    0,
    0,
    20,
    0,
    1,
    0,
    entry.startTime ?? 1000,
    0,
    0,
  ];
  return `${entry.pid} (${entry.comm ?? "node"}) ${fields.join(" ")}\n`;
}

function statusText(entry: FakeProcess): string {
  const rss = entry.rssKb === undefined ? 1024 : entry.rssKb;
  const lines = [`Name:\t${entry.comm ?? "node"}`, `Pid:\t${entry.pid}`, `PPid:\t${entry.ppid}`];
  if (rss !== null) lines.push(`VmRSS:\t${String(rss).padStart(8)} kB`);
  return `${lines.join("\n")}\n`;
}

function nulJoined(values: readonly string[]): string {
  return values.map((value) => `${value}\0`).join("");
}

export function writeFakeProc(
  root: string,
  entries: readonly FakeProcess[],
  space?: FakePidSpace,
): void {
  for (const entry of entries) {
    const dir = join(root, String(entry.pid));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "stat"), statLine(entry));
    writeFileSync(join(dir, "status"), statusText(entry));
    writeFileSync(join(dir, "cmdline"), nulJoined(entry.cmdline ?? [entry.comm ?? "node"]));
    if (entry.env !== null) {
      const pairs = Object.entries(entry.env ?? {}).map(([key, value]) => `${key}=${value}`);
      writeFileSync(join(dir, "environ"), nulJoined(pairs));
    }
  }
  if (space === undefined) return;
  mkdirSync(join(root, "self", "ns"), { recursive: true });
  symlinkSync(space.pidNamespace, join(root, "self", "ns", "pid"));
  mkdirSync(join(root, "sys", "kernel", "random"), { recursive: true });
  writeFileSync(join(root, "sys", "kernel", "random", "boot_id"), `${space.bootId}\n`);
}
