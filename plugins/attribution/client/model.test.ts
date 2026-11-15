import { expect, test } from "vitest";
import type { Author } from "../shared/contracts.js";
import {
  agentName,
  agentsLabel,
  agoLabel,
  legendOf,
  markAt,
  rangeLabel,
  rowsOf,
  splitPath,
  summaryLabel,
  type ReadyFile,
} from "./model.js";

const ONE: Author = { id: "a1-0000-1111", title: "Checkout total", provider: "claude" };
const TWO: Author = { id: "a2-0000-2222", title: null, provider: "codex" };

const FILE: ReadyFile = {
  status: "ready",
  lines: ["one", "two", "three", "four", "five", "six"],
  marks: [
    { start: 2, count: 1, turn: 0 },
    { start: 4, count: 2, turn: 1 },
    { start: 6, count: 1, turn: 2 },
  ],
  turns: [
    { at: 1, agents: [ONE] },
    { at: 2, agents: [TWO] },
    { at: 3, agents: [ONE, TWO] },
  ],
};

test("the legend numbers the agents by their lines, and a shared line counts for each", () => {
  const legend = legendOf(FILE);

  expect(legend.agents.map((agent) => [agent.number, agent.id, agent.lines])).toEqual([
    [1, TWO.id, 3],
    [2, ONE.id, 2],
  ]);
  expect(legend.byAgents).toBe(4);
  expect(legend.total).toBe(6);
  expect(summaryLabel(legend)).toBe("Agents wrote 4 of 6 lines");
});

test("each line knows its turn, and a run's first line carries the agents' numbers", () => {
  const legend = legendOf(FILE);

  expect(rowsOf(FILE, legend, null).map((row) => [row.number, row.turn, row.label])).toEqual([
    [1, -1, ""],
    [2, 0, "2"],
    [3, -1, ""],
    [4, 1, "1"],
    [5, 1, ""],
    [6, 2, "1+2"],
  ]);
});

test("choosing an agent marks its lines, the shared ones too", () => {
  const rows = rowsOf(FILE, legendOf(FILE), ONE.id);

  expect(rows.filter((row) => row.chosen).map((row) => row.number)).toEqual([2, 6]);
});

test("a line finds the run it is in", () => {
  expect(markAt(FILE.marks, 5)).toEqual({ start: 4, count: 2, turn: 1 });
  expect(markAt(FILE.marks, 3)).toBeNull();
  expect(rangeLabel({ start: 4, count: 2, turn: 1 })).toBe("Lines 4 to 5");
  expect(rangeLabel({ start: 2, count: 1, turn: 0 })).toBe("Line 2");
});

test("an agent without a title is named by its id, and a row names the latest agent", () => {
  expect(agentName(ONE)).toBe("Checkout total");
  expect(agentName(TWO)).toBe("Agent a2-0000-");
  expect(agentName({ id: "a3", title: "  " })).toBe("Agent a3");
  expect(agentsLabel({ agents: [ONE, TWO] })).toBe("Checkout total +1");
  expect(agentsLabel({ agents: [TWO] })).toBe("Agent a2-0000-");
  expect(agentsLabel({ agents: [] })).toBe("");
});

test("a path splits into its name and its folders", () => {
  expect(splitPath("src/cart/total.ts")).toEqual({ name: "total.ts", folder: "src/cart" });
  expect(splitPath("README.md")).toEqual({ name: "README.md", folder: "" });
});

test("a change is so long ago", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  const back = (ms: number) => agoLabel(now - ms, now);

  expect(back(20_000)).toBe("just now");
  expect(back(5 * 60_000)).toBe("5 min ago");
  expect(back(3 * 3_600_000)).toBe("3 h ago");
  expect(back(2 * 86_400_000)).toBe("2 d ago");
  // A clock that is behind the host's does not say "in the future".
  expect(agoLabel(now + 5_000, now)).toBe("just now");
  expect(back(30 * 86_400_000)).toMatch(/Oct/);
});
