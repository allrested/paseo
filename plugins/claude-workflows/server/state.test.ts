import { mkdir, mkdtemp, realpath, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decideRunState,
  hasLiveSession,
  readRecordFacts,
  RECORD_MAX_BYTES,
  type LiveSessionQuery,
  type RecordFacts,
} from "./state.js";

const SESSION_ID = "0f8c2d4e-1a2b-4c3d-8e9f-0123456789ab";
const OTHER_SESSION_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const T0 = Date.UTC(2026, 10, 7, 9, 0, 0);
const PID = 4_000_001;
const START_TIME = "873421";

let root = "";
let configDir = "";
let procRoot = "";

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "claude-workflows-state-")));
  configDir = join(root, ".claude");
  procRoot = join(root, "proc");
  await mkdir(join(configDir, "sessions"), { recursive: true });
  await mkdir(procRoot);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

interface ClaudeSession {
  pid: number;
  sessionId: string;
  startedAt: number;
}

/** A session file under `<pid>.json`, as Claude Code writes it. */
async function writeSession(session: ClaudeSession): Promise<void> {
  const body = { ...session, procStart: START_TIME, status: "busy" };
  await writeFile(join(configDir, "sessions", `${session.pid}.json`), JSON.stringify(body));
}

/** A /proc/<pid>/stat whose comm holds spaces and parentheses. */
async function writeProcStat(pid: number, startTime: string): Promise<void> {
  await mkdir(join(procRoot, String(pid)), { recursive: true });
  const stat = `${pid} (claude (x) y) S 1 ${pid} ${pid} 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 ${startTime} 0 0\n`;
  await writeFile(join(procRoot, String(pid), "stat"), stat);
}

function query(startedBy: number): LiveSessionQuery {
  return { configDir, sessionId: SESSION_ID, startedBy, procRoot };
}

async function writeRecord(body: string): Promise<string> {
  await mkdir(join(root, "workflows"), { recursive: true });
  const path = join(root, "workflows", "wf_0a1b2c3d-4e5.json");
  await writeFile(path, body);
  return path;
}

function recordBody(status: string): string {
  return JSON.stringify({
    status,
    timestamp: new Date(T0 + 10_000).toISOString(),
    workflowName: "read-files",
    workflowProgress: [{ label: "Read a.txt", promptPreview: "p", resultPreview: "r" }],
  });
}

interface LiveCheck {
  calls: number;
  isLive(): Promise<boolean>;
}

function liveCheck(live: boolean): LiveCheck {
  const check: LiveCheck = {
    calls: 0,
    async isLive() {
      check.calls += 1;
      return live;
    },
  };
  return check;
}

const COMPLETED: RecordFacts = { killed: false, endedAt: T0 + 10_000, name: "read-files" };
const KILLED: RecordFacts = { killed: true, endedAt: T0 + 10_000, name: "read-files" };

describe("hasLiveSession", () => {
  it("finds the live process that owns the session", async () => {
    await writeSession({ pid: PID, sessionId: SESSION_ID, startedAt: T0 });
    await writeProcStat(PID, START_TIME);

    await expect(hasLiveSession(query(T0 + 4000))).resolves.toBe(true);
  });

  it("rejects a pid that another process now uses", async () => {
    await writeSession({ pid: PID, sessionId: SESSION_ID, startedAt: T0 });
    await writeProcStat(PID, "999999");

    await expect(hasLiveSession(query(T0 + 4000))).resolves.toBe(false);
  });

  it("rejects a process that started after the run's newest agent", async () => {
    await writeSession({ pid: PID, sessionId: SESSION_ID, startedAt: T0 + 5000 });
    await writeProcStat(PID, START_TIME);

    await expect(hasLiveSession(query(T0 + 4000))).resolves.toBe(false);
  });

  it("ignores other sessions, key files, garbled files and exited processes", async () => {
    await writeSession({ pid: PID, sessionId: OTHER_SESSION_ID, startedAt: T0 });
    await writeProcStat(PID, START_TIME);
    // An owner's contents under a key file's name (`<pid>.<64 hex>.key`, as Claude Code names
    // them): reading it would find a live owner.
    const owner = { pid: PID, sessionId: SESSION_ID, procStart: START_TIME, startedAt: T0 };
    const keyName = `${PID}.${"ab".repeat(32)}.key`;
    await writeFile(join(configDir, "sessions", keyName), JSON.stringify(owner));
    await writeFile(join(configDir, "sessions", "4000002.json"), "{not json");
    await writeSession({ pid: 4_000_003, sessionId: SESSION_ID, startedAt: T0 });

    await expect(hasLiveSession(query(T0 + 4000))).resolves.toBe(false);
  });

  it("finds nothing without a sessions dir", async () => {
    await rm(join(configDir, "sessions"), { recursive: true });

    await expect(hasLiveSession(query(T0 + 4000))).resolves.toBe(false);
  });
});

