import { expect, test } from "vitest";
import type { OfficeAgent, OfficeSnapshot, Post } from "../shared/contracts.js";
import {
  agentMeta,
  agentTitle,
  answerableInOffice,
  buildOfficeModel,
  dotTone,
  orderRoomsForFocus,
  waitingOnOf,
  waitingOnText,
} from "./model.js";

function agent(id: string, overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: id.toUpperCase(),
    provider: "claude",
    model: "opus",
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-11T08:00:00.000Z",
    ...overrides,
  };
}

function snapshot(overrides: Partial<OfficeSnapshot>): OfficeSnapshot {
  return {
    agents: [],
    workspaces: [
      { id: "w1", name: "main", projectName: "paseo" },
      { id: "w2", name: "docs", projectName: "site" },
    ],
    activity: {},
    boards: {},
    wake: { paused: false, queued: {} },
    ...overrides,
  };
}

function post(id: string, overrides: Partial<Post>): Post {
  return {
    id,
    seq: 1,
    board: "w1",
    kind: "task",
    text: id,
    author: "user",
    state: "open",
    createdAt: "2026-11-11T08:00:00.000Z",
    updatedAt: "2026-11-11T08:00:00.000Z",
    ...overrides,
  };
}

function rowIds(model: ReturnType<typeof buildOfficeModel>, roomId: string): string[] {
  const room = model.rooms.find((candidate) => candidate.id === roomId);
  return room ? room.rows.map((row) => `${row.agent.id}:${row.depth}`) : [];
}

test("the lobby comes first and holds agents without a known workspace", () => {
  const model = buildOfficeModel(
    snapshot({
      agents: [
        agent("a", { workspaceId: null }),
        agent("b", { workspaceId: "w-unknown" }),
        agent("c", { workspaceId: "w2" }),
      ],
    }),
  );
  expect(model.rooms.map((room) => [room.id, room.name, room.subtitle, room.lobby])).toEqual([
    ["lobby", "Lobby", null, true],
    ["w1", "main", "paseo", false],
    ["w2", "docs", "site", false],
  ]);
  expect(rowIds(model, "lobby")).toEqual(["a:0", "b:0"]);
  expect(rowIds(model, "w2")).toEqual(["c:0"]);
  expect(model.roomOfAgent.get("b")).toBe("lobby");
});

test("children follow their parent, one level in; a parent elsewhere or a loop shows flat", () => {
  const model = buildOfficeModel(
    snapshot({
      agents: [
        agent("p", { createdAt: "2026-11-11T08:00:00.000Z" }),
        agent("q", { createdAt: "2026-11-11T08:01:00.000Z" }),
        agent("c1", { parentAgentId: "p", createdAt: "2026-11-11T08:02:00.000Z" }),
        agent("g1", { parentAgentId: "c1", createdAt: "2026-11-11T08:03:00.000Z" }),
        agent("x", { parentAgentId: "elsewhere", createdAt: "2026-11-11T08:04:00.000Z" }),
        agent("l1", { parentAgentId: "l2", createdAt: "2026-11-11T08:05:00.000Z" }),
        agent("l2", { parentAgentId: "l1", createdAt: "2026-11-11T08:06:00.000Z" }),
      ],
    }),
  );
  expect(rowIds(model, "w1")).toEqual(["p:0", "c1:1", "g1:1", "q:0", "x:0", "l1:0", "l2:1"]);
});

test("an agent whose turn has ended waits on the agents it started that are still at work", () => {
  const asks = [{ id: "q", kind: "tool" as const, title: "Run?" }];
  const waiting = (agents: OfficeAgent[]) => [...waitingOnOf(agents)];
  const child = (id: string, overrides: Partial<OfficeAgent> = {}) =>
    agent(id, { parentAgentId: "p", ...overrides });

  // Running, starting, or waiting for the user: each counts. Idle, stopped or closed does not.
  expect(
    waiting([
      agent("p"),
      child("c1", { status: "running" }),
      child("c2", { status: "initializing" }),
      child("c3", { permissions: asks }),
      child("c4"),
      child("c5", { status: "error" }),
    ]),
  ).toEqual([["p", 3]]);
  expect(waiting([agent("p"), child("c1"), child("c2", { status: "error" })])).toEqual([]);
  // Down the chain: a grandchild at work keeps both its idle parent and its idle grandparent.
  expect(
    waiting([
      agent("p"),
      child("c1"),
      agent("g1", { parentAgentId: "c1", status: "running" }),
      agent("other", { status: "running" }),
    ]),
  ).toEqual([
    ["p", 1],
    ["c1", 1],
  ]);
  // A parent in its own turn, with a question open or stopped on an error is not waiting.
  for (const own of [
    { status: "running" as const },
    { permissions: asks },
    { status: "error" as const },
  ]) {
    expect(waiting([agent("p", own), child("c1", { status: "running" })])).toEqual([]);
  }
  // A child in another room counts; a parent chain that loops ends.
  expect(waiting([agent("p"), child("c1", { status: "running", workspaceId: "w2" })])).toEqual([
    ["p", 1],
  ]);
  expect(
    waiting([
      agent("l1", { parentAgentId: "l2" }),
      agent("l2", { parentAgentId: "l1", status: "running" }),
    ]),
  ).toEqual([["l1", 1]]);
  expect(waitingOnText(1)).toBe("Waiting on 1 sub-agent");
  expect(waitingOnText(3)).toBe("Waiting on 3 sub-agents");
});

