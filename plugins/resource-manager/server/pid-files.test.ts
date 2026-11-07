import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFakeProc, type FakePidSpace } from "./local/fake-proc.js";
import {
  isCurrentPidSpace,
  listPidFiles,
  ownerIsAlive,
  readPidRecord,
  readPidSpace,
  readStartTime,
  type PidRecord,
} from "./pid-files.js";

const SPACE: FakePidSpace = { pidNamespace: "pid:[4026531836]", bootId: "boot-1" };

let root: string;
let procRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rm-pid-"));
  procRoot = join(root, "proc");
  writeFakeProc(
    procRoot,
    [
      { pid: 1, ppid: 0, startTime: 10 },
      { pid: 164, ppid: 6, startTime: 5000 },
    ],
    SPACE,
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function record(overrides: Partial<PidRecord>): PidRecord {
  return {
    pgid: 400,
    startTime: 4000,
    ownerPid: 164,
    ownerStartTime: 5000,
    pidNamespace: SPACE.pidNamespace,
    bootId: SPACE.bootId,
    initStartTime: 10,
    ...overrides,
  };
}

describe("pid space", () => {
  it("reads the namespace, boot id and init start time", () => {
    expect(readPidSpace(procRoot)).toEqual({
      pidNamespace: "pid:[4026531836]",
      bootId: "boot-1",
      initStartTime: 10,
    });
    expect(readStartTime(164, procRoot)).toBe(5000);
    expect(readStartTime(999, procRoot)).toBeNull();
  });

  it("accepts a record from this namespace, boot and container run only", () => {
    expect(isCurrentPidSpace(record({}), procRoot)).toBe(true);
    expect(isCurrentPidSpace(record({ bootId: "boot-0" }), procRoot)).toBe(false);
    expect(isCurrentPidSpace(record({ pidNamespace: "pid:[1]" }), procRoot)).toBe(false);
    expect(isCurrentPidSpace(record({ initStartTime: 11 }), procRoot)).toBe(false);
    expect(isCurrentPidSpace(record({ initStartTime: undefined }), procRoot)).toBe(false);
  });

  it("is never current where /proc has no pid space", () => {
    expect(isCurrentPidSpace(record({}), join(root, "missing"))).toBe(false);
  });
});

describe("ownerIsAlive", () => {
  it("is alive only when the owner runs with the recorded start time", () => {
    expect(ownerIsAlive(record({}), procRoot, 1)).toBe(true);
    expect(ownerIsAlive(record({ ownerStartTime: 5001 }), procRoot, 1)).toBe(false);
  });

  it("treats a record owned by this process as left by an earlier run", () => {
    expect(ownerIsAlive(record({}), procRoot, 164)).toBe(false);
  });
});

describe("pid file reading", () => {
  it("reads a valid record and returns null for a missing or unreadable file", () => {
    const valid = join(root, "a-400.pid");
    writeFileSync(valid, `${JSON.stringify(record({}))}\n`);
    const broken = join(root, "b-401.pid");
    writeFileSync(broken, "{ not json");

    expect(readPidRecord(valid)).toEqual(record({}));
    expect(readPidRecord(broken)).toBeNull();
    expect(readPidRecord(join(root, "missing.pid"))).toBeNull();
  });

  it("lists only .pid files, sorted, and nothing for a missing directory", () => {
    writeFileSync(join(root, "b-2.pid"), "");
    writeFileSync(join(root, "a-1.pid"), "");
    writeFileSync(join(root, "a-1.pid.tmp"), "");

    expect(listPidFiles(root)).toEqual(["a-1.pid", "b-2.pid"]);
    expect(listPidFiles(join(root, "missing"))).toEqual([]);
  });
});
