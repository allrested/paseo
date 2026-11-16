import { expect, test } from "vitest";
import type { OfficeAgent } from "../shared/contracts.js";
import {
  NEXT_KEY,
  NUMBER_KEY,
  officeNames,
  planNumbers,
  type NumberedAgent,
} from "./subagent-names.js";

function parent(id: string, extra: Partial<NumberedAgent> = {}): NumberedAgent {
  return { id, parentAgentId: null, createdAt: "2026-11-16T10:00:00.000Z", ...extra };
}

function child(
  id: string,
  parentId: string,
  createdAt: string,
  extra: Partial<NumberedAgent> = {},
): NumberedAgent {
  return { id, parentAgentId: parentId, createdAt, ...extra };
}

function agent(
  id: string,
  title: string,
  extra: { parent?: string; number?: number } = {},
): OfficeAgent {
  return {
    id,
    title,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: extra.parent ?? null,
    permissions: [],
    createdAt: "2026-11-16T10:00:00.000Z",
    ...(extra.number === undefined ? {} : { number: extra.number }),
  };
}

test("two new sub-agents of one parent get 1 and 2 in creation order", () => {
  expect(
    planNumbers([
      parent("p"),
      child("b", "p", "2026-11-16T10:00:01.500Z"),
      child("a", "p", "2026-11-16T10:00:01.000Z"),
    ]),
  ).toEqual([
    { agentId: "p", patch: { [NEXT_KEY]: 3 } },
    { agentId: "a", patch: { [NUMBER_KEY]: 1 } },
    { agentId: "b", patch: { [NUMBER_KEY]: 2 } },
  ]);
});

test("two created at the same moment are ordered by id", () => {
  const same = "2026-11-16T10:00:01.000Z";
  expect(planNumbers([parent("p"), child("y", "p", same), child("x", "p", same)])).toEqual([
    { agentId: "p", patch: { [NEXT_KEY]: 3 } },
    { agentId: "x", patch: { [NUMBER_KEY]: 1 } },
    { agentId: "y", patch: { [NUMBER_KEY]: 2 } },
  ]);
});

test("a number is never reused: next wins over the shown children", () => {
  const plan = planNumbers([
    parent("p", { next: 4 }),
    child("b", "p", "2026-11-16T10:00:01.000Z", { number: 2 }),
    child("c", "p", "2026-11-16T10:00:02.000Z"),
  ]);
  expect(plan).toContainEqual({ agentId: "c", patch: { [NUMBER_KEY]: 4 } });
  expect(plan).toContainEqual({ agentId: "p", patch: { [NEXT_KEY]: 5 } });
});

test("without next, one more than the highest shown child", () => {
  expect(
    planNumbers([
      parent("p"),
      child("x", "p", "2026-11-16T10:00:01.000Z", { number: 3 }),
      child("y", "p", "2026-11-16T10:00:02.000Z"),
    ]),
  ).toContainEqual({ agentId: "y", patch: { [NUMBER_KEY]: 4 } });
});

test("a parent whose next is behind its children is brought up to date", () => {
  expect(planNumbers([parent("p", { next: 1 }), child("x", "p", "t", { number: 3 })])).toEqual([
    { agentId: "p", patch: { [NEXT_KEY]: 4 } },
  ]);
});

test("nothing to write when every sub-agent has its number and next is right", () => {
  expect(planNumbers([parent("p", { next: 3 }), child("x", "p", "t", { number: 2 })])).toEqual([]);
});

test("a sub-agent of a hidden parent gets no number", () => {
  expect(planNumbers([child("a", "gone", "t")])).toEqual([]);
});

test("an agent that names itself as its parent gets no number", () => {
  expect(planNumbers([child("a", "a", "t")])).toEqual([]);
});

test("names nest: Mjd-2's child is Mjd-2-1", () => {
  const names = officeNames([
    agent("p", "Mjd"),
    agent("c", "Explore the cart API", { parent: "p", number: 2 }),
    agent("g", "Read the routes", { parent: "c", number: 1 }),
  ]);
  expect(names.get("c")).toBe("Mjd-2");
  expect(names.get("g")).toBe("Mjd-2-1");
  expect(names.has("p")).toBe(false);
});

test("a sub-agent without a number, or with a hidden parent, keeps its own title", () => {
  const names = officeNames([
    agent("p", "Mjd"),
    agent("c", "Explore", { parent: "p" }),
    agent("o", "Orphan", { parent: "gone", number: 1 }),
  ]);
  expect(names.has("c")).toBe(false);
  expect(names.has("o")).toBe(false);
});

test("a parent without a title is named as the office names it", () => {
  const names = officeNames([
    { ...agent("p1234567-x", "Mjd"), title: null },
    agent("c", "Explore", { parent: "p1234567-x", number: 1 }),
  ]);
  expect(names.get("c")).toBe("Agent p1234567-1");
});
