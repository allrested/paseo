import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentState, LoadedRun, RunAgent, RunRequest, RunView } from "../shared/run.js";
import type { AgentDirectory, AgentSnapshot } from "./agent.js";
import { createRunCache } from "./cache.js";
import { projectSlug } from "./locate.js";
import { loadRun, newRunFiles, type RunEnvironment } from "./run.js";

const SESSION_ID = "0f8c2d4e-1a2b-4c3d-8e9f-0123456789ab";
/** The agent's session after a `/clear` or a restart; its earlier runs stay in SESSION_ID. */
const LATER_SESSION_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const RUN_ID = "wf_0a1b2c3d-4e5";
const AGENT_ID = "agent-claude";
const T0 = Date.UTC(2026, 10, 7, 9, 0, 0);
const PID = 4_000_001;
const START_TIME = "873421";
/** Prompts, results, commands and tool output in the fixtures carry this; no view may. */
const PRIVATE = "PRIVATE-7f3a";
const REQUEST: RunRequest = { agentId: AGENT_ID, runId: RUN_ID };

interface Fixture {
  root: string;
  home: string;
  configDir: string;
  cwd: string;
  sessionDir: string;
  runDir: string;
  procRoot: string;
}

let fixture: Fixture;

beforeEach(async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "claude-workflows-run-")));
  const home = join(root, "home");
  const configDir = join(home, ".claude");
  const cwd = join(root, "project");
  await mkdir(cwd);
  const sessionDir = join(configDir, "projects", await projectSlug(cwd), SESSION_ID);
  const runDir = join(sessionDir, "subagents", "workflows", RUN_ID);
  const procRoot = join(root, "proc");
  await mkdir(runDir, { recursive: true });
  await mkdir(procRoot);
  fixture = { root, home, configDir, cwd, sessionDir, runDir, procRoot };
});

afterEach(async () => {
  await rm(fixture.root, { recursive: true, force: true });
});

interface Started {
  key: string;
  agentId: string;
  label: string;
  phase: string;
}

const READ_A: Started = { key: "read-a", agentId: "a1", label: "Read a.txt", phase: "Read" };
const READ_B: Started = { key: "read-b", agentId: "b1", label: "Read b.txt", phase: "Read" };
const REPORT: Started = { key: "report", agentId: "c1", label: "Report", phase: "Report" };
const READ_A_AGAIN: Started = { ...READ_A, agentId: "a2" };

function started(agent: Started): string {
  return JSON.stringify({ type: "started", ...agent });
}

function result(agent: Started): string {
  const text = `${PRIVATE} result`;
  return JSON.stringify({ type: "result", key: agent.key, agentId: agent.agentId, result: text });
}

function failed(agent: Started): string {
  return JSON.stringify({ type: "failed", key: agent.key, agentId: agent.agentId });
}

function jsonl(lines: string[]): string {
  return lines.map((line) => `${line}\n`).join("");
}

function journalPath(): string {
  return join(fixture.runDir, "journal.jsonl");
}

function agentPath(agentId: string): string {
  return join(fixture.runDir, `agent-${agentId}.jsonl`);
}

/** Sets the journal's mtime. Writing the journal sets it to the real time, so tests set it last. */
async function journalTouchedAt(seconds: number): Promise<void> {
  const time = new Date(T0 + seconds * 1000);
  await utimes(journalPath(), time, time);
}

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AssistantTurn {
  seconds: number;
  tool: ToolCall;
  /** The context size the line reports. */
  tokens: number;
}

function at(seconds: number): string {
  return new Date(T0 + seconds * 1000).toISOString();
}

function assistantLine(turn: AssistantTurn): string {
  const usage = {
    input_tokens: 2,
    cache_read_input_tokens: turn.tokens - 10,
    cache_creation_input_tokens: 0,
    output_tokens: 8,
  };
  const content = [{ type: "tool_use", ...turn.tool }];
  return JSON.stringify({
    type: "assistant",
    timestamp: at(turn.seconds),
    cwd: fixture.cwd,
    message: { role: "assistant", content, usage },
  });
}