describe("readRecordFacts", () => {
  it("reads a completed record", async () => {
    const path = await writeRecord(recordBody("completed"));

    await expect(readRecordFacts(path)).resolves.toEqual(COMPLETED);
  });

  it("reads a killed record", async () => {
    const path = await writeRecord(recordBody("killed"));

    await expect(readRecordFacts(path)).resolves.toEqual(KILLED);
  });

  it("has no record while the file is missing or not complete JSON", async () => {
    await expect(readRecordFacts(join(root, "workflows", "absent.json"))).resolves.toBeNull();
    const path = await writeRecord('{"status":"comp');

    await expect(readRecordFacts(path)).resolves.toBeNull();
  });

  it("drops an end time or a name it cannot use", async () => {
    const unusable = { killed: false, endedAt: null, name: null };
    const wrongTypes = await writeRecord(
      JSON.stringify({ status: "completed", timestamp: 12, workflowName: ["x"] }),
    );
    await expect(readRecordFacts(wrongTypes)).resolves.toEqual(unusable);

    const badTime = await writeRecord(
      JSON.stringify({ status: "completed", timestamp: "not a time" }),
    );
    await expect(readRecordFacts(badTime)).resolves.toEqual(unusable);
  });

  it("rejects a record without a status, and one too large to read", async () => {
    const noStatus = await writeRecord(JSON.stringify({ timestamp: new Date(T0).toISOString() }));
    await expect(readRecordFacts(noStatus)).rejects.toMatchObject({
      name: "RunRecordUnreadableError",
      problem: "no-status",
    });

    const large = await writeRecord("{}");
    await truncate(large, RECORD_MAX_BYTES + 1);
    await expect(readRecordFacts(large)).rejects.toMatchObject({
      name: "RunRecordUnreadableError",
      problem: "too-large",
    });
  });
});

describe("decideRunState", () => {
  it("takes Completed or Killed from a record without checking the process", async () => {
    const check = liveCheck(true);
    const input = { journalMtimeMs: T0 + 9000, isLive: check.isLive };

    await expect(decideRunState({ ...input, record: COMPLETED })).resolves.toEqual({
      state: "completed",
      endedAt: T0 + 10_000,
    });
    await expect(decideRunState({ ...input, record: KILLED })).resolves.toEqual({
      state: "killed",
      endedAt: T0 + 10_000,
    });
    expect(check.calls).toBe(0);
  });

  it("without a record, gives Running while a live process owns the run, else Stopped", async () => {
    const live = liveCheck(true);
    const gone = liveCheck(false);

    await expect(
      decideRunState({ record: null, journalMtimeMs: T0, isLive: live.isLive }),
    ).resolves.toEqual({ state: "running", endedAt: null });
    await expect(
      decideRunState({ record: null, journalMtimeMs: T0, isLive: gone.isLive }),
    ).resolves.toEqual({ state: "stopped", endedAt: null });
    expect([live.calls, gone.calls]).toEqual([1, 1]);
  });

  it("treats a record as a resumed run's once the journal changed over a second after it", async () => {
    const check = liveCheck(true);

    const status = await decideRunState({
      record: COMPLETED,
      journalMtimeMs: T0 + 11_001,
      isLive: check.isLive,
    });

    expect(status).toEqual({ state: "running", endedAt: null });
    expect(check.calls).toBe(1);
  });

  it("keeps a record the journal changed within a second of, or one without an end time", async () => {
    const check = liveCheck(true);

    const within = await decideRunState({
      record: COMPLETED,
      journalMtimeMs: T0 + 11_000,
      isLive: check.isLive,
    });
    const untimed = await decideRunState({
      record: { ...COMPLETED, endedAt: null },
      journalMtimeMs: T0 + 60_000,
      isLive: check.isLive,
    });

    expect([within, untimed]).toEqual([
      { state: "completed", endedAt: T0 + 10_000 },
      { state: "completed", endedAt: null },
    ]);
    expect(check.calls).toBe(0);
  });
});
