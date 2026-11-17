import { expect, test } from "vitest";
import type { OfficeAgent, OfficeSnapshot } from "../shared/contracts.js";
import { buildOfficeModel } from "../shared/model.js";
import { EMPTY_OFFICE } from "./office-state.js";
import { NO_AGENTS, sessionRows } from "./sessions-text.js";

function agent(id: string, overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: id.toUpperCase(),
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: null,
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-17T08:00:00.000Z",
    ...overrides,
  };
}

const ASK = [{ id: "p1", kind: "tool", title: "Run the tests" }];

function office(agents: OfficeAgent[]): OfficeSnapshot {
  return {
    ...EMPTY_OFFICE,
    agents,
    workspaces: [
      { id: "w1", name: "shop-api", projectName: "Shop" },
      { id: "w2", name: "blog", projectName: "Blog" },
    ],
  };
}

const ids = (shown: ReturnType<typeof sessionRows>) =>
  shown.map(({ row }) => `${row.agent.id}:${row.depth}`);

test("NO_AGENTS", () => {
  expect(NO_AGENTS).toBe("No agents yet.");
});

test("Needs you, then Working, then Resting, newest first, sub-agents under their parent", () => {
  const model = buildOfficeModel(
    office([
      // Resting: R2 changed after R1.
      agent("r1", { workspaceId: "w1", idleSince: "2026-11-17T09:00:00.000Z" }),
      agent("r2", { workspaceId: "w2", idleSince: "2026-11-17T09:30:00.000Z" }),
      // Working: W2 was prompted after W1; W1's sub-agent rests, yet follows its parent.
      agent("w1", {
        status: "running",
        workspaceId: "w1",
        promptedAt: "2026-11-17T09:10:00.000Z",
      }),
      agent("w1-1", {
        workspaceId: "w1",
        parentAgentId: "w1",
        idleSince: "2026-11-17T09:50:00.000Z",
      }),
      agent("w2", {
        status: "running",
        workspaceId: "w2",
        promptedAt: "2026-11-17T09:20:00.000Z",
      }),
      // Needs you: an agent with no change since its creation is the oldest of its group.
      agent("n1", { permissions: ASK, createdAt: "2026-11-17T07:00:00.000Z" }),
      agent("n2", { status: "error", idleSince: "2026-11-17T08:30:00.000Z" }),
    ]),
  );
  expect(ids(sessionRows(model, "all", ""))).toEqual([
    "n2:0",
    "n1:0",
    "w2:0",
    "w1:0",
    "w1-1:1",
    "r2:0",
    "r1:0",
  ]);
  // Each row carries its own room.
  const rooms = sessionRows(model, "all", "").map(({ row, room }) => [row.agent.id, room.name]);
  expect(rooms).toContainEqual(["r2", "blog"]);
  expect(rooms).toContainEqual(["w1-1", "shop-api"]);
  expect(rooms).toContainEqual(["n1", "Lobby"]);
});

test("the tab and the search filter across rooms", () => {
  const model = buildOfficeModel(
    office([
      agent("w1", { status: "running", workspaceId: "w1", promptedAt: "2026-11-17T09:10:00.000Z" }),
      agent("w1-1", {
        workspaceId: "w1",
        parentAgentId: "w1",
        idleSince: "2026-11-17T09:50:00.000Z",
      }),
      agent("r2", { workspaceId: "w2", idleSince: "2026-11-17T09:30:00.000Z" }),
      agent("n1", { permissions: ASK }),
    ]),
  );
  // Under Resting the sub-agent's parent is not shown, so it stands on its own in its place.
  expect(ids(sessionRows(model, "resting", ""))).toEqual(["w1-1:0", "r2:0"]);
  expect(ids(sessionRows(model, "working", ""))).toEqual(["w1:0"]);
  expect(ids(sessionRows(model, "attention", ""))).toEqual(["n1:0"]);
  // The search reads each row's own room: "blog" finds R2 only, across the tabs.
  expect(ids(sessionRows(model, "all", "blog"))).toEqual(["r2:0"]);
  expect(ids(sessionRows(model, "all", "shop"))).toEqual(["w1:0", "w1-1:1"]);
  expect(ids(sessionRows(model, "working", "blog"))).toEqual([]);
});

test("a sub-agent in another room than its parent still sits under it", () => {
  const model = buildOfficeModel(
    office([
      agent("p", { status: "running", workspaceId: "w1", promptedAt: "2026-11-17T09:10:00.000Z" }),
      // Its own worktree workspace puts the sub-agent in another room.
      agent("p-1", {
        workspaceId: "w2",
        parentAgentId: "p",
        idleSince: "2026-11-17T09:50:00.000Z",
      }),
      agent("r", { workspaceId: "w2", idleSince: "2026-11-17T09:30:00.000Z" }),
    ]),
  );
  const all = sessionRows(model, "all", "");
  expect(ids(all)).toEqual(["p:0", "p-1:1", "r:0"]);
  expect(all[1]?.room.name).toBe("blog");
  // A search that drops the parent leaves the sub-agent on its own, in its own place.
  expect(ids(sessionRows(model, "all", "blog"))).toEqual(["p-1:0", "r:0"]);
});

test("a parent loop across rooms keeps each of its rows once", () => {
  const model = buildOfficeModel(
    office([
      agent("x", { workspaceId: "w1", parentAgentId: "y", idleSince: "2026-11-17T09:00:00.000Z" }),
      agent("y", { workspaceId: "w2", parentAgentId: "x", idleSince: "2026-11-17T09:30:00.000Z" }),
    ]),
  );
  expect(ids(sessionRows(model, "all", ""))).toEqual(["y:0", "x:1"]);
});
