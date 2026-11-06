import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseStat, type ProcStat } from "./procfs.js";
import {
  killProcessGroup,
  LogRing,
  reclaimOrphan,
  spawnServer,
  type RunningProcess,
  type SpawnSpec,
} from "./process-runner.js";

const onLinux = process.platform === "linux";
const isRoot = process.getuid?.() === 0;
// Odd durations mark this suite's processes, so a leak check can tell them from other sleeps.
const LONG_SLEEP = "sleep 30.123";
const SHORT_SLEEP = "sleep 0.123";

let dir: string;
let running: RunningProcess[];
let groups: number[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "shared-mcp-runner-"));
  running = [];
  groups = [];
});

afterEach(async () => {
  vi.unstubAllEnvs();
  // Some tests stub process.kill; the cleanup below needs the real one.
  vi.restoreAllMocks();
  for (const pgid of groups) signalQuietly(-pgid, "SIGKILL");
  await Promise.all(running.map((proc) => proc.stop(0)));
  rmSync(dir, { recursive: true, force: true });
});

function logFile(): string {
  return join(dir, "logs", "test.log");
}

function pidFile(): string {
  return join(dir, "run", "test.pid");
}

function spec(command: string, lines: string[], env: Record<string, string> = {}): SpawnSpec {
  return {
    command,
    env,
    logFile: logFile(),
    pidFile: pidFile(),
    onLine: (line) => lines.push(line),
  };
}

function start(command: string, lines: string[], env: Record<string, string> = {}): RunningProcess {
  const proc = spawnServer(spec(command, lines, env));
  running.push(proc);
  return proc;
}

// A detached group started outside spawnServer, standing in for one a previous daemon left behind.
function startGroup(command: string): ChildProcess {
  const child = spawn("/bin/sh", ["-c", command], { detached: true, stdio: "ignore" });
  groups.push(child.pid!);
  return child;
}

// A pid names a process only within one pid namespace, one boot and one container run, so the pid
// file records all three.
function currentPidSpace(): { pidNamespace: string; bootId: string; initStartTime: number } {
  return {
    pidNamespace: readlinkSync("/proc/self/ns/pid"),
    bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
    initStartTime: startTimeOf(1),
  };
}

// Written from this pid namespace and boot unless the record says otherwise.
function writePidRecord(record: object): void {
  mkdirSync(dirname(pidFile()), { recursive: true });
  writeFileSync(pidFile(), JSON.stringify({ ...currentPidSpace(), ...record }));
}

// A /proc stand-in with this pid namespace, this boot, the stat of pid 1 and the leader's, plus one
// pid whose stat is a directory: reading it fails with EISDIR, so walkProcessTree throws, for root
// too.
function walkFailingProcRoot(leader: number): string {
  const root = join(dir, "proc");
  mkdirSync(join(root, "self", "ns"), { recursive: true });
  symlinkSync(readlinkSync("/proc/self/ns/pid"), join(root, "self", "ns", "pid"));
  mkdirSync(join(root, "sys", "kernel", "random"), { recursive: true });
  writeFileSync(
    join(root, "sys", "kernel", "random", "boot_id"),
    readFileSync("/proc/sys/kernel/random/boot_id"),
  );
  mkdirSync(join(root, "1"));
  writeFileSync(join(root, "1", "stat"), readFileSync("/proc/1/stat"));
  mkdirSync(join(root, String(leader)));
  writeFileSync(join(root, String(leader), "stat"), readFileSync(`/proc/${leader}/stat`));
  mkdirSync(join(root, "999999", "stat"), { recursive: true });
  return root;
}

// A pid that just exited and was reaped stands in for a dead daemon or a stale server.
function deadPid(): number {
  return spawnSync("true").pid;
}

function statOf(pid: number): ProcStat | null {
  try {
    return parseStat(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return null;
  }
}

function startTimeOf(pid: number): number {
  return statOf(pid)!.startTime;
}

// setsid moves a process into a group of its own, whose id is its pid.
async function waitForOwnGroup(pid: number): Promise<void> {
  await waitFor(() => statOf(pid)?.pgrp === pid);
}

function isAlive(pid: number): boolean {
  return signalQuietly(pid, 0);
}

function signalQuietly(target: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(target, signal);
    return true;
  } catch {
    return false;
  }
}

