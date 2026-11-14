import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Builds a /proc-shaped directory for tests: <root>/<pid>/{stat,status,cmdline,environ}, an fd
// link per socket the process holds, plus self/ns/pid and sys/kernel/random/boot_id when a pid
// space is given. writeFakeTcp writes net/tcp and net/tcp6. Typed, so tests that use
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
  /** Inodes of the sockets it holds, as fd 3 and up. Omitted: no fd directory is written. */
  sockets?: number[];
}

/** One row of net/tcp or net/tcp6. */
export interface FakeSocket {
  /** The local address as the kernel prints it: 8 hex digits, or 32 in tcp6. */
  address: string;
  port: number;
  inode: number;
  /** Defaults to 0A, a listening socket. 01 is an established connection. */
  state?: string;
}

export const V4_ANY = "00000000";
export const V4_LOOPBACK = "0100007F";
export const V6_ANY = "0".repeat(32);
export const V6_LOOPBACK = "00000000000000000000000001000000";

const TCP_HEADER =
  "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n";

function tcpText(sockets: readonly FakeSocket[]): string {
  const rows = sockets.map((socket, index) => {
    const port = socket.port.toString(16).toUpperCase().padStart(4, "0");
    const remote = `${"0".repeat(socket.address.length)}:0000`;
    return `${String(index).padStart(4)}: ${socket.address}:${port} ${remote} ${socket.state ?? "0A"} 00000000:00000000 00:00000000 00000000  1000        0 ${socket.inode} 1 0000000000000000 100 0 0 10 0\n`;
  });
  return TCP_HEADER + rows.join("");
}

export function writeFakeTcp(
  root: string,
  v4: readonly FakeSocket[],
  v6: readonly FakeSocket[] = [],
): void {
  mkdirSync(join(root, "net"), { recursive: true });
  writeFileSync(join(root, "net", "tcp"), tcpText(v4));
  writeFileSync(join(root, "net", "tcp6"), tcpText(v6));
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
    if (entry.sockets !== undefined) {
      rmSync(join(dir, "fd"), { recursive: true, force: true });
      mkdirSync(join(dir, "fd"));
      // The kernel's link text names no file, so the links dangle, as they do under /proc.
      for (const [index, inode] of entry.sockets.entries()) {
        symlinkSync(`socket:[${inode}]`, join(dir, "fd", String(index + 3)));
      }
      symlinkSync("/dev/null", join(dir, "fd", "0"));
    }
  }
  if (space === undefined) return;
  mkdirSync(join(root, "self", "ns"), { recursive: true });
  symlinkSync(space.pidNamespace, join(root, "self", "ns", "pid"));
  mkdirSync(join(root, "sys", "kernel", "random"), { recursive: true });
  writeFileSync(join(root, "sys", "kernel", "random", "boot_id"), `${space.bootId}\n`);
}
