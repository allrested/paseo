import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isCurrentPidSpace,
  killGroup,
  readPidRecord,
  reclaimPidFile,
  sendSignal,
  writePidFile,
  type PidRecord,
} from "./pid-files.js";

const PROC = "/proc";
const children: ChildProcess[] = [];
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rm-pidfile-"));
});

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null)
      sendSignal(-child.pid, "SIGKILL");
  }
  rmSync(dir, { recursive: true, force: true });
});

// A process group of its own that lives until killed, or 60 s at most, so a killed test run
// leaves nothing behind for long.
function startGroup(script = "setTimeout(() => {}, 60_000)"): ChildProcess {
  const child = spawn(process.execPath, ["-e", script], { detached: true, stdio: "ignore" });
  children.push(child);
  return child;
}

function exited(child: ChildProcess): Promise<NodeJS.Signals | number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(child.signalCode ?? child.exitCode);
      return;
    }
    child.once("exit", (code, signal) => resolve(signal ?? code));
  });
}

function pidOf(child: ChildProcess): number {
  if (child.pid === undefined) throw new Error("child did not start");
  return child.pid;
}

describe("writePidFile", () => {
  it("records the group, this daemon and the pid space in a 0600 file", () => {
    const child = startGroup();
    const file = join(dir, "srv-1.pid");

    writePidFile(file, pidOf(child), PROC);

    const record = readPidRecord(file);
    expect(record).toMatchObject({ pgid: pidOf(child), ownerPid: process.pid });
    expect(record?.startTime).toEqual(expect.any(Number));
    expect(record?.ownerStartTime).toEqual(expect.any(Number));
    expect(record === null ? false : isCurrentPidSpace(record, PROC)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });
});

describe("reclaimPidFile", () => {
  it("keeps the file and the group while the owner lives", async () => {
    const child = startGroup();
    const owner = startGroup();
    const file = join(dir, "srv-2.pid");
    writePidFile(file, pidOf(child), PROC);
    const record = readPidRecord(file);
    if (record === null) throw new Error("no record");
    const ownerStat = readFileSync(`/proc/${pidOf(owner)}/stat`, "utf8");
    const ownerStartTime = Number(ownerStat.slice(ownerStat.lastIndexOf(")") + 2).split(" ")[19]);
    const owned: PidRecord = { ...record, ownerPid: pidOf(owner), ownerStartTime };
    writeFileSync(file, `${JSON.stringify(owned)}\n`);

    await expect(reclaimPidFile(file, PROC)).resolves.toBe("kept");
    expect(existsSync(file)).toBe(true);
    expect(sendSignal(-pidOf(child), 0)).toBe(true);
  });

  it("kills the recorded group of a dead owner and removes the file", async () => {
    const child = startGroup();
    const file = join(dir, "srv-3.pid");
    // Owned by this process: reclaim reads that as an earlier run of this daemon, now gone.
    writePidFile(file, pidOf(child), PROC);
    const gone = exited(child);

    await expect(reclaimPidFile(file, PROC)).resolves.toBe("killed");
    await expect(gone).resolves.toBe("SIGTERM");
    expect(existsSync(file)).toBe(false);
  });

  it("removes a record from another boot and leaves its pids alone", async () => {
    const child = startGroup();
    const file = join(dir, "srv-4.pid");
    writePidFile(file, pidOf(child), PROC);
    const record = readPidRecord(file);
    if (record === null) throw new Error("no record");
    writeFileSync(file, `${JSON.stringify({ ...record, bootId: "another-boot" })}\n`);

    await expect(reclaimPidFile(file, PROC)).resolves.toBe("stale");
    expect(existsSync(file)).toBe(false);
    expect(sendSignal(-pidOf(child), 0)).toBe(true);
  });

  it("removes a record whose leader start time no longer matches", async () => {
    const child = startGroup();
    const file = join(dir, "srv-5.pid");
    writePidFile(file, pidOf(child), PROC);
    const record = readPidRecord(file);
    if (record === null || record.startTime === null) throw new Error("no record");
    writeFileSync(file, `${JSON.stringify({ ...record, startTime: record.startTime + 1 })}\n`);

    await expect(reclaimPidFile(file, PROC)).resolves.toBe("stale");
    expect(existsSync(file)).toBe(false);
    expect(sendSignal(-pidOf(child), 0)).toBe(true);
  });
});

describe("killGroup", () => {
  it("sends SIGKILL to a group that ignores SIGTERM once the grace period ends", async () => {
    const child = spawn(
      process.execPath,
      ["-e", "process.on('SIGTERM', () => {}); console.log('ready'); setTimeout(() => {}, 60_000)"],
      { detached: true, stdio: ["ignore", "pipe", "ignore"] },
    );
    children.push(child);
    // The child prints once its handler is installed, so the SIGTERM cannot arrive first.
    await new Promise((resolve) => child.stdout?.once("data", resolve));
    const gone = exited(child);

    await killGroup(pidOf(child), 200);

    await expect(gone).resolves.toBe("SIGKILL");
  });
});