function backgroundPid(lines: string[]): number | null {
  const line = lines.find((entry) => entry.startsWith("bg="));
  return line === undefined ? null : Number(line.slice(3));
}

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`);
    await delay(20);
  }
}

describe("LogRing", () => {
  it("keeps the last 200 lines", () => {
    const ring = new LogRing();
    for (let index = 0; index < 250; index += 1) ring.push(`line ${index}`);

    const expected = Array.from({ length: 200 }, (_, offset) => `line ${offset + 50}`);
    expect(ring.lines()).toEqual(expected);
  });
});

describe.runIf(onLinux)("spawnServer", () => {
  it("sends stdout and stderr lines to onLine and appends them to the log file", async () => {
    mkdirSync(dirname(logFile()), { recursive: true });
    writeFileSync(logFile(), "earlier run\n");
    const lines: string[] = [];

    const proc = start("printf 'one\\ntwo\\n'; echo three >&2", lines);

    expect(await proc.exited).toEqual({ code: 0, signal: null });
    expect([...lines].sort()).toEqual(["one", "three", "two"]);
    const logged = readFileSync(logFile(), "utf8").split("\n");
    expect(logged[0]).toBe("earlier run");
    expect(logged.slice(1).sort()).toEqual(["", "one", "three", "two"]);
  }, 15_000);

  it("cuts an output line at 4,000 characters in onLine and the log file", async () => {
    const lines: string[] = [];

    const proc = start("head -c 5000 /dev/zero | tr '\\0' x; echo; echo after", lines);

    await proc.exited;
    const cut = `${"x".repeat(4_000)}…`;
    expect(lines).toEqual([cut, "after"]);
    expect(readFileSync(logFile(), "utf8")).toBe(`${cut}\nafter\n`);
  }, 15_000);

  it("drops PASEO_* and the parent-session variables from the server environment", async () => {
    vi.stubEnv("PASEO_PASSWORD", "not-a-real-password");
    vi.stubEnv("PASEO_HOME", dir);
    vi.stubEnv("PASEO_SUPERVISED", "1");
    vi.stubEnv("CLAUDECODE", "1");
    const lines: string[] = [];

    const proc = start(
      "echo \"paseo=$(env | grep -c '^PASEO_') claudecode=${CLAUDECODE:-unset} own=$OWN\"",
      lines,
      { OWN: "set" },
    );

    await proc.exited;
    expect(lines).toEqual(["paseo=0 claudecode=unset own=set"]);
  }, 15_000);

  it("renames the pid file into place and removes it after the server exits", async () => {
    const proc = start(LONG_SLEEP, []);

    expect(readdirSync(dirname(pidFile()))).toEqual(["test.pid"]);
    expect(JSON.parse(readFileSync(pidFile(), "utf8"))).toEqual({
      pgid: proc.pid,
      startTime: startTimeOf(proc.pid),
      ownerPid: process.pid,
      ownerStartTime: startTimeOf(process.pid),
      ...currentPidSpace(),
    });
    await proc.stop();
    expect(existsSync(pidFile())).toBe(false);
  }, 15_000);

  it("stop() kills every process in the group", async () => {
    const lines: string[] = [];
    const proc = start(`${LONG_SLEEP} & echo "bg=$!"; ${LONG_SLEEP}`, lines);
    await waitFor(() => backgroundPid(lines) !== null);
    const background = backgroundPid(lines)!;

    await proc.stop();

    expect(await proc.exited).toEqual({ code: null, signal: "SIGTERM" });
    expect(isAlive(proc.pid)).toBe(false);
    expect(isAlive(background)).toBe(false);
  }, 15_000);

  it("stop() also kills a descendant that left the group with setsid", async () => {
    const lines: string[] = [];
    const proc = start(`setsid ${LONG_SLEEP} & echo "bg=$!"; ${LONG_SLEEP}`, lines);
    await waitFor(() => backgroundPid(lines) !== null);
    const escaped = backgroundPid(lines)!;
    // Its own group, so afterEach can kill it if stop() does not.
    groups.push(escaped);
    await waitForOwnGroup(escaped);

    await proc.stop();

    expect(await proc.exited).toEqual({ code: null, signal: "SIGTERM" });
    expect(isAlive(escaped)).toBe(false);
  }, 15_000);

  it("still stops the group when the process tree walk fails", async () => {
    const lines: string[] = [];
    // A file where /proc should be makes the walk throw ENOTDIR, for root too.
    const procRoot = join(dir, "not-proc");
    writeFileSync(procRoot, "");
    const proc = spawnServer({
      ...spec(`${LONG_SLEEP} & echo "bg=$!"; ${LONG_SLEEP}`, lines),
      procRoot,
    });
    running.push(proc);
    // Killed by afterEach even if stop() throws before its first signal.
    groups.push(proc.pid);
    await waitFor(() => backgroundPid(lines) !== null);
    const background = backgroundPid(lines)!;

    await proc.stop();

    expect(await proc.exited).toEqual({ code: null, signal: "SIGTERM" });
    expect(isAlive(-proc.pid)).toBe(false);
    expect(isAlive(background)).toBe(false);
    expect(lines).toContain(
      `process tree walk failed, signalling the group only: ENOTDIR: not a directory, scandir '${procRoot}'`,
    );
  }, 15_000);

  it("sends SIGKILL after the grace period to a group that traps SIGTERM", async () => {
    const lines: string[] = [];
    const proc = start(
      `trap 'echo got-term' TERM; echo ready; while :; do ${SHORT_SLEEP}; done`,
      lines,
    );
    await waitFor(() => lines.includes("ready"));
    const startedAt = Date.now();

    await proc.stop(1_000);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_000);
    expect(lines).toContain("got-term");
    expect(await proc.exited).toEqual({ code: null, signal: "SIGKILL" });
    expect(isAlive(proc.pid)).toBe(false);
  }, 15_000);

  it("brings the SIGKILL forward when a later stop() passes a shorter grace", async () => {
    const lines: string[] = [];
    const proc = start(
      `trap 'echo got-term' TERM; echo ready; while :; do ${SHORT_SLEEP}; done`,
      lines,
    );
    await waitFor(() => lines.includes("ready"));
    const startedAt = Date.now();

    const slow = proc.stop(5_000);
    const fast = proc.stop(300);
    await Promise.all([slow, fast]);

    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(300);
    expect(elapsed).toBeLessThan(2_000);
    expect(lines).toContain("got-term");
    expect(await proc.exited).toEqual({ code: null, signal: "SIGKILL" });
    // Once exited has settled, stop() signals nothing and resolves.
    await expect(proc.stop()).resolves.toBeUndefined();
  }, 15_000);

  it("kills what the leader left running when it exits on its own", async () => {
    const lines: string[] = [];
    const proc = start(`${LONG_SLEEP} & echo "bg=$!"; exit 3`, lines);

    expect(await proc.exited).toEqual({ code: 3, signal: null });
    expect(isAlive(backgroundPid(lines)!)).toBe(false);
    expect(existsSync(pidFile())).toBe(false);
  }, 15_000);

  it("throws on a missing cwd and passes the same reason to onLine first", () => {
    const lines: string[] = [];
    const cwd = join(dir, "missing");
    const reason = `ENOENT: no such file or directory, stat '${cwd}'`;

    expect(() => spawnServer({ ...spec(LONG_SLEEP, lines), cwd })).toThrow(
      `Could not start /bin/sh for: ${LONG_SLEEP}: ${reason}`,
    );
    expect(lines).toEqual([`spawn error: ${reason}`]);
    expect(existsSync(pidFile())).toBe(false);
  });

  it("throws when the cwd is a file", () => {
    const lines: string[] = [];
    const cwd = join(dir, "a-file");
    writeFileSync(cwd, "");

    expect(() => spawnServer({ ...spec(LONG_SLEEP, lines), cwd })).toThrow(
      `Could not start /bin/sh for: ${LONG_SLEEP}: cwd is not a directory: ${cwd}`,
    );
    expect(lines).toEqual([`spawn error: cwd is not a directory: ${cwd}`]);
  });

  it("passes an error spawn() throws itself to onLine and the thrown message", () => {
    const lines: string[] = [];
    const reason =
      "The property 'options.env['BAD']' must be a string without null bytes. Received 'a\\x00b'";

    expect(() => spawnServer(spec(LONG_SLEEP, lines, { BAD: "a\0b" }))).toThrow(
      `Could not start /bin/sh for: ${LONG_SLEEP}: ${reason}`,
    );
    expect(lines).toEqual([`spawn error: ${reason}`]);
    expect(existsSync(pidFile())).toBe(false);
  });

  // Root ignores directory permissions, so the shell would start there.
  it.runIf(!isRoot)("passes an error Node reports on the next tick to onLine", async () => {
    const lines: string[] = [];
    const cwd = join(dir, "locked");
    mkdirSync(cwd, { mode: 0o000 });

    expect(() => spawnServer({ ...spec(LONG_SLEEP, lines), cwd })).toThrow(
      `Could not start /bin/sh for: ${LONG_SLEEP} (the reason follows in the log tail)`,
    );
    expect(lines).toEqual([]);
    await waitFor(() => lines.length > 0);
    expect(lines).toEqual(["spawn error: spawn /bin/sh EACCES"]);
    expect(existsSync(pidFile())).toBe(false);
  });
});

describe("killProcessGroup", () => {
  // -1 would signal pid 1 itself.
  it.each([0, 1, -1])(
    "signals nothing for group %i",
    async (pgid) => {
      const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

      await killProcessGroup(pgid, 0);

      expect(kill).not.toHaveBeenCalled();
    },
    15_000,
  );
});

describe.runIf(onLinux)("reclaimOrphan", () => {
  it("kills a group whose daemon died and removes the pid file", async () => {
    const leader = startGroup(`${LONG_SLEEP} & ${LONG_SLEEP}`);
    writePidRecord({
      pgid: leader.pid,
      startTime: startTimeOf(leader.pid!),
      ownerPid: deadPid(),
      ownerStartTime: null,
    });

    expect(await reclaimOrphan(pidFile())).toBe(true);
    expect(isAlive(-leader.pid!)).toBe(false);
    expect(existsSync(pidFile())).toBe(false);
  }, 15_000);

  it("also kills the descendants that left the orphaned group with setsid", async () => {
    const bgFile = join(dir, "bg");
    const leader = startGroup(`setsid ${LONG_SLEEP} & echo $! > ${bgFile}; ${LONG_SLEEP}`);
    await waitFor(() => existsSync(bgFile) && readFileSync(bgFile, "utf8").endsWith("\n"));
    const escaped = Number(readFileSync(bgFile, "utf8"));
    groups.push(escaped);
    await waitForOwnGroup(escaped);
    writePidRecord({
      pgid: leader.pid,
      startTime: startTimeOf(leader.pid!),
      ownerPid: deadPid(),
      ownerStartTime: null,
    });

    expect(await reclaimOrphan(pidFile())).toBe(true);
    expect(isAlive(-leader.pid!)).toBe(false);
    expect(isAlive(escaped)).toBe(false);
  }, 15_000);

  it("kills a group whose leader already exited", async () => {
    const leader = startGroup(`${LONG_SLEEP} & exit 0`);
    const startTime = startTimeOf(leader.pid!);
    await once(leader, "exit");
    expect(isAlive(-leader.pid!)).toBe(true);
    writePidRecord({ pgid: leader.pid, startTime, ownerPid: deadPid(), ownerStartTime: null });

    expect(await reclaimOrphan(pidFile())).toBe(true);
    expect(isAlive(-leader.pid!)).toBe(false);
  }, 15_000);

  it("leaves a group alone while the daemon that started it is alive", async () => {
    const leader = startGroup(LONG_SLEEP);
    writePidRecord({
      pgid: leader.pid,
      startTime: startTimeOf(leader.pid!),
      ownerPid: process.ppid,
      ownerStartTime: startTimeOf(process.ppid),
    });

    expect(await reclaimOrphan(pidFile())).toBe(false);
    expect(isAlive(-leader.pid!)).toBe(true);
    expect(existsSync(pidFile())).toBe(true);
  }, 15_000);

  it("returns false for a stale pid and removes its file", async () => {
    writePidRecord({ pgid: deadPid(), startTime: 1, ownerPid: deadPid(), ownerStartTime: null });

    expect(await reclaimOrphan(pidFile())).toBe(false);
    expect(existsSync(pidFile())).toBe(false);
  });

  // Group 0 is every kernel thread and group 1 the whole init tree. The start time matches init and
  // the owner start time makes the owner check read /proc instead of signalling, so only the group
  // check keeps reclaim from signalling.
  it.each([0, 1])(
    "treats a pid file naming group %i as stale and signals nothing",
    async (pgid) => {
      writePidRecord({ pgid, startTime: startTimeOf(1), ownerPid: deadPid(), ownerStartTime: 1 });
      const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

      expect(await reclaimOrphan(pidFile())).toBe(false);
      expect(kill).not.toHaveBeenCalled();
      expect(existsSync(pidFile())).toBe(false);
    },
    15_000,
  );

  // The record names a live group with its real start time, so only the pid-space check keeps
  // reclaim from signalling. The owner start time makes the owner check read /proc.
  it.each([
    ["another pid namespace", { pidNamespace: "pid:[1]" }],
    ["another boot", { bootId: "00000000-0000-0000-0000-000000000000" }],
    ["no pid namespace", { pidNamespace: undefined }],
    ["no boot id", { bootId: undefined }],
    ["another container run", { initStartTime: -1 }],
    ["no init start time", { initStartTime: undefined }],
  ])(
    "treats a pid file as stale and signals nothing when it names %s",
    async (_, pidSpace) => {
      const leader = startGroup(LONG_SLEEP);
      writePidRecord({
        pgid: leader.pid,
        startTime: startTimeOf(leader.pid!),
        ownerPid: deadPid(),
        ownerStartTime: 1,
        ...pidSpace,
      });
      const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

      expect(await reclaimOrphan(pidFile())).toBe(false);
      expect(kill).not.toHaveBeenCalled();
      expect(existsSync(pidFile())).toBe(false);
    },
    15_000,
  );

  it("reports a walk error through onLine and still kills the group", async () => {
    const leader = startGroup(`${LONG_SLEEP} & ${LONG_SLEEP}`);
    const procRoot = walkFailingProcRoot(leader.pid!);
    writePidRecord({
      pgid: leader.pid,
      startTime: startTimeOf(leader.pid!),
      ownerPid: deadPid(),
      ownerStartTime: null,
    });
    const lines: string[] = [];

    expect(await reclaimOrphan(pidFile(), (line) => lines.push(line), procRoot)).toBe(true);
    expect(isAlive(-leader.pid!)).toBe(false);
    expect(existsSync(pidFile())).toBe(false);
    expect(lines).toEqual([
      "process tree walk failed, signalling the group only: EISDIR: illegal operation on a directory, read",
    ]);
  }, 15_000);

  it("does not kill a process that reused the recorded pid", async () => {
    const leader = startGroup(LONG_SLEEP);
    writePidRecord({
      pgid: leader.pid,
      startTime: startTimeOf(leader.pid!) - 1,
      ownerPid: deadPid(),
      ownerStartTime: null,
    });

    expect(await reclaimOrphan(pidFile())).toBe(false);
    expect(isAlive(-leader.pid!)).toBe(true);
    expect(existsSync(pidFile())).toBe(false);
  }, 15_000);

  it("removes a pid file it cannot parse and rejects with its path", async () => {
    mkdirSync(dirname(pidFile()), { recursive: true });
    writeFileSync(pidFile(), '{"pgid":12');

    await expect(reclaimOrphan(pidFile())).rejects.toThrow(
      `Removed unreadable pid file ${pidFile()}`,
    );
    expect(existsSync(pidFile())).toBe(false);
  });

  it("returns false when there is no pid file", async () => {
    expect(await reclaimOrphan(join(dir, "run", "missing.pid"))).toBe(false);
  });
});
