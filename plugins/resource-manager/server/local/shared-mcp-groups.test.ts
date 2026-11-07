import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PidRecord } from "../pid-files.js";
import { writeFakeProc, type FakePidSpace } from "./fake-proc.js";
import { readSharedMcpPids } from "./shared-mcp-groups.js";

const SPACE: FakePidSpace = { pidNamespace: "pid:[4026531836]", bootId: "boot-1" };

let root: string;
let procRoot: string;
let runDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rm-smcp-"));
  procRoot = join(root, "proc");
  runDir = join(root, "run");
  mkdirSync(runDir);
  writeFakeProc(
    procRoot,
    [
      { pid: 1, ppid: 0, startTime: 10 },
      { pid: 164, ppid: 1, startTime: 5000 },
      { pid: 400, ppid: 164, startTime: 4000 },
      { pid: 401, ppid: 400, pgrp: 400, startTime: 4001 },
      // Serena-style: a child in a session of its own still belongs to the server.
      { pid: 402, ppid: 401, pgrp: 402, startTime: 4002 },
      { pid: 450, ppid: 164, startTime: 4500 },
    ],
    SPACE,
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeRecord(name: string, overrides: Partial<PidRecord>): string {
  const record: PidRecord = {
    pgid: 400,
    startTime: 4000,
    ownerPid: 164,
    ownerStartTime: 5000,
    pidNamespace: SPACE.pidNamespace,
    bootId: SPACE.bootId,
    initStartTime: 10,
    ...overrides,
  };
  const file = join(runDir, name);
  writeFileSync(file, `${JSON.stringify(record)}\n`);
  return file;
}

describe("readSharedMcpPids", () => {
  it("returns every pid in each recorded server's tree", () => {
    writeRecord("context7.pid", {});
    writeRecord("gitlab.pid", { pgid: 450, startTime: 4500 });

    expect([...readSharedMcpPids(runDir, procRoot)].sort((a, b) => a - b)).toEqual([
      400, 401, 402, 450,
    ]);
  });

  it("skips records from another boot, with a reused leader pid, or that do not parse", () => {
    writeRecord("old-boot.pid", { bootId: "boot-0" });
    writeRecord("reused.pid", { pgid: 450, startTime: 9999 });
    writeFileSync(join(runDir, "broken.pid"), "{");

    expect(readSharedMcpPids(runDir, procRoot).size).toBe(0);
  });

  it("never removes a pid file, stale or not", () => {
    const stale = writeRecord("old-boot.pid", { bootId: "boot-0" });

    readSharedMcpPids(runDir, procRoot);

    expect(existsSync(stale)).toBe(true);
  });

  it("returns an empty set when shared-mcp has no run directory", () => {
    expect(readSharedMcpPids(join(root, "missing"), procRoot).size).toBe(0);
  });
});
