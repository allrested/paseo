import { expect, test } from "vitest";
import type {
  ChatMessage,
  ChatSnapshot,
  ChecklistStep,
  OfficeAgent,
  OfficeSnapshot,
  Post,
} from "../shared/contracts.js";
import { EMPTY_CHAT, EMPTY_OFFICE, applyChatEvent, applyOfficeEvent } from "./office-state.js";

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

function m(id: string, text = id): ChatMessage {
  return { id, at: 1, kind: "text", from: "me", name: "Boss", text, reacts: {} };
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
  state = applyOfficeEvent(state, {
    type: "activity",
    activity: { b: "Thinking" },
    doing: { b: { kind: "read", key: "c1" } },
  });
  state = applyOfficeEvent(state, { type: "board", board: "lobby", posts: [] });
  state = applyOfficeEvent(state, { type: "board-removed", board: "w1" });
  state = applyOfficeEvent(state, { type: "wake", wake: { paused: true, queued: { b: 1 } } });

  expect(state).toEqual({
    agents: [agent("b")],
    workspaces: [{ id: "w1", name: "main", projectName: "paseo" }],
    activity: { b: "Thinking" },
    doing: { b: { kind: "read", key: "c1" } },
    checklists: {},
    boards: { lobby: [] },
    wake: { paused: true, queued: { b: 1 } },
  });
});

test("an activity event replaces the checklists, and one without them clears them", () => {
  const step: ChecklistStep = { text: "Run typecheck", status: "pending" };
  const withSteps = applyOfficeEvent(EMPTY_OFFICE, {
    type: "activity",
    activity: {},
    checklists: { a1: [step] },
  });
  expect(withSteps.checklists).toEqual({ a1: [step] });
  expect(applyOfficeEvent(withSteps, { type: "activity", activity: {} }).checklists).toEqual({});
});

test("a chat event leaves the floor's state as it was", () => {
  expect(
    applyOfficeEvent(EMPTY_OFFICE, { type: "chat", change: { op: "typing", names: ["A"] } }),
  ).toBe(EMPTY_OFFICE);
});

test("the chat's changes", () => {
  let chat = applyChatEvent(null, {
    type: "snapshot",
    state: { ...EMPTY_OFFICE, chat: { messages: [m("a")], typing: [] } },
  });
  chat = applyChatEvent(chat, { type: "chat", change: { op: "add", message: m("b") } });
  expect(chat?.messages.map((x) => x.id)).toEqual(["a", "b"]);

  // The same id again is not added twice.
  chat = applyChatEvent(chat, { type: "chat", change: { op: "add", message: m("b", "again") } });
  expect(chat?.messages).toEqual([m("a"), m("b")]);

  // Update replaces by id, and appends one it does not know.
  chat = applyChatEvent(chat, {
    type: "chat",
    change: { op: "update", message: m("a", "edited") },
  });
  expect(chat?.messages).toEqual([m("a", "edited"), m("b")]);
  chat = applyChatEvent(chat, { type: "chat", change: { op: "update", message: m("c") } });
  expect(chat?.messages.map((x) => x.id)).toEqual(["a", "b", "c"]);

  // Typing sets the names; all replaces the messages and keeps the names.
  chat = applyChatEvent(chat, { type: "chat", change: { op: "typing", names: ["Alice"] } });
  expect(chat?.typing).toEqual(["Alice"]);
  expect(chat?.messages.map((x) => x.id)).toEqual(["a", "b", "c"]);
  chat = applyChatEvent(chat, { type: "chat", change: { op: "all", messages: [m("z")] } });
  expect(chat).toEqual({ messages: [m("z")], typing: ["Alice"] });

  // An act changes nothing.
  expect(
    applyChatEvent(chat, { type: "chat", change: { op: "act", what: "meeting", id: "a1" } }),
  ).toBe(chat);

  // A snapshot without chat gives null.
  expect(applyChatEvent(chat, { type: "snapshot", state: EMPTY_OFFICE })).toBeNull();

  // Another event of the floor leaves the chat as it was.
  expect(applyChatEvent(chat, { type: "agents", agents: [] })).toBe(chat);

  // An add before any snapshot starts the chat from EMPTY_CHAT.
  expect(EMPTY_CHAT).toEqual({ messages: [], typing: [] });
  expect(applyChatEvent(null, { type: "chat", change: { op: "add", message: m("a") } })).toEqual({
    messages: [m("a")],
    typing: [],
  });

  // 301 adds keep the newest 300.
  let long: ChatSnapshot | null = null;
  for (let i = 0; i < 301; i += 1)
    long = applyChatEvent(long, { type: "chat", change: { op: "add", message: m(`m${i}`) } });
  expect(long?.messages).toHaveLength(300);
  expect(long?.messages[0].id).toBe("m1");
  expect(long?.messages[299].id).toBe("m300");
});