function toolResultLine(seconds: number, toolUseId: string): string {
  const block = { type: "tool_result", tool_use_id: toolUseId, content: `${PRIVATE} output` };
  return JSON.stringify({
    type: "user",
    timestamp: at(seconds),
    message: { role: "user", content: [block] },
  });
}

function promptLine(seconds: number): string {
  return JSON.stringify({
    type: "user",
    timestamp: at(seconds),
    message: { role: "user", content: `${PRIVATE} prompt` },
  });
}

function readTool(id: string, file: string): ToolCall {
  return { id, name: "Read", input: { file_path: join(fixture.cwd, file) } };
}

function editTool(id: string, file: string): ToolCall {
  const input = { file_path: join(fixture.cwd, file), old_string: PRIVATE, new_string: PRIVATE };
  return { id, name: "Edit", input };
}

function bashTool(id: string): ToolCall {
  return { id, name: "Bash", input: { command: `${PRIVATE} command` } };
}

function grepTool(id: string): ToolCall {
  return { id, name: "Grep", input: { pattern: PRIVATE, path: fixture.cwd } };
}

async function writeRecord(status: string, endedSeconds: number): Promise<void> {
  const dir = join(fixture.sessionDir, "workflows");
  await mkdir(dir, { recursive: true });
  const progress = {
    label: "Read a.txt",
    promptPreview: `${PRIVATE} prompt`,
    resultPreview: `${PRIVATE} result`,
    lastToolSummary: `${PRIVATE} command`,
  };
  const body = {
    status,
    timestamp: at(endedSeconds),
    workflowName: "read-files",
    workflowProgress: [progress],
  };
  await writeFile(join(dir, `${RUN_ID}.json`), JSON.stringify(body));
}

/** A live Claude process for the session, started at T0 plus `startedSeconds`. */
async function liveSession(startedSeconds: number): Promise<void> {
  const sessions = join(fixture.configDir, "sessions");
  await mkdir(sessions, { recursive: true });
  const session = {
    pid: PID,
    sessionId: SESSION_ID,
    procStart: START_TIME,
    startedAt: T0 + startedSeconds * 1000,
  };
  await writeFile(join(sessions, `${PID}.json`), JSON.stringify(session));
  await mkdir(join(fixture.procRoot, String(PID)));
  const stat = `${PID} (claude) S 1 ${PID} ${PID} 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 ${START_TIME} 0 0\n`;
  await writeFile(join(fixture.procRoot, String(PID), "stat"), stat);
}

/** Overwrites a file's bytes with spaces in place, keeping its newlines, size and inode. */
async function blankInPlace(path: string): Promise<void> {
  const handle = await open(path, "r+");
  try {
    const bytes = await handle.readFile();
    const blank = bytes.map((byte) => (byte === 0x0a ? byte : 0x20));
    await handle.write(blank, 0, blank.length, 0);
  } finally {
    await handle.close();
  }
}

function claudeAgent(): AgentSnapshot {
  return { id: AGENT_ID, cwd: fixture.cwd, persistence: { sessionId: SESSION_ID } };
}

/** `paseo.agents` in memory: answers like fetch_agent, null for an unknown id. */
function directory(snapshots: AgentSnapshot[]): AgentDirectory {
  return {
    ref(agentId) {
      return {
        async refresh() {
          const agent = snapshots.find((snapshot) => snapshot.id === agentId);
          if (agent === undefined) return null;
          return { agent };
        },
      };
    },
  };
}

function environment(agents: AgentDirectory): RunEnvironment {
  const cache = createRunCache({ create: newRunFiles, now: () => T0 });
  return { agents, home: fixture.home, env: {}, procRoot: fixture.procRoot, cache };
}

function claudeEnvironment(): RunEnvironment {
  return environment(directory([claudeAgent()]));
}

function loaded(view: RunView): LoadedRun {
  if (view.state === "unavailable") throw new Error(`unexpected unavailable view: ${view.reason}`);
  return view;
}

