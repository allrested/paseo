import { join } from "node:path";
import {
  RunViewSchema,
  type AgentState,
  type LastTool,
  type LoadedRun,
  type RunAgent,
  type RunRequest,
  type RunState,
  type RunView,
  type UnavailableReason,
} from "../shared/run.js";
import { readAgentFacts, type AgentDirectory } from "./agent.js";
import type { RunCache } from "./cache.js";
import { isFileError, isMissing } from "./files.js";
import {
  foldAgentLine,
  foldJournalLine,
  isCandidateLine,
  journalAgents,
  newAgentFold,
  newJournalFold,
  type AgentFold,
  type JournalAgent,
  type JournalFold,
  type LastToolUse,
} from "./fold.js";
import { claudeConfigDirs, locateRun, type RunLocation } from "./locate.js";
import { newCursor, readNewLines, type FileCursor, type LineSink } from "./reader.js";
import {
  decideRunState,
  hasLiveSession,
  readRecordFacts,
  RunRecordUnreadableError,
} from "./state.js";

/** A journal agent id names a file only when it is made of these characters. */
const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

interface JournalFile {
  cursor: FileCursor;
  fold: JournalFold;
  mtimeMs: number;
}

interface AgentFile {
  cursor: FileCursor;
  fold: AgentFold;
  unreadable: boolean;
}

/** What the cache keeps for one run dir: each file's cursor and fold. */
export interface RunFiles {
  journal: JournalFile;
  /** By agent id. */
  agents: Map<string, AgentFile>;
}

export function newRunFiles(): RunFiles {
  const journal = { cursor: newCursor(), fold: newJournalFold(), mtimeMs: 0 };
  return { journal, agents: new Map() };
}

export interface RunEnvironment {
  agents: AgentDirectory;
  home: string;
  env: NodeJS.ProcessEnv;
  /** `/proc`, or a fake one in tests. */
  procRoot: string;
  cache: RunCache<RunFiles>;
}

/** The RPC handler body: the run's view, checked by the shared schema before it leaves. */
export async function loadRun(request: RunRequest, environment: RunEnvironment): Promise<RunView> {
  const view = await buildView(request, environment);
  return RunViewSchema.parse(view);
}

async function buildView(request: RunRequest, environment: RunEnvironment): Promise<RunView> {
  const facts = await readAgentFacts(environment.agents, request.agentId);
  if (facts.kind === "unavailable") return unavailable(facts.reason);
  const { sessionId, cwd } = facts;
  try {
    const configDirs = await claudeConfigDirs(environment);
    const location = await locateRun({ configDirs, cwd, sessionId, runId: request.runId });
    if (location === null) return unavailable("run-not-found");
    const input = { location, runId: request.runId, procRoot: environment.procRoot };
    return await environment.cache.use(location.runDir, (files) => readRun(files, input));
  } catch (error) {
    // The run dir or its journal went away since it was located.
    if (isMissing(error)) return unavailable("run-not-found");
    if (error instanceof RunRecordUnreadableError) return unavailable("run-unreadable");
    if (isFileError(error)) return unavailable("run-unreadable");
    throw error;
  }
}

interface ReadRunInput {
  location: RunLocation;
  runId: string;
  procRoot: string;
}

interface AgentRow {
  agent: JournalAgent;
  file: AgentFile;
}

async function readRun(files: RunFiles, input: ReadRunInput): Promise<LoadedRun> {
  const { location } = input;
  const { journal } = files;
  const journalPath = join(location.runDir, "journal.jsonl");
  const sink = journalSink(journal);
  const { mtimeMs } = await readNewLines({ path: journalPath, cursor: journal.cursor, sink });
  journal.mtimeMs = mtimeMs;
  const agents = journalAgents(journal.fold);
  dropReplacedAttempts(files, agents);
  const rows: AgentRow[] = [];
  for (const agent of agents) {
    const file = await refreshAgent({ files, runDir: location.runDir, agentId: agent.agentId });
    rows.push({ agent, file });
  }
  const record = await readRecordFacts(
    join(location.sessionDir, "workflows", `${input.runId}.json`),
  );
  // Until the newest agent writes, its start is known only from the journal.
  const newest = rows.at(-1);
  const startedBy = newest?.file.fold.firstActivityAt ?? journal.mtimeMs;
  // The session the run was found in, which may be one the agent has left (Decision 5).
  const query = {
    configDir: location.configDir,
    sessionId: location.sessionId,
    startedBy,
    procRoot: input.procRoot,
  };
  const status = await decideRunState({
    record,
    journalMtimeMs: journal.mtimeMs,
    isLive: () => hasLiveSession(query),
  });
  const runAgents = rows.map((row) => toRunAgent(row, status.state));
  const name = record?.name ?? null;
  return { state: status.state, name, endedAt: status.endedAt, agents: runAgents };
}

function journalSink(journal: JournalFile): LineSink {
  return {
    restart() {
      journal.fold = newJournalFold();
    },
    line(text) {
      foldJournalLine(journal.fold, text);
    },
  };
}

function agentSink(file: AgentFile): LineSink {
  return {
    restart() {
      file.fold = newAgentFold();
    },
    line(text) {
      if (isCandidateLine(text)) foldAgentLine(file.fold, text);
    },
  };
}

/** Forgets the files of attempts a rerun replaced, so the cache holds current agents only. */
function dropReplacedAttempts(files: RunFiles, agents: JournalAgent[]): void {
  const current = new Set(agents.map((agent) => agent.agentId));
  for (const agentId of files.agents.keys()) {
    if (!current.has(agentId)) files.agents.delete(agentId);
  }
}

interface AgentRead {
  files: RunFiles;
  runDir: string;
  agentId: string;
}

/** Reads what the agent wrote since the last call. A file error marks only this agent unreadable. */
async function refreshAgent(read: AgentRead): Promise<AgentFile> {
  const { files, runDir, agentId } = read;
  const file = files.agents.get(agentId) ?? newAgentFile();
  files.agents.set(agentId, file);
  if (!AGENT_ID_PATTERN.test(agentId)) {
    file.unreadable = true;
    return file;
  }
  const path = join(runDir, `agent-${agentId}.jsonl`);
  try {
    await readNewLines({ path, cursor: file.cursor, sink: agentSink(file) });
    file.unreadable = false;
  } catch (error) {
    if (!isFileError(error)) throw error;
    // A missing file means the agent has started but not written yet.
    file.unreadable = !isMissing(error);
  }
  return file;
}

function newAgentFile(): AgentFile {
  return { cursor: newCursor(), fold: newAgentFold(), unreadable: false };
}

function toRunAgent(row: AgentRow, runState: RunState): RunAgent {
  const { agent, file } = row;
  const state = agentState(row, runState);
  const lastTool = lastToolView(file.fold.lastTool, state);
  const { toolCalls, tokens, firstActivityAt, lastActivityAt } = file.fold;
  const { key, label, phase } = agent;
  return { key, label, phase, state, toolCalls, lastTool, tokens, firstActivityAt, lastActivityAt };
}

function agentState(row: AgentRow, runState: RunState): AgentState {
  if (row.file.unreadable) return "unreadable";
  if (row.agent.outcome !== null) return row.agent.outcome;
  return runState === "running" ? "running" : "stopped";
}

function lastToolView(lastTool: LastToolUse | null, state: AgentState): LastTool | null {
  if (lastTool === null) return null;
  const running = state === "running" && !lastTool.done;
  return { name: lastTool.name, file: lastTool.file, running };
}

function unavailable(reason: UnavailableReason): RunView {
  return { state: "unavailable", reason };
}