test("the model says who waits on sub-agents, on the row and by id; closed agents do not count", () => {
  const model = buildOfficeModel(
    snapshot({
      agents: [
        agent("p", { createdAt: "2026-11-11T08:00:00.000Z" }),
        agent("c1", {
          parentAgentId: "p",
          status: "running",
          createdAt: "2026-11-11T08:01:00.000Z",
        }),
        agent("q", { createdAt: "2026-11-11T08:02:00.000Z" }),
        agent("c2", {
          parentAgentId: "q",
          status: "closed",
          createdAt: "2026-11-11T08:03:00.000Z",
        }),
      ],
    }),
  );
  expect([...model.waitingOn]).toEqual([["p", 1]]);
  const room = model.rooms.find((candidate) => candidate.id === "w1");
  expect(room?.rows.map((row) => [row.agent.id, row.waitingOn])).toEqual([
    ["p", 1],
    ["c1", 0],
    ["q", 0],
  ]);
});

test("doing now shows for running agents only; closed agents are left out", () => {
  const model = buildOfficeModel(
    snapshot({
      agents: [agent("r", { status: "running" }), agent("i"), agent("z", { status: "closed" })],
      activity: { r: "Running Bash", i: "Thinking" },
    }),
  );
  const room = model.rooms[1];
  expect(room?.rows.map((row) => [row.agent.id, row.activity])).toEqual([
    ["i", null],
    ["r", "Running Bash"],
  ]);
  expect(model.agents.has("z")).toBe(false);
});

test("a running agent's row has the tool call it is at; an agent that stopped has none", () => {
  const model = buildOfficeModel(
    snapshot({
      agents: [agent("a", { status: "running" }), agent("b"), agent("c", { status: "running" })],
      doing: { a: { kind: "read", key: "c1" }, b: { kind: "command", key: "c2" } },
    }),
  );
  const rows = model.rooms.flatMap((room) => room.rows);
  expect(rows.map((row) => [row.agent.id, row.step])).toEqual([
    ["a", { kind: "read", key: "c1" }],
    ["b", null],
    ["c", null],
  ]);
});

test("the attention list puts permissions before errors, each by title", () => {
  const permission = { id: "r1", kind: "tool" as const, title: "Run tests" };
  const model = buildOfficeModel(
    snapshot({
      agents: [
        agent("e", { status: "error", title: "Alpha" }),
        agent("p2", { status: "running", title: "Zed", permissions: [permission] }),
        agent("p1", {
          status: "running",
          title: "Beta",
          permissions: [permission],
          workspaceId: null,
        }),
      ],
    }),
  );
  expect(model.attention).toEqual([
    { agentId: "p1", roomId: "lobby", title: "Beta", reason: "permission" },
    { agentId: "p2", roomId: "w1", title: "Zed", reason: "permission" },
    { agentId: "e", roomId: "w1", title: "Alpha", reason: "error" },
  ]);
});

test("a room shows open and claimed tasks and notes, not done tasks or unknown boards", () => {
  const model = buildOfficeModel(
    snapshot({
      boards: {
        w1: [
          post("p3", {
            seq: 3,
            kind: "note",
            state: undefined,
            createdAt: "2026-11-11T08:03:00.000Z",
          }),
          post("p1", { seq: 1, state: "claimed", claimedBy: "a" }),
          post("p2", { seq: 2, state: "done" }),
        ],
        w9: [post("p9", { board: "w9" })],
      },
    }),
  );
  expect(model.rooms[1]?.posts.map((item) => item.id)).toEqual(["p1", "p3"]);
  expect(model.rooms.some((room) => room.id === "w9")).toBe(false);
});

test("titles, meta, dots and answerable kinds", () => {
  expect(agentTitle(agent("abcdef0123", { title: null }))).toBe("Agent abcdef01");
  expect(agentTitle(agent("a", { title: "  " }))).toBe("Agent a");
  expect(agentMeta(agent("a"))).toBe("claude · opus");
  expect(agentMeta(agent("a", { model: null }))).toBe("claude");
  expect(dotTone(agent("a", { status: "running" }))).toBe("running");
  expect(dotTone(agent("a", { status: "initializing" }))).toBe("starting");
  expect(dotTone(agent("a", { status: "error" }))).toBe("danger");
  expect(
    dotTone(
      agent("a", { status: "running", permissions: [{ id: "r", kind: "tool", title: "t" }] }),
    ),
  ).toBe("warning");
  expect(dotTone(agent("a"))).toBe("idle");
  expect(
    ["tool", "mode", "other", "plan", "question"].map((kind) => answerableInOffice(kind)),
  ).toEqual([true, true, true, false, false]);
});

test("a workspace tab shows its own room first, then the lobby, then the rest", () => {
  const rooms = buildOfficeModel(snapshot({})).rooms;
  expect(orderRoomsForFocus(rooms, "w2").map((room) => room.id)).toEqual(["w2", "lobby", "w1"]);
  expect(orderRoomsForFocus(rooms, null).map((room) => room.id)).toEqual(["lobby", "w1", "w2"]);
  expect(orderRoomsForFocus(rooms, "w-missing").map((room) => room.id)).toEqual([
    "lobby",
    "w1",
    "w2",
  ]);
});