/** a1 read a.txt and finished; b1 is running Bash; c1 has started but not written yet. */
async function threeAgentRun(): Promise<void> {
  await writeFile(
    journalPath(),
    jsonl([
      JSON.stringify({ type: "launched" }),
      started(READ_A),
      started(READ_B),
      result(READ_A),
      started(REPORT),
    ]),
  );
  await writeFile(
    agentPath("a1"),
    jsonl([
      promptLine(1),
      assistantLine({ seconds: 2, tool: readTool("toolu_a1", "a.txt"), tokens: 1200 }),
      toolResultLine(3, "toolu_a1"),
    ]),
  );
  await writeFile(
    agentPath("b1"),
    jsonl([promptLine(1), assistantLine({ seconds: 4, tool: bashTool("toolu_b1"), tokens: 2500 })]),
  );
  await journalTouchedAt(4);
}

interface PendingStates {
  readB: AgentState;
  report: AgentState;
}

/** threeAgentRun's agents as the view shows them, given the states of the two without an outcome. */
function threeAgents(states: PendingStates): RunAgent[] {
  const bashRunning = states.readB === "running";
  return [
    {
      key: "read-a",
      label: "Read a.txt",
      phase: "Read",
      state: "done",
      toolCalls: 1,
      lastTool: { name: "Read", file: "a.txt", running: false },
      tokens: 1200,
      firstActivityAt: T0 + 2000,
      lastActivityAt: T0 + 3000,
    },
    {
      key: "read-b",
      label: "Read b.txt",
      phase: "Read",
      state: states.readB,
      toolCalls: 1,
      lastTool: { name: "Bash", file: null, running: bashRunning },
      tokens: 2500,
      firstActivityAt: T0 + 4000,
      lastActivityAt: T0 + 4000,
    },
    {
      key: "report",
      label: "Report",
      phase: "Report",
      state: states.report,
      toolCalls: 0,
      lastTool: null,
      tokens: null,
      firstActivityAt: null,
      lastActivityAt: null,
    },
  ];
}

