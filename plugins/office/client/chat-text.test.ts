import { expect, test } from "vitest";
import type { ChatMessage, OfficeAgent } from "../shared/contracts.js";
import { buildOfficeModel } from "../shared/model.js";
import { EMPTY_OFFICE } from "./office-state.js";
import { SHIRTS, lookOf } from "./pixel/art.js";
import {
  DIRECTOR_COLOR,
  REACTION_CHOICES,
  avatarOf,
  canRecall,
  counterText,
  enterSends,
  isLong,
  mentionAt,
  mentionOptions,
  pollRows,
  putMention,
  reactionRows,
  remindState,
  shows,
  timeLabel,
  typingText,
  unreadCount,
  unreadLabel,
} from "./chat-text.js";

const AT = new Date(2026, 10, 17, 9, 0).getTime();

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    at: AT,
    kind: "text",
    from: "a1",
    name: "Ali",
    text: "On it",
    reacts: {},
    ...overrides,
  };
}

function agent(overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id: "a1",
    title: "Ali",
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

test("only five kinds show", () => {
  for (const kind of ["text", "sticker", "poll", "remind", "sys"]) {
    expect(shows(message({ kind }))).toBe(true);
  }
  for (const kind of ["photo", "work", "loop", "ci", "deny", "nonsense"]) {
    expect(shows(message({ kind }))).toBe(false);
  }
});

test("time labels: today, yesterday, older", () => {
  const now = new Date(2026, 10, 17, 14, 0).getTime();
  expect(timeLabel(new Date(2026, 10, 17, 9, 5).getTime(), now)).toBe("09:05");
  expect(timeLabel(new Date(2026, 10, 16, 23, 59).getTime(), now)).toBe("Yesterday 23:59");
  expect(timeLabel(new Date(2026, 10, 12, 9, 5).getTime(), now)).toBe("12 Nov 09:05");
});

test("typing words", () => {
  expect(typingText([])).toBeNull();
  expect(typingText(["Alice"])).toBe("Alice is typing…");
  expect(typingText(["Alice", "Bea"])).toBe("Alice and Bea are typing…");
  expect(typingText(["A", "B", "C"])).toBe("Several people are typing…");
});

test("the counter shows from 500 of 600", () => {
  expect(counterText(499)).toBeNull();
  expect(counterText(500)).toBe("500 / 600");
  expect(counterText(600)).toBe("600 / 600");
});

test("unread: messages after the mark that are not yours and not system lines", () => {
  const messages = [
    message({ id: "1", at: 500 }),
    message({ id: "2", at: 1000 }),
    message({ id: "3", at: 2000 }),
    message({ id: "4", at: 3000, from: "me", name: "You" }),
    message({ id: "5", at: 4000, kind: "sys", from: undefined, name: undefined }),
    message({ id: "6", at: 5000, from: "__director", name: "Director" }),
  ];
  // The message at the mark was seen; the agent's and the director's after it were not.
  expect(unreadCount(messages, 1000)).toBe(2);
  expect(unreadCount(messages, 5000)).toBe(0);
  expect(unreadCount([], 0)).toBe(0);
});

test("the unread label is none at zero and 99+ over 99", () => {
  expect(unreadLabel(0)).toBeNull();
  expect(unreadLabel(1)).toBe("1");
  expect(unreadLabel(99)).toBe("99");
  expect(unreadLabel(100)).toBe("99+");
});

test("a message can be recalled for two minutes, only if yours and not recalled", () => {
  const yours = message({ from: "me", name: "You" });
  expect(canRecall(yours, AT)).toBe(true);
  expect(canRecall(yours, AT + 2 * 60_000)).toBe(true);
  expect(canRecall(yours, AT + 2 * 60_000 + 1)).toBe(false);
  expect(canRecall(message({ from: "a1" }), AT)).toBe(false);
  expect(canRecall({ ...yours, recalled: true }, AT)).toBe(false);
});

test("a long answer is over eight lines or eight rows of characters", () => {
  expect(isLong("short")).toBe(false);
  expect(isLong(Array.from({ length: 8 }, () => "line").join("\n"))).toBe(false);
  expect(isLong(Array.from({ length: 9 }, () => "line").join("\n"))).toBe(true);
  expect(isLong("x".repeat(8 * 60))).toBe(false);
  expect(isLong("x".repeat(8 * 60 + 1))).toBe(true);
});

test("reaction rows keep upstream's order, count each, and mark yours", () => {
  expect(REACTION_CHOICES).toEqual(["❤️", "👍", "😆", "😮", "😭", "😡"]);
  const reacted = message({
    reacts: { "😡": ["a2"], "👍": ["me", "a2"], "😮": [], "❤️": ["a3"] },
  });
  expect(reactionRows(reacted)).toEqual([
    { emoji: "❤️", count: 1, mine: false },
    { emoji: "👍", count: 2, mine: true },
    { emoji: "😡", count: 1, mine: false },
  ]);
  expect(reactionRows(message())).toEqual([]);
});

test("the director's avatar is upstream's colour and an agent's is its floor shirt by id", () => {
  expect(avatarOf(message({ from: "__director", name: "Director" }))).toEqual({
    initials: "D",
    color: DIRECTOR_COLOR,
  });
  expect(avatarOf(message({ from: "a1", name: "Mjd-1" }))?.color).toBe(
    SHIRTS[lookOf("a1").shirt]?.shirt,
  );
  // two words: first letters; one word: first two
  expect(avatarOf(message({ from: "a1", name: "Mjd-1" }))?.initials).toBe("MJ");
  expect(avatarOf(message({ from: "a1", name: "fix login" }))?.initials).toBe("FL");
  expect(avatarOf(message({ from: "me" }))).toBeNull();
  expect(avatarOf(message({ kind: "sys", from: undefined }))).toBeNull();
});

test("poll rows count voters and mark your vote", () => {
  const poll = message({
    kind: "poll",
    text: "Lunch?",
    poll: {
      q: "Lunch?",
      opts: [
        { t: "Pho", by: ["a1", "me"] },
        { t: "Rice", by: [] },
        { t: "Noodles", by: ["a2"] },
      ],
    },
  });
  expect(pollRows(poll)).toEqual([
    { index: 0, text: "Pho", count: 2, mine: true },
    { index: 1, text: "Rice", count: 0, mine: false },
    { index: 2, text: "Noodles", count: 1, mine: false },
  ]);
  expect(pollRows(message())).toEqual([]);
});

test("a reminder says when it is, how many go, what you said, and whether it is over", () => {
  const remind = {
    title: "Stand-up",
    at: new Date(2026, 10, 23, 9, 0).getTime(),
    repeat: "week",
    yes: ["a1", "a2"],
    no: ["me"],
  };
  expect(remindState(message({ kind: "remind", text: "Stand-up", remind }))).toEqual({
    when: "23 Nov 09:00",
    going: 2,
    yours: "no",
    done: false,
  });
  expect(
    remindState(
      message({ kind: "remind", remind: { ...remind, yes: ["me"], no: [], done: true } }),
    ),
  ).toEqual({ when: "23 Nov 09:00", going: 1, yours: "yes", done: true });
  expect(remindState(message({ kind: "remind", remind: { ...remind, no: [] } }))?.yours).toBeNull();
  expect(remindState(message())).toBeNull();
});

test("@ at the end of the text opens the list, with the words after it", () => {
  expect(mentionAt("hi @")).toEqual({ start: 3, query: "" });
  expect(mentionAt("hi @fix lo")).toEqual({ start: 3, query: "fix lo" });
  expect(mentionAt("@fi")).toEqual({ start: 0, query: "fi" });
  expect(mentionAt("hi")).toBeNull();
  expect(mentionAt("mail me@x")).toBeNull(); // an @ inside a word is not a mention
  expect(mentionAt("@a\nb")).toBeNull();
  expect(mentionAt("@" + "x".repeat(40))).toEqual({ start: 0, query: "x".repeat(40) });
  expect(mentionAt("@" + "x".repeat(41))).toBeNull();
});

test("the list is the model's agents matched with the List's search, in the floor's order, eight at most", () => {
  const model = buildOfficeModel({
    ...EMPTY_OFFICE,
    workspaces: [{ id: "w1", name: "shop-api", projectName: "Shop" }],
    agents: [
      agent({
        id: "a3",
        title: "Fix logout",
        workspaceId: "w1",
        createdAt: "2026-11-17T08:03:00Z",
      }),
      agent({ id: "a1", title: "Write docs", createdAt: "2026-11-17T08:01:00Z" }),
      agent({
        id: "a4",
        title: "Check the tests",
        name: "Fix login-1",
        parentAgentId: "a2",
        workspaceId: "w1",
        createdAt: "2026-11-17T08:04:00Z",
      }),
      agent({ id: "a2", title: "Fix login", workspaceId: "w1", createdAt: "2026-11-17T08:02:00Z" }),
    ],
  });
  expect(mentionOptions(model, "")).toEqual([
    { id: "a1", name: "Write docs", room: "Lobby" },
    { id: "a2", name: "Fix login", room: "shop-api" },
    { id: "a4", name: "Fix login-1", room: "shop-api" },
    { id: "a3", name: "Fix logout", room: "shop-api" },
  ]);
  expect(mentionOptions(model, "fix").map((option) => option.id)).toEqual(["a2", "a4", "a3"]);
  // The List's search reads the room too.
  expect(mentionOptions(model, "shop logout").map((option) => option.id)).toEqual(["a3"]);
  expect(mentionOptions(model, "nobody")).toEqual([]);

  const crowd = buildOfficeModel({
    ...EMPTY_OFFICE,
    agents: Array.from({ length: 10 }, (_, index) =>
      agent({ id: `b${index}`, title: `Agent ${index}`, createdAt: `2026-11-17T08:0${index}:00Z` }),
    ),
  });
  expect(mentionOptions(crowd, "").map((option) => option.id)).toEqual([
    "b0",
    "b1",
    "b2",
    "b3",
    "b4",
    "b5",
    "b6",
    "b7",
  ]);
});

test("a chosen name replaces the typed words", () => {
  expect(putMention("hi @fi", { start: 3, query: "fi" }, "Fix login")).toBe("hi @Fix login ");
});

test("Enter sends and Shift+Enter does not", () => {
  expect(enterSends({ key: "Enter" })).toBe(true);
  expect(enterSends({ key: "Enter", shiftKey: false })).toBe(true);
  expect(enterSends({ key: "Enter", shiftKey: true })).toBe(false);
  expect(enterSends({ key: "a" })).toBe(false);
});
