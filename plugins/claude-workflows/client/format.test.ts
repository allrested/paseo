import { describe, expect, it } from "vitest";
import type { LoadedRun, RunAgent, RunView } from "../shared/run.js";
import {
  AGENT_STATE_LABELS,
  LOAD_FAILED,
  LOADING,
  NO_AGENTS,
  POLL_MS,
  REFRESH_FAILED,
  RUN_STATE_LABELS,
  UNAVAILABLE_COPY,
  UNREADABLE_AGENT,
  describeAgent,
  describeTotals,
  formatAgo,
  formatDuration,
  formatTokens,
  groupByPhase,
  isCardOpen,
  pollInterval,
  refreshNote,
  statusLine,
  summaryText,
} from "./format.js";

const NOW = Date.UTC(2026, 10, 7, 9, 10, 0);

function agent(fields: Partial<RunAgent>): RunAgent {
  return {
    key: "read-a",
    label: "Read a.txt",
    phase: "Read",
    state: "running",
    toolCalls: 0,
    lastTool: null,
    tokens: null,
    firstActivityAt: null,
    lastActivityAt: null,
    ...fields,
  };
}

const DONE = agent({
  key: "read-a",
  state: "done",
  toolCalls: 5,
  tokens: 41_200,
  firstActivityAt: NOW - 130_000,
  lastActivityAt: NOW - 60_000,
});
const FAILED = agent({
  key: "read-b",
  state: "failed",
  toolCalls: 4,
  tokens: 10_900,
  firstActivityAt: NOW - 120_000,
  lastActivityAt: NOW - 90_000,
});
const RUNNING = agent({
  key: "report",
  phase: "Report",
  state: "running",
  toolCalls: 5,
  firstActivityAt: NOW - 100_000,
  lastActivityAt: NOW - 10_000,
});

function run(fields: Partial<LoadedRun>): LoadedRun {
  return {
    state: "running",
    name: null,
    endedAt: null,
    agents: [DONE, FAILED, RUNNING],
    ...fields,
  };
}

const UNAVAILABLE: RunView = { state: "unavailable", reason: "run-not-found" };

