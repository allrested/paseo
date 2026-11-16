import { expect, test } from "vitest";
import type { OfficeAgent } from "../shared/contracts.js";
import {
  contextLine,
  contextPercent,
  contextTone,
  formatTokens,
  inShownOrder,
  janitorNote,
  janitorRowLabel,
  janitorRows,
  tidyFailure,
} from "./context-text.js";

function agent(id: string, overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: id,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: null,
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-11T08:00:00.000Z",
    ...overrides,
  };
}

const at = (usedTokens: number, maxTokens = 200_000) => ({ context: { usedTokens, maxTokens } });

test("a context's share is a whole percent, never over 100, and unknown without a report", () => {
  expect(contextPercent(agent("a", at(164_000)))).toBe(82);
  expect(contextPercent(agent("a", at(0)))).toBe(0);
  expect(contextPercent(agent("a", at(260_000)))).toBe(100);
  expect(contextPercent(agent("a"))).toBeNull();
});

test("a context is nearly full at 85% and full at 95%", () => {
  expect(contextTone(84)).toBe("muted");
  expect(contextTone(85)).toBe("warning");
  expect(contextTone(94)).toBe("warning");
  expect(contextTone(95)).toBe("danger");
  expect(contextTone(null)).toBe("muted");
});

test("tokens are written short", () => {
  expect(formatTokens(900)).toBe("900");
  expect(formatTokens(2100)).toBe("2.1k");
  expect(formatTokens(164_000)).toBe("164k");
  expect(formatTokens(1_000_000)).toBe("1M");
  expect(formatTokens(1_250_000)).toBe("1.3M");
});

test("an agent's card says how full its context is, and nothing when nobody reports it", () => {
  expect(contextLine(agent("a", at(164_000)))).toBe("Context 82% full, 164k of 200k tokens");
  expect(contextLine(agent("a", { provider: "pi" }))).toBeNull();
});

test("a row reads as one sentence, and names a provider that reports nothing", () => {
  const [full, silent] = janitorRows([
    agent("Planner", at(164_000)),
    agent("Scout", { provider: "pi" }),
  ]);
  expect(full && janitorRowLabel(full)).toBe("Planner: 82% full, 164k of 200k tokens. Idle");
  expect(silent && janitorRowLabel(silent)).toBe("Scout: pi does not report its context. Idle");
});

test("a refusal is a sentence that names what was asked", () => {
  expect(tidyFailure("clean", "The agent is at work")).toBe(
    "Unable to clean the context: The agent is at work",
  );
  expect(tidyFailure("reset", null)).toBe("Unable to reset the session: no reason given");
});

test("the janitor's rows: the fullest first, the unreported last, and who can be tidied", () => {
  const rows = janitorRows([
    agent("half", at(100_000)),
    agent("silent"),
    agent("full", { ...at(190_000), status: "running" }),
    agent("asks", {
      ...at(120_000),
      status: "running",
      permissions: [{ id: "p", kind: "tool", title: "Bash" }],
    }),
    agent("stuck", { ...at(199_000), status: "error" }),
    agent("new", { status: "initializing" }),
  ]);
  expect(rows.map((row) => [row.agentId, row.percent, row.state, row.tidy])).toEqual([
    ["stuck", 100, "Stopped on an error", true],
    ["full", 95, "At work", false],
    ["asks", 60, "Waiting for your answer", false],
    ["half", 50, "Idle", true],
    ["new", null, "Starting", false],
    ["silent", null, "Idle", true],
  ]);
});

test("the janitor leaves an agent that waits on sub-agents alone", () => {
  const rows = janitorRows(
    [agent("lead", at(150_000)), agent("spare", at(100_000))],
    new Map([["lead", 2]]),
  );
  expect(rows.map((row) => [row.agentId, row.state, row.tidy])).toEqual([
    ["lead", "Waiting on 2 sub-agents", false],
    ["spare", "Idle", true],
  ]);
});

test("the janitor's note counts the nearly full, else names the fullest", () => {
  const rows = (...agents: OfficeAgent[]) => janitorRows(agents);
  expect(janitorNote(rows())).toBeNull();
  expect(janitorNote(rows(agent("a")))).toEqual({ text: "No context reported", tone: "muted" });
  expect(janitorNote(rows(agent("a", at(100_000)), agent("b", at(30_000))))).toEqual({
    text: "Fullest context 50%",
    tone: "muted",
  });
  expect(janitorNote(rows(agent("a", at(172_000)), agent("b", at(30_000))))).toEqual({
    text: "1 context nearly full",
    tone: "warning",
  });
  expect(janitorNote(rows(agent("a", at(172_000)), agent("b", at(196_000))))).toEqual({
    text: "2 contexts nearly full",
    tone: "danger",
  });
});

test("an open card keeps its rows where they were, and puts newcomers after them", () => {
  const before = janitorRows([agent("a", at(180_000)), agent("b", at(100_000))]);
  const shown = before.map((row) => row.agentId);
  const after = janitorRows([agent("a", at(0)), agent("b", at(100_000)), agent("c", at(150_000))]);
  expect(after.map((row) => row.agentId)).toEqual(["c", "b", "a"]);
  expect(inShownOrder(shown, after).map((row) => row.agentId)).toEqual(["a", "b", "c"]);
  expect(inShownOrder([], after)).toEqual(after);
  // A row that left is not kept.
  expect(inShownOrder(["gone", "b"], after).map((row) => row.agentId)).toEqual(["b", "c", "a"]);
});