describe("loadRun", () => {
  it("shows a running run with each agent's progress", async () => {
    await threeAgentRun();
    await liveSession(0);

    await expect(loadRun(REQUEST, claudeEnvironment())).resolves.toEqual({
      state: "running",
      name: null,
      endedAt: null,
      agents: threeAgents({ readB: "running", report: "running" }),
    });
  });

  it("shows a completed run from its record", async () => {
    await threeAgentRun();
    await appendFile(journalPath(), jsonl([result(READ_B), result(REPORT)]));
    await writeRecord("completed", 10);
    await journalTouchedAt(9);

    await expect(loadRun(REQUEST, claudeEnvironment())).resolves.toEqual({
      state: "completed",
      name: "read-files",
      endedAt: T0 + 10_000,
      agents: threeAgents({ readB: "done", report: "done" }),
    });
  });

  it("shows a killed run from its record while its process still lives", async () => {
    await threeAgentRun();
    await writeRecord("killed", 10);
    await journalTouchedAt(9);
    await liveSession(0);

    await expect(loadRun(REQUEST, claudeEnvironment())).resolves.toEqual({
      state: "killed",
      name: "read-files",
      endedAt: T0 + 10_000,
      agents: threeAgents({ readB: "stopped", report: "stopped" }),
    });
  });

  it("shows a run without a record or a live process as Stopped", async () => {
    await threeAgentRun();

    await expect(loadRun(REQUEST, claudeEnvironment())).resolves.toEqual({
      state: "stopped",
      name: null,
      endedAt: null,
      agents: threeAgents({ readB: "stopped", report: "stopped" }),
    });
  });

  it("shows Stopped when the session's process started after the run's newest agent", async () => {
    await threeAgentRun();
    await liveSession(5);

    await expect(loadRun(REQUEST, claudeEnvironment())).resolves.toEqual({
      state: "stopped",
      name: null,
      endedAt: null,
      agents: threeAgents({ readB: "stopped", report: "stopped" }),
    });
  });

  it("follows a resumed run: Running from its new agent's start, then with its progress", async () => {
    await writeFile(
      journalPath(),
      jsonl([started(READ_A), started(READ_B), result(READ_B), failed(READ_A)]),
    );
    await writeFile(
      agentPath("a1"),
      jsonl([assistantLine({ seconds: 2, tool: readTool("toolu_a1", "a.txt"), tokens: 900 })]),
    );
    await writeFile(
      agentPath("b1"),
      jsonl([
        assistantLine({ seconds: 3, tool: grepTool("toolu_b1"), tokens: 700 }),
        toolResultLine(4, "toolu_b1"),
      ]),
    );
    await writeRecord("killed", 10);
    await appendFile(journalPath(), jsonl([started(READ_A_AGAIN)]));
    await journalTouchedAt(13);
    await liveSession(12);
    const env = claudeEnvironment();
    const readB: RunAgent = {
      key: "read-b",
      label: "Read b.txt",
      phase: "Read",
      state: "done",
      toolCalls: 1,
      lastTool: { name: "Grep", file: null, running: false },
      tokens: 700,
      firstActivityAt: T0 + 3000,
      lastActivityAt: T0 + 4000,
    };
    const readAWaiting: RunAgent = {
      key: "read-a",
      label: "Read a.txt",
      phase: "Read",
      state: "running",
      toolCalls: 0,
      lastTool: null,
      tokens: null,
      firstActivityAt: null,
      lastActivityAt: null,
    };

    await expect(loadRun(REQUEST, env)).resolves.toEqual({
      state: "running",
      name: "read-files",
      endedAt: null,
      agents: [readB, readAWaiting],
    });

    await writeFile(
      agentPath("a2"),
      jsonl([assistantLine({ seconds: 15, tool: readTool("toolu_a2", "a.txt"), tokens: 1100 })]),
    );
    const readAWorking: RunAgent = {
      key: "read-a",
      label: "Read a.txt",
      phase: "Read",
      state: "running",
      toolCalls: 1,
      lastTool: { name: "Read", file: "a.txt", running: true },
      tokens: 1100,
      firstActivityAt: T0 + 15_000,
      lastActivityAt: T0 + 15_000,
    };
    await expect(loadRun(REQUEST, env)).resolves.toEqual({
      state: "running",
      name: "read-files",
      endedAt: null,
      agents: [readB, readAWorking],
    });
  });

  it("reads only what each file gained since the last call", async () => {
    await threeAgentRun();
    await liveSession(0);
    const env = claudeEnvironment();
    await loadRun(REQUEST, env);

    // A reader that went back over b1's old bytes would now find no tool call there.
    await blankInPlace(agentPath("b1"));
    await appendFile(
      agentPath("b1"),
      jsonl([assistantLine({ seconds: 6, tool: editTool("toolu_b2", "b.txt"), tokens: 3000 })]),
    );
    const view = loaded(await loadRun(REQUEST, env));

    expect(view.agents[1]).toEqual({
      key: "read-b",
      label: "Read b.txt",
      phase: "Read",
      state: "running",
      toolCalls: 2,
      lastTool: { name: "Edit", file: "b.txt", running: true },
      tokens: 3000,
      firstActivityAt: T0 + 4000,
      lastActivityAt: T0 + 6000,
    });
  });

  // Root reads a mode-000 file anyway, so the failure cannot be produced as root.
  it.skipIf(process.getuid?.() === 0)(
    "marks only the agent whose file cannot be read",
    async () => {
      await threeAgentRun();
      await liveSession(0);
      await chmod(agentPath("b1"), 0o000);

      const view = loaded(await loadRun(REQUEST, claudeEnvironment()));

      expect(view.state).toBe("running");
      expect(view.agents.map((agent) => agent.state)).toEqual(["done", "unreadable", "running"]);
      expect(view.agents[1]).toEqual({
        key: "read-b",
        label: "Read b.txt",
        phase: "Read",
        state: "unreadable",
        toolCalls: 0,
        lastTool: null,
        tokens: null,
        firstActivityAt: null,
        lastActivityAt: null,
      });
    },
  );

  it("never reads an agent file outside the run's directory", async () => {
    const escaping: Started = {
      key: "escape",
      agentId: "../../../x",
      label: "Escape",
      phase: "Read",
    };
    await writeFile(journalPath(), jsonl([started(escaping)]));
    // Without the guard, `agent-../../../x.jsonl` joined to the run dir lands on this file.
    await writeFile(
      join(fixture.sessionDir, "subagents", "workflows", "x.jsonl"),
      jsonl([assistantLine({ seconds: 2, tool: readTool("toolu_x", "a.txt"), tokens: 1200 })]),
    );

    const view = loaded(await loadRun(REQUEST, claudeEnvironment()));

    expect(view.agents).toEqual([
      {
        key: "escape",
        label: "Escape",
        phase: "Read",
        state: "unreadable",
        toolCalls: 0,
        lastTool: null,
        tokens: null,
        firstActivityAt: null,
        lastActivityAt: null,
      },
    ]);
  });

  it("reports an agent it cannot find a Claude session for", async () => {
    await threeAgentRun();
    const plain: AgentSnapshot = { id: "agent-plain", cwd: fixture.cwd, persistence: null };
    const env = environment(directory([plain]));

    await expect(loadRun({ agentId: "agent-gone", runId: RUN_ID }, env)).resolves.toEqual({
      state: "unavailable",
      reason: "agent-not-found",
    });
    await expect(loadRun({ agentId: "agent-plain", runId: RUN_ID }, env)).resolves.toEqual({
      state: "unavailable",
      reason: "not-claude",
    });
  });

  it("reports run files it cannot find", async () => {
    await mkdir(join(fixture.sessionDir, "subagents", "workflows", "wf_00000000-000"));
    const env = claudeEnvironment();
    const notFound = { state: "unavailable", reason: "run-not-found" };

    for (const runId of ["wf_ffffffff-fff", "wf_00000000-000", "wf_bad"]) {
      await expect(loadRun({ agentId: AGENT_ID, runId }, env)).resolves.toEqual(notFound);
    }
  });

  it("reports a run record it cannot use", async () => {
    await threeAgentRun();
    await mkdir(join(fixture.sessionDir, "workflows"), { recursive: true });
    await writeFile(
      join(fixture.sessionDir, "workflows", `${RUN_ID}.json`),
      JSON.stringify({ status: 3 }),
    );

    await expect(loadRun(REQUEST, claudeEnvironment())).resolves.toEqual({
      state: "unavailable",
      reason: "run-unreadable",
    });
  });

  it("loads the card of a provider-subagent pane from its parent agent", async () => {
    await threeAgentRun();
    await liveSession(0);
    const request = { agentId: `provider:${AGENT_ID}:sub-1`, runId: RUN_ID };

    await expect(loadRun(request, claudeEnvironment())).resolves.toEqual({
      state: "running",
      name: null,
      endedAt: null,
      agents: threeAgents({ readB: "running", report: "running" }),
    });
  });

  it("loads a run from the agent's earlier session and checks that session's process", async () => {
    await threeAgentRun();
    await liveSession(0);
    const moved: AgentSnapshot = { ...claudeAgent(), persistence: { sessionId: LATER_SESSION_ID } };

    await expect(loadRun(REQUEST, environment(directory([moved])))).resolves.toEqual({
      state: "running",
      name: null,
      endedAt: null,
      agents: threeAgents({ readB: "running", report: "running" }),
    });
  });

  it("never puts prompts, results, commands or tool output into the view", async () => {
    await threeAgentRun();
    await appendFile(agentPath("b1"), jsonl([toolResultLine(5, "toolu_b1")]));
    await writeRecord("completed", 10);
    await journalTouchedAt(9);

    const view = await loadRun(REQUEST, claudeEnvironment());

    expect(JSON.stringify(view)).not.toContain(PRIVATE);
  });

  it("fails the call when the agent lookup fails, so the card keeps its data and polls again", async () => {
    const failing: AgentDirectory = {
      ref() {
        return {
          async refresh() {
            throw new Error("daemon connection closed");
          },
        };
      },
    };

    await expect(loadRun(REQUEST, environment(failing))).rejects.toThrow(
      "daemon connection closed",
    );
  });
});