describe("card format", () => {
  it("polls only while the run is Running", () => {
    expect(pollInterval(run({}))).toBe(POLL_MS);
    expect(POLL_MS).toBe(3000);
    const finished = [
      run({ state: "completed" }),
      run({ state: "killed" }),
      run({ state: "stopped" }),
    ];
    expect(finished.map((view) => pollInterval(view))).toEqual([false, false, false]);
    expect(pollInterval(UNAVAILABLE)).toBe(false);
    expect(pollInterval(undefined)).toBe(false);
  });

  it("totals a running run up to now", () => {
    expect(describeTotals(run({}), NOW)).toBe(
      "3 agents · 1 done · 1 failed · 14 tool calls · 52.1k tokens · 2m 10s",
    );
  });

  it("ends a finished run's elapsed time at its record, else at its latest activity", () => {
    const completed = run({ state: "completed", endedAt: NOW - 5_000 });
    const stopped = run({ state: "stopped" });

    expect(describeTotals(completed, NOW)).toBe(
      "3 agents · 1 done · 1 failed · 14 tool calls · 52.1k tokens · 2m 5s",
    );
    expect(describeTotals(stopped, NOW)).toBe(
      "3 agents · 1 done · 1 failed · 14 tool calls · 52.1k tokens · 2m 0s",
    );
  });

  it("leaves out tokens and time until an agent reports them", () => {
    const quiet = run({ agents: [agent({ toolCalls: 1 })] });

    expect(describeTotals(quiet, NOW)).toBe("1 agent · 0 done · 0 failed · 1 tool call");
  });

  it("formats durations, token counts and ages", () => {
    const durations = [9_000, 130_000, 3_720_000, 90_000_000];
    expect(durations.map((ms) => formatDuration(ms))).toEqual(["9s", "2m 10s", "1h 2m", "1d 1h"]);
    const tokens = [950, 41_200, 99_960, 152_000, 2_300_000];
    expect(tokens.map((count) => formatTokens(count))).toEqual([
      "950",
      "41.2k",
      "100k",
      "152k",
      "2.3M",
    ]);
    const times = [NOW - 5_000, NOW - 150_000, NOW - 7_500_000, NOW - 190_000_000, NOW + 3_000];
    expect(times.map((at) => formatAgo(at, NOW))).toEqual([
      "5s ago",
      "2m ago",
      "2h ago",
      "2d ago",
      "0s ago",
    ]);
  });

  it("describes an agent row", () => {
    const working = agent({
      toolCalls: 3,
      lastTool: { name: "Read", file: "src/a.ts", running: true },
      tokens: 41_200,
      lastActivityAt: NOW - 120_000,
    });
    const shell = agent({ toolCalls: 1, lastTool: { name: "Bash", file: null, running: false } });

    expect(describeAgent(working, NOW)).toBe(
      "3 tool calls · Read src/a.ts (running) · 41.2k tokens · 2m ago",
    );
    expect(describeAgent(shell, NOW)).toBe("1 tool call · Bash");
    expect(describeAgent(agent({ state: "unreadable" }), NOW)).toBe(UNREADABLE_AGENT);
  });

  it("groups agents by phase in start order", () => {
    const readA = agent({ key: "read-a", phase: "Read" });
    const report = agent({ key: "report", phase: "Report" });
    const readB = agent({ key: "read-b", phase: "Read" });

    expect(groupByPhase([readA, report, readB])).toEqual([
      { phase: "Read", agents: [readA, readB] },
      { phase: "Report", agents: [report] },
    ]);
    expect(groupByPhase([])).toEqual([]);
  });

  it("says what the header knows", () => {
    expect(statusLine({ view: undefined, failed: false, now: NOW })).toBe(LOADING);
    expect(statusLine({ view: undefined, failed: true, now: NOW })).toBe(LOAD_FAILED);
    expect(statusLine({ view: UNAVAILABLE, failed: false, now: NOW })).toBe("Run files not found");
    expect(statusLine({ view: run({}), failed: true, now: NOW })).toBe(
      describeTotals(run({}), NOW),
    );
  });

  it("notes a failed refresh only while an earlier view is kept", () => {
    expect(refreshNote(run({}), true)).toBe(REFRESH_FAILED);
    expect(refreshNote(UNAVAILABLE, true)).toBe(REFRESH_FAILED);
    expect(refreshNote(run({}), false)).toBeNull();
    expect(refreshNote(undefined, true)).toBeNull();
    expect(refreshNote(undefined, false)).toBeNull();
    // The kept view still decides the interval, so the next poll is the retry.
    expect(pollInterval(run({}))).toBe(POLL_MS);
  });

  it("titles the card with the summary, else the run's name", () => {
    const named = run({ name: "read-files" });

    expect(summaryText("Read three files", named)).toBe("Read three files");
    expect(summaryText(null, named)).toBe("read-files");
    expect(summaryText(null, run({}))).toBeNull();
    expect(summaryText(null, UNAVAILABLE)).toBeNull();
    expect(summaryText(null, undefined)).toBeNull();
  });

  it("opens a Running card until the user chooses", () => {
    expect(isCardOpen(run({}), null)).toBe(true);
    expect(isCardOpen(run({ state: "completed" }), null)).toBe(false);
    expect(isCardOpen(run({ state: "completed" }), true)).toBe(true);
    expect(isCardOpen(run({}), false)).toBe(false);
    expect(isCardOpen(null, true)).toBe(false);
  });

  it("follows the copy rules of docs/design.md section 10", () => {
    const copy = [
      LOADING,
      LOAD_FAILED,
      REFRESH_FAILED,
      UNREADABLE_AGENT,
      NO_AGENTS,
      ...Object.values(RUN_STATE_LABELS),
      ...Object.values(AGENT_STATE_LABELS),
      ...Object.values(UNAVAILABLE_COPY),
    ];
    for (const text of copy) {
      expect(text).not.toContain("…");
      expect(text.endsWith(".") && !text.endsWith("...")).toBe(false);
      expect(text.charAt(0)).toBe(text.charAt(0).toUpperCase());
    }
    expect(LOADING).toBe("Loading...");
  });
});
