import { expect, test } from "vitest";
import type { OfficeAgent, Post } from "../shared/contracts.js";
import {
  authorName,
  boardPreview,
  clearQuestion,
  orderBoardPosts,
  postMeta,
  postStateLabel,
  queuedWakes,
  stepMark,
  todoMeta,
  todoPreview,
  wakeSummary,
} from "./board-text.js";

const AGENTS = new Map<string, OfficeAgent>([
  [
    "a1",
    {
      id: "a1",
      title: "Planner",
      provider: "claude",
      model: null,
      status: "idle",
      workspaceId: "w1",
      parentAgentId: null,
      permissions: [],
      createdAt: "2026-11-11T08:00:00.000Z",
    },
  ],
]);
const name = (author: string) => authorName(author, AGENTS);

function post(seq: number, fields: Partial<Post>): Post {
  return {
    id: `p${seq}`,
    seq,
    board: "w1",
    kind: "task",
    text: "t",
    author: "user",
    state: "open",
    createdAt: `2026-11-11T09:0${seq}:00.000Z`,
    updatedAt: `2026-11-11T09:0${seq}:00.000Z`,
    ...fields,
  };
}

test("authors read as You, the agent's title, or a short id", () => {
  expect(name("user")).toBe("You");
  expect(name("a1")).toBe("Planner");
  expect(name("0123456789abcdef")).toBe("Agent 01234567");
});

test("a post's meta line gives its state, the claimer, and from → to", () => {
  expect(postStateLabel(post(1, {}), name)).toBe("Task · open");
  expect(postMeta(post(1, { state: "claimed", claimedBy: "a1", to: "a1" }), name)).toBe(
    "Task · claimed by Planner · You → Planner",
  );
  expect(postMeta(post(2, { kind: "note", state: undefined, author: "a1" }), name)).toBe(
    "Note · Planner",
  );
});

test("a board lists open tasks, then claimed tasks, then notes, each oldest first", () => {
  const posts = [
    post(1, { kind: "note", state: undefined }),
    post(2, { state: "claimed", claimedBy: "a1" }),
    post(3, {}),
    post(4, {}),
  ];
  expect(orderBoardPosts(posts).map((item) => item.id)).toEqual(["p3", "p4", "p2", "p1"]);
});

test("posts made in the same instant keep the order they were made in", () => {
  const at = "2026-11-11T09:00:00.000Z";
  const posts = [
    post(7, { createdAt: at }),
    post(6, { createdAt: at }),
    post(5, { createdAt: at }),
  ];
  expect(orderBoardPosts(posts).map((item) => item.id)).toEqual(["p5", "p6", "p7"]);
});

test("a room card shows the first three posts of its board and counts the rest", () => {
  const posts = [
    post(1, { kind: "note", state: undefined }),
    post(2, { state: "claimed", claimedBy: "a1" }),
    post(3, {}),
    post(4, {}),
    post(5, { kind: "note", state: undefined }),
  ];
  // Open tasks come first, so they are what a full board shows on its card.
  const preview = boardPreview(posts);
  expect(preview.shown.map((item) => item.id)).toEqual(["p3", "p4", "p2"]);
  expect(preview.more).toBe(2);
  expect(boardPreview(posts.slice(0, 3))).toEqual({
    shown: orderBoardPosts(posts.slice(0, 3)),
    more: 0,
  });
  expect(boardPreview([])).toEqual({ shown: [], more: 0 });
});

test("the wake count says how many posts wait, and nothing when none do", () => {
  expect(queuedWakes({ paused: false, queued: { a: 2, b: 1 } })).toBe(3);
  expect(wakeSummary({ paused: false, queued: {} })).toBe(null);
  expect(wakeSummary({ paused: false, queued: { a: 2 } })).toBe("2 waiting");
  // Paused is what the switch beside the count shows; the words say what it cannot.
  expect(wakeSummary({ paused: true, queued: {} })).toBe(null);
  expect(wakeSummary({ paused: true, queued: { a: 1 } })).toBe("1 waiting");
});

const PEOPLE = new Map([
  ["a1", "Ali"],
  ["a2", "Sara"],
]);
const person = (author: string) => PEOPLE.get(author) ?? author;
const open = post(1, {});
const done = post(2, { state: "done" });
const claimed = (by: string) => post(3, { state: "claimed", claimedBy: by });

test("a to-do's meta names who claimed it and whom it names", () => {
  expect(todoMeta(claimed("a1"), person)).toBe("claimed by Ali");
  expect(todoMeta({ ...open, to: "a2" }, person)).toBe("for Sara");
  expect(todoMeta({ ...claimed("a1"), to: "a2" }, person)).toBe("claimed by Ali · for Sara");
  // A done to-do keeps its claimer, but it is no longer claimed.
  expect(todoMeta({ ...done, claimedBy: "a1" }, person)).toBeNull();
  expect(todoMeta(open, person)).toBeNull();
});

test("the clear question counts finished to-dos", () => {
  expect(clearQuestion(1)).toBe("Delete 1 finished to-do?");
  expect(clearQuestion(3)).toBe("Delete 3 finished to-dos?");
});

test("the lobby card counts open and claimed to-dos only", () => {
  // In to-do order, as room.todos holds them: open and claimed first, then done.
  const todos = [
    post(1, {}),
    post(2, { state: "claimed", claimedBy: "a1" }),
    post(3, {}),
    post(4, {}),
    post(5, {}),
    post(6, { state: "done" }),
    post(7, { state: "done" }),
  ];
  const preview = todoPreview(todos);
  expect(preview.shown.map((item) => item.id)).toEqual(["p1", "p2", "p3"]);
  expect(preview.more).toBe(2);
  expect(todoPreview(todos.slice(5))).toEqual({ shown: [], more: 0 });
  expect(todoPreview([])).toEqual({ shown: [], more: 0 });
});

test("a checklist step is marked in progress or waiting", () => {
  expect(stepMark("in_progress")).toBe("◐");
  expect(stepMark("pending")).toBe("○");
});
