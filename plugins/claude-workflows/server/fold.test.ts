import { describe, expect, it } from "vitest";
import {
  displayFile,
  foldAgentLine,
  foldJournalLine,
  isCandidateLine,
  journalAgents,
  newAgentFold,
  newJournalFold,
  type AgentFold,
  type JournalAgent,
} from "./fold.js";

const CWD = "/work/project";
const T0 = Date.UTC(2026, 10, 7, 9, 0, 0);

interface Started {
  key: string;
  agentId: string;
  label: string;
  phase: string;
}

const READ_A: Started = { key: "read-a", agentId: "a1", label: "Read a.txt", phase: "Read" };
const READ_B: Started = { key: "read-b", agentId: "b1", label: "Read b.txt", phase: "Read" };

function started(agent: Started): string {
  return JSON.stringify({ type: "started", ...agent });
}

function result(agent: Started): string {
  return JSON.stringify({ type: "result", key: agent.key, agentId: agent.agentId, result: "x" });
}

function failed(agent: Started): string {
  return JSON.stringify({ type: "failed", key: agent.key, agentId: agent.agentId });
}

function foldJournal(lines: string[]): JournalAgent[] {
  const fold = newJournalFold();
  for (const line of lines) foldJournalLine(fold, line);
  return journalAgents(fold);
}

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AssistantTurn {
  seconds: number;
  content: unknown[];
  usage: unknown;
}

const READ: ToolCall = { id: "toolu_1", name: "Read", input: { file_path: `${CWD}/src/a.ts` } };
const BASH: ToolCall = { id: "toolu_2", name: "Bash", input: { command: "fixture command" } };
const TEXT = { type: "text", text: "fixture reply" };
const USAGE = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 100,
  cache_creation_input_tokens: 20,
};

function at(seconds: number): string {
  return new Date(T0 + seconds * 1000).toISOString();
}

function toolUse(tool: ToolCall): Record<string, unknown> {
  return { type: "tool_use", ...tool };
}

function assistantLine(turn: AssistantTurn): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: at(turn.seconds),
    cwd: CWD,
    message: { role: "assistant", content: turn.content, usage: turn.usage },
  });
}

function toolResult(seconds: number, toolUseId: string): string {
  const block = { type: "tool_result", tool_use_id: toolUseId, content: "fixture output" };
  return JSON.stringify({
    type: "user",
    timestamp: at(seconds),
    message: { role: "user", content: [block] },
  });
}

/** Folds lines the way the run reader does: candidate lines only. */
function foldAgent(lines: string[]): AgentFold {
  const fold = newAgentFold();
  for (const line of lines) {
    if (isCandidateLine(line)) foldAgentLine(fold, line);
  }
  return fold;
}

describe("journal fold", () => {
  it("keeps the newest started per key, in start order", () => {
    const agents = foldJournal([
      JSON.stringify({ type: "launched" }),
      started(READ_A),
      started(READ_B),
      result(READ_B),
      failed(READ_A),
      started({ ...READ_A, agentId: "a2" }),
    ]);

    expect(agents).toEqual([
      { ...READ_B, outcome: "done", order: 1 },
      { ...READ_A, agentId: "a2", outcome: null, order: 2 },
    ]);
  });

  it("marks a failed agent and ignores an outcome for a replaced attempt", () => {
    const agents = foldJournal([
      started(READ_A),
      failed(READ_A),
      started(READ_B),
      started({ ...READ_B, agentId: "b2" }),
      result(READ_B),
    ]);

    expect(agents).toEqual([
      { ...READ_A, outcome: "failed", order: 0 },
      { ...READ_B, agentId: "b2", outcome: null, order: 2 },
    ]);
  });

  it("skips launched, unknown, incomplete and garbled lines", () => {
    const fold = newJournalFold();
    const lines = [
      JSON.stringify({ type: "launched" }),
      JSON.stringify({ type: "paused", key: "read-a", agentId: "a1" }),
      JSON.stringify({ type: "started", key: "", agentId: "a1" }),
      JSON.stringify({ type: "started", key: "read-a" }),
      '{"type":"started","key":"read-a","agentId":"a1"',
      "",
    ];
    for (const line of lines) foldJournalLine(fold, line);

    expect(fold.starts).toBe(0);
    expect(journalAgents(fold)).toEqual([]);
  });

  it("falls back to the key for a missing label and to no phase", () => {
    const agents = foldJournal([
      JSON.stringify({ type: "started", key: "report", agentId: "c1", label: 42 }),
    ]);

    expect(agents).toEqual([
      { key: "report", agentId: "c1", label: "report", phase: "", outcome: null, order: 0 },
    ]);
  });
});

