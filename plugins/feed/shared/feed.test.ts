import { expect, test } from "vitest";
import { MAX_ENTRIES, type FeedEntry, type FeedState } from "./contracts.js";
import { EMPTY_FEED, applyFeedEvent, isNew, newCount } from "./feed.js";

const entry = (id: string, at: string, extra: Partial<FeedEntry> = {}): FeedEntry => ({
  id,
  at,
  kind: "finished",
  agentId: `agent-${id}`,
  title: `Agent ${id}`,
  folder: "/work/shop",
  text: "Done",
  ...extra,
});

const TWO: FeedState = {
  entries: [entry("b", "2026-11-15T09:00:00.000Z"), entry("a", "2026-11-15T08:00:00.000Z")],
  seenAt: "2026-11-15T08:30:00.000Z",
};

test("a state event replaces the feed", () => {
  expect(applyFeedEvent(EMPTY_FEED, { type: "state", state: TWO })).toBe(TWO);
});

test("a new entry goes first, and the oldest goes when the feed is full", () => {
  const added = entry("c", "2026-11-15T10:00:00.000Z");
  expect(
    applyFeedEvent(TWO, { type: "added", entry: added }).entries.map((each) => each.id),
  ).toEqual(["c", "b", "a"]);

  const full: FeedState = {
    entries: Array.from({ length: MAX_ENTRIES }, (_, index) =>
      entry(`e${index}`, "2026-11-15T07:00:00.000Z"),
    ),
    seenAt: null,
  };
  const next = applyFeedEvent(full, { type: "added", entry: added });
  expect(next.entries).toHaveLength(MAX_ENTRIES);
  expect(next.entries[0]).toBe(added);
  expect(next.entries.at(-1)?.id).toBe(`e${MAX_ENTRIES - 2}`);
});

test("removed entries go; ids the feed does not hold change nothing", () => {
  expect(
    applyFeedEvent(TWO, { type: "removed", ids: ["b", "zz"] }).entries.map((each) => each.id),
  ).toEqual(["a"]);
  expect(applyFeedEvent(TWO, { type: "removed", ids: ["zz"] })).toBe(TWO);
});

test("opening the feed moves the mark, and the same mark changes nothing", () => {
  const seenAt = "2026-11-15T09:30:00.000Z";
  expect(applyFeedEvent(TWO, { type: "seen", seenAt })).toEqual({ ...TWO, seenAt });
  expect(applyFeedEvent(TWO, { type: "seen", seenAt: TWO.seenAt! })).toBe(TWO);
});

test("an entry is new when it came after the feed was last opened, or when it never was", () => {
  expect(isNew("2026-11-15T09:00:00.000Z", "2026-11-15T08:30:00.000Z")).toBe(true);
  expect(isNew("2026-11-15T08:00:00.000Z", "2026-11-15T08:30:00.000Z")).toBe(false);
  expect(isNew("2026-11-15T08:30:00.000Z", "2026-11-15T08:30:00.000Z")).toBe(false);
  expect(isNew("2026-11-15T08:00:00.000Z", null)).toBe(true);
  expect(newCount(TWO)).toBe(1);
  expect(newCount({ ...TWO, seenAt: null })).toBe(2);
  expect(newCount(EMPTY_FEED)).toBe(0);
});
