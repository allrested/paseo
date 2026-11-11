import { expect, test } from "vitest";
import type { OfficeAgent, OfficeSnapshot, Post } from "../shared/contracts.js";
import { EMPTY_OFFICE, applyOfficeEvent } from "./office-state.js";

function agent(id: string): OfficeAgent {
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
  };
}

function note(id: string, board: string): Post {
  return {
    id,
    seq: 1,
    board,
    kind: "note",
    text: "hi",
    author: "user",
    createdAt: "2026-11-11T08:00:00.000Z",
    updatedAt: "2026-11-11T08:00:00.000Z",
  };
}

test("a snapshot replaces the state and each change replaces its part", () => {
  const snapshot: OfficeSnapshot = {
    ...EMPTY_OFFICE,
    agents: [agent("a")],
    boards: { lobby: [note("p1", "lobby")], w1: [note("p2", "w1")] },
  };
  let state = applyOfficeEvent(EMPTY_OFFICE, { type: "snapshot", state: snapshot });
  expect(state).toEqual(snapshot);

  state = applyOfficeEvent(state, { type: "agents", agents: [agent("b")] });
  state = applyOfficeEvent(state, {
    type: "workspaces",
    workspaces: [{ id: "w1", name: "main", projectName: "paseo" }],
  });
  state = applyOfficeEvent(state, { type: "activity", activity: { b: "Thinking" } });
  state = applyOfficeEvent(state, { type: "board", board: "lobby", posts: [] });
  state = applyOfficeEvent(state, { type: "board-removed", board: "w1" });
  state = applyOfficeEvent(state, { type: "wake", wake: { paused: true, queued: { b: 1 } } });

  expect(state).toEqual({
    agents: [agent("b")],
    workspaces: [{ id: "w1", name: "main", projectName: "paseo" }],
    activity: { b: "Thinking" },
    boards: { lobby: [] },
    wake: { paused: true, queued: { b: 1 } },
  });
});