describe("agent-file fold", () => {
  it("counts tool_use blocks and keeps the newest as the last tool", () => {
    const fold = foldAgent([
      assistantLine({ seconds: 1, content: [toolUse(READ)], usage: USAGE }),
      toolResult(2, READ.id),
      assistantLine({ seconds: 3, content: [toolUse(BASH)], usage: USAGE }),
    ]);

    expect(fold.toolCalls).toBe(2);
    expect(fold.lastTool).toEqual({ id: "toolu_2", name: "Bash", file: null, done: false });
  });

  it("marks the last tool done only when its own result arrives", () => {
    const fold = foldAgent([
      assistantLine({ seconds: 1, content: [toolUse(READ)], usage: USAGE }),
      assistantLine({ seconds: 2, content: [toolUse(BASH)], usage: USAGE }),
      toolResult(3, READ.id),
    ]);
    expect(fold.lastTool).toEqual({ id: "toolu_2", name: "Bash", file: null, done: false });

    foldAgentLine(fold, toolResult(4, BASH.id));
    expect(fold.lastTool).toEqual({ id: "toolu_2", name: "Bash", file: null, done: true });
  });

  it("takes tokens from the newest usage, counting cache reads and cache writes", () => {
    const first = assistantLine({ seconds: 1, content: [toolUse(READ)], usage: USAGE });
    const newer = assistantLine({
      seconds: 2,
      content: [TEXT],
      usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: null },
    });

    expect(foldAgent([first]).tokens).toBe(135);
    expect(foldAgent([first, newer]).tokens).toBe(3);
  });

  it("ignores a usage of unknown shape and keeps the line's tool call", () => {
    const fold = foldAgent([
      assistantLine({ seconds: 1, content: [toolUse(READ)], usage: { input_tokens: "many" } }),
    ]);

    expect(fold.toolCalls).toBe(1);
    expect(fold.tokens).toBeNull();
  });

  it("records the first and last activity from line timestamps", () => {
    const untimed = JSON.stringify({
      type: "assistant",
      timestamp: "not a time",
      message: { content: [], usage: USAGE },
    });
    const fold = foldAgent([
      assistantLine({ seconds: 5, content: [toolUse(READ)], usage: USAGE }),
      toolResult(3, READ.id),
      untimed,
      assistantLine({ seconds: 9, content: [toolUse(BASH)], usage: USAGE }),
    ]);

    expect([fold.firstActivityAt, fold.lastActivityAt]).toEqual([T0 + 3000, T0 + 9000]);
  });

  it("does not count a prompt that mentions tool_use", () => {
    const prompt = JSON.stringify({
      type: "user",
      timestamp: at(1),
      message: { role: "user", content: 'Reply with {"type":"tool_use","name":"Bash"}' },
    });
    const fold = newAgentFold();
    foldAgentLine(fold, prompt);

    expect(isCandidateLine(prompt)).toBe(false);
    expect(fold.toolCalls).toBe(0);
    expect(isCandidateLine(toolResult(2, READ.id))).toBe(true);
    expect(isCandidateLine(assistantLine({ seconds: 3, content: [TEXT], usage: USAGE }))).toBe(
      true,
    );
  });
});

describe("displayFile", () => {
  it("shows a file inside the cwd relative to it, and one outside by its base name", () => {
    expect(displayFile({ file_path: `${CWD}/src/a.ts` }, CWD)).toBe("src/a.ts");
    expect(displayFile({ file_path: "/etc/hosts" }, CWD)).toBe("hosts");
    expect(displayFile({ file_path: "/work/project-other/b.ts" }, CWD)).toBe("b.ts");
    expect(displayFile({ file_path: CWD }, CWD)).toBe("project");
  });

  it("has no file without a non-empty string file_path, and a base name without a cwd", () => {
    const inputs: unknown[] = [
      { command: "ls" },
      { file_path: "" },
      { file_path: 7 },
      null,
      "a.ts",
    ];

    expect(inputs.map((input) => displayFile(input, CWD))).toEqual([null, null, null, null, null]);
    expect(displayFile({ file_path: `${CWD}/a.ts` }, undefined)).toBe("a.ts");
    expect(displayFile({ file_path: "src/b.ts" }, CWD)).toBe("b.ts");
  });
});
