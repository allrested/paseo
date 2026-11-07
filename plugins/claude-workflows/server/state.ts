import { open, readFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { RunState } from "../shared/run.js";
import { isFileError, isMissing, listNames, parseJson } from "./files.js";

/** A run record larger than this is unreadable rather than read into memory. */
export const RECORD_MAX_BYTES = 16 * 1024 * 1024;

/**
 * How long after a record's end time the journal may still change before the record counts as
 * an earlier attempt's: a resume appends to the journal and rewrites the record only at its end.
 */
export const RECORD_STALE_AFTER_MS = 1000;

export type RecordProblem = "too-large" | "no-status";

/** The run record exists but cannot be used. */
export class RunRecordUnreadableError extends Error {
  readonly problem: RecordProblem;

  constructor(problem: RecordProblem) {
    super(`Workflow run record is unusable: ${problem}`);
    this.name = "RunRecordUnreadableError";
    this.problem = problem;
  }
}

/** The only facts taken from a run record, which also holds prompts and results. */
export interface RecordFacts {
  killed: boolean;
  /** Epoch milliseconds. */
  endedAt: number | null;
  name: string | null;
}

const RecordSchema = z.object({
  status: z.string(),
  timestamp: z.string().nullable().catch(null),
  workflowName: z.string().nullable().catch(null),
});

/**
 * Status, end time and name from a run record, or null when there is none yet. Claude Code
 * writes the record once, so a read that races the write sees incomplete JSON: none yet.
 */
export async function readRecordFacts(path: string): Promise<RecordFacts | null> {
  const text = await readCapped(path);
  if (text === null) return null;
  const json = parseJson(text);
  if (json === undefined) return null;
  const parsed = RecordSchema.safeParse(json);
  if (!parsed.success) throw new RunRecordUnreadableError("no-status");
  const { status, timestamp, workflowName } = parsed.data;
  const killed = status === "killed";
  const endedAt = timestamp === null ? null : parseTime(timestamp);
  return { killed, endedAt, name: workflowName };
}

function parseTime(text: string): number | null {
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : at;
}

async function readCapped(path: string): Promise<string | null> {
  const handle = await openIfPresent(path);
  if (handle === null) return null;
  try {
    const { size } = await handle.stat();
    if (size > RECORD_MAX_BYTES) throw new RunRecordUnreadableError("too-large");
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function openIfPresent(path: string): Promise<FileHandle | null> {
  try {
    return await open(path, "r");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export interface LiveSessionQuery {
  configDir: string;
  sessionId: string;
  /** Epoch ms: a process that started later than this did not start the run's newest agent. */
  startedBy: number;
  /** `/proc`, or a fake one in tests. */
  procRoot: string;
}

const SESSION_FILE = /^\d+\.json$/;

const SessionFileSchema = z.object({
  pid: z.number().int().positive(),
  sessionId: z.string(),
  procStart: z.string(),
  startedAt: z.number(),
});
type SessionFile = z.output<typeof SessionFileSchema>;

/**
 * Whether a live Claude process owns the session: a `<config>/sessions/<pid>.json` for it whose
 * process still runs (its /proc start time equals `procStart`) and started no later than
 * `startedBy`. Only `<pid>.json` files are read, never the `.key` files beside them.
 */
export async function hasLiveSession(query: LiveSessionQuery): Promise<boolean> {
  const dir = join(query.configDir, "sessions");
  const names = await listNames(dir);
  for (const name of names.filter((entry) => SESSION_FILE.test(entry))) {
    const session = await readSessionFile(join(dir, name));
    if (session?.sessionId !== query.sessionId) continue;
    if (session.startedAt > query.startedBy) continue;
    const startTime = await procStartTime(query.procRoot, session.pid);
    if (startTime === session.procStart) return true;
  }
  return false;
}

async function readSessionFile(path: string): Promise<SessionFile | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    // Gone since the listing, or unreadable: either way it names no live owner. Claude Code
    // often leaves the file behind when its process exits, so liveness comes from /proc.
    if (isFileError(error)) return null;
    throw error;
  }
  const parsed = SessionFileSchema.safeParse(parseJson(text));
  return parsed.success ? parsed.data : null;
}

/** Field 22 of /proc/<pid>/stat, the start time in clock ticks; null when the process is gone. */
async function procStartTime(procRoot: string, pid: number): Promise<string | null> {
  let stat: string;
  try {
    stat = await readFile(join(procRoot, String(pid), "stat"), "utf8");
  } catch (error) {
    // ENOENT also covers a system without /proc.
    if (isMissing(error)) return null;
    throw error;
  }
  // Field 2, comm, may hold spaces and parentheses, so fields are counted from the last ")", as
  // plugins/shared-mcp/server/procfs.ts does: after ") " come 3 state ... 22 starttime.
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return fields.length > 19 ? fields[19] : null;
}

/** The run's state, and its end time when a run record decided it. */
export interface RunStatus {
  state: RunState;
  /** Epoch milliseconds. */
  endedAt: number | null;
}

export interface RunStateInput {
  record: RecordFacts | null;
  journalMtimeMs: number;
  /** Called only when no current record decides the state. */
  isLive(): Promise<boolean>;
}

/**
 * Completed or Killed from a current run record; without one, Running while a live Claude
 * process owns the run, else Stopped.
 */
export async function decideRunState(input: RunStateInput): Promise<RunStatus> {
  const record = currentRecord(input);
  if (record !== null) {
    const finished: RunState = record.killed ? "killed" : "completed";
    return { state: finished, endedAt: record.endedAt };
  }
  const live = await input.isLive();
  const unfinished: RunState = live ? "running" : "stopped";
  return { state: unfinished, endedAt: null };
}

/** The record, unless a resume has changed the journal since the record was written. */
function currentRecord(input: RunStateInput): RecordFacts | null {
  const { record, journalMtimeMs } = input;
  const endedAt = record?.endedAt ?? null;
  if (endedAt === null) return record;
  const resumedSince = journalMtimeMs > endedAt + RECORD_STALE_AFTER_MS;
  return resumedSince ? null : record;
}
