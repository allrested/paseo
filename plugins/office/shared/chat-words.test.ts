import { afterEach, expect, test, vi } from "vitest";
import { chatT } from "./chat-words.js";
import chat from "./upstream/chat.js";
import { createChatEngine, REACTIONS, type EngineMessage } from "./upstream/chat-engine.js";

afterEach(() => {
  vi.restoreAllMocks();
});

test("the taken engine makes its first line and speaks upstream's English", () => {
  const added: EngineMessage[] = [];
  createChatEngine({
    tr: chatT,
    now: () => 0,
    members: () => [],
    staffName: () => null,
    store: { load: () => null, save: () => undefined },
    emit: (op, payload) => {
      if (op === "add" && payload && !Array.isArray(payload)) added.push(payload);
    },
  });
  expect(added.map((message) => message.text)).toEqual([
    "The office’s group. People post here when something is worth saying.",
  ]);
  expect(REACTIONS).toHaveLength(6);
  expect(chat.stickers).toHaveLength(8);
  expect(chatT("chat.stickers", null, "list")).toEqual(chat.stickers);
  expect(chatT("chat.boss")).toBe("Boss");
});

test("a dotted key is read from the chat area and its placeholders are filled", () => {
  expect(chatT("chat.sys.left", { name: "Alice" })).toBe("Alice left the group");
  expect(chatT("chat.sys.added", { by: "Boss", name: "Bea" })).toBe("Boss added Bea to the group");
  // A placeholder with no value stays as it is.
  expect(chatT("chat.sys.left")).toBe("{name} left the group");
});

test("an array gives one of its lines at random, and the whole array as a list", () => {
  vi.spyOn(Math, "random").mockReturnValue(0);
  expect(chatT("chat.reply.any")).toBe("Okay boss 👍");
  vi.spyOn(Math, "random").mockReturnValue(0.99);
  expect(chatT("chat.reply.any")).toBe("Will do");
  expect(chatT("chat.reply.any", null, "list")).toEqual([
    "Okay boss 👍",
    "Sure",
    "Got it",
    "Read it",
    "Will do",
  ]);
});

test("a one/other pair is chosen by n", () => {
  expect(chatT("chat.pins.said", { name: "Alice", n: 1 })).toBe(
    "📌 Alice just compacted its memory: the 1 note you pinned was said again.",
  );
  expect(chatT("chat.pins.said", { name: "Alice", n: 3 })).toBe(
    "📌 Alice just compacted its memory: the 3 notes you pinned were said again.",
  );
});

test("upstream's emoji stay in the lines", () => {
  expect(chatT("chat.like")).toBe("Send 👍");
});

test("the director has upstream's English name", () => {
  expect(chatT("people.director")).toBe("Director");
});

test("an unknown key gives the key, and an empty list", () => {
  expect(chatT("chat.nothing.here")).toBe("chat.nothing.here");
  expect(chatT("people.reception")).toBe("people.reception");
  expect(chatT("chat.nothing.here", null, "list")).toEqual([]);
});
