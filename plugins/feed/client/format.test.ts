import { expect, test } from "vitest";
import type { FeedEntry } from "../shared/contracts.js";
import {
  ago,
  agentMatches,
  countLabel,
  entryLabel,
  entryMatches,
  entryMeta,
  entryTitle,
  filterWords,
  folderName,
  markLabel,
  runningLabel,
  runningMeta,
} from "./format.js";

const NOW = Date.parse("2026-11-15T12:00:00.000Z");

test("a time reads as how long ago, and as a date once it is over a month", () => {
  expect(ago("2026-11-15T11:59:30.000Z", NOW)).toBe("just now");
  expect(ago("2026-11-15T11:18:00.000Z", NOW)).toBe("42 min ago");
  expect(ago("2026-11-15T07:00:00.000Z", NOW)).toBe("5 h ago");
  expect(ago("2026-11-12T12:00:00.000Z", NOW)).toBe("3 d ago");
  expect(ago("2026-09-01T12:00:00.000Z", NOW)).toBe("on 2026-09-01");
});

test("a folder is named by its last part, whichever way its slashes lean", () => {
  expect(folderName("/work/shop")).toBe("shop");
  expect(folderName("/work/shop/")).toBe("shop");
  expect(folderName("C:\\work\\shop")).toBe("shop");
  expect(folderName("/")).toBe("/");
});

test("a row names its agent, its folder and its time", () => {
  const entry = {
    kind: "failed" as const,
    title: "Checkout total",
    folder: "/work/shop",
    at: "2026-11-15T11:18:00.000Z",
  };

  expect(entryTitle(entry)).toBe("Checkout total");
  expect(entryMeta(entry, NOW)).toBe("shop · 42 min ago");
  expect(entryLabel(entry)).toBe("Failed: Checkout total. Open the agent");
  expect(entryTitle({ title: null })).toBe("Untitled agent");
});

test("the count is read as entries", () => {
  expect(countLabel(1)).toBe("1 unread entry");
  expect(countLabel(12)).toBe("12 unread entries");
});

const ENTRY: FeedEntry = {
  id: "e1",
  at: "2026-11-15T11:18:00.000Z",
  kind: "failed",
  agentId: "a1",
  title: "Checkout total",
  folder: "/work/shop",
  text: "Rate limit reached",
};

test("a filter is its words in lower case, and an empty one is no words", () => {
  expect(filterWords("  Shop   FAILED ")).toEqual(["shop", "failed"]);
  expect(filterWords("   ")).toEqual([]);
});

test("an entry passes when every word is in its agent, its folder, its line or what happened", () => {
  expect(entryMatches(ENTRY, [])).toBe(true);
  expect(entryMatches(ENTRY, ["checkout"])).toBe(true);
  expect(entryMatches(ENTRY, ["shop", "rate"])).toBe(true);
  expect(entryMatches(ENTRY, ["failed"])).toBe(true);
  expect(entryMatches({ ...ENTRY, kind: "permission" }, ["waiting"])).toBe(true);
  expect(entryMatches(ENTRY, ["shop", "finished"])).toBe(false);
  // The folder's last part is what a row shows, so it is what is searched.
  expect(entryMatches(ENTRY, ["work"])).toBe(false);
  expect(entryMatches({ ...ENTRY, title: null, text: null }, ["untitled"])).toBe(true);
});

test("a running agent passes by its title, its folder or the word running", () => {
  const agent = { title: "Checkout total", folder: "/work/api" };
  expect(agentMatches(agent, [])).toBe(true);
  expect(agentMatches(agent, ["api", "checkout"])).toBe(true);
  expect(agentMatches(agent, ["running"])).toBe(true);
  expect(agentMatches(agent, ["failed"])).toBe(false);
});

test("a running agent's row says where it works and when its turn started", () => {
  const agent = { title: null, folder: "/work/api", since: "2026-11-15T11:57:00.000Z" };
  expect(runningMeta(agent, NOW)).toBe("api · started 3 min ago");
  expect(runningLabel(agent)).toBe("Running: Untitled agent. Open the agent");
});

test("a turn that began before the feed listened has no start to show", () => {
  expect(runningMeta({ folder: "/work/api", since: null }, NOW)).toBe("api");
});

test("the mark button says what pressing it does, and to which entry", () => {
  expect(markLabel(ENTRY, false)).toBe("Mark unread: Checkout total");
  expect(markLabel(ENTRY, true)).toBe("Mark read: Checkout total");
});
