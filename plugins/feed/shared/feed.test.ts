import { expect, test } from "vitest";
import { MAX_ENTRIES, type FeedEntry, type FeedState, type RunningAgent } from "./contracts.js";
import { EMPTY_FEED, applyFeedEvent, isMarked, isNew, newCount } from "./feed.js";

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

test("an entry is marked unread and read again; a mark that changes nothing keeps the feed", () => {
  const marked = applyFeedEvent(TWO, { type: "marked", id: "a", unread: true });
  expect(marked.unread).toEqual(["a"]);
  expect(isMarked(marked, "a")).toBe(true);
  expect(isMarked(marked, "b")).toBe(false);
  expect(applyFeedEvent(marked, { type: "marked", id: "a", unread: true })).toBe(marked);
  // Read again: the feed holds no list of marks when none is left.
  const read = applyFeedEvent(marked, { type: "marked", id: "a", unread: false });
  expect(read).toEqual(TWO);
  expect("unread" in read).toBe(false);
  expect(applyFeedEvent(TWO, { type: "marked", id: "a", unread: false })).toBe(TWO);
  // An entry the feed does not hold cannot be marked.
  expect(applyFeedEvent(TWO, { type: "marked", id: "zz", unread: true })).toBe(TWO);
});

test("a marked entry counts as unread whenever the feed was opened", () => {
  const marked = applyFeedEvent(TWO, { type: "marked", id: "a", unread: true });
  // "b" came after the feed was opened, "a" is marked.
  expect(newCount(marked)).toBe(2);
  const opened = applyFeedEvent(marked, { type: "seen", seenAt: "2026-11-15T12:00:00.000Z" });
  expect(newCount(opened)).toBe(1);
  // One entry that is both new and marked counts once.
  expect(newCount(applyFeedEvent(TWO, { type: "marked", id: "b", unread: true }))).toBe(1);
});

test("a mark goes with its entry, when it is removed or pushed out of a full feed", () => {
  const marked = applyFeedEvent(TWO, { type: "marked", id: "a", unread: true });
  const removed = applyFeedEvent(marked, { type: "removed", ids: ["a"] });
  expect("unread" in removed).toBe(false);
  const full: FeedState = {
    entries: Array.from({ length: MAX_ENTRIES }, (_, index) =>
      entry(`e${index}`, "2026-11-15T07:00:00.000Z"),
    ),
    seenAt: null,
    unread: ["e0", `e${MAX_ENTRIES - 1}`],
  };
  const next = applyFeedEvent(full, {
    type: "added",
    entry: entry("c", "2026-11-15T10:00:00.000Z"),
  });
  expect(next.unread).toEqual(["e0"]);
});

const turn = (
  agentId: string,
  since: string | null = "2026-11-15T09:10:00.000Z",
): RunningAgent => ({
  agentId,
  title: `Agent ${agentId}`,
  folder: "/work/shop",
  since,
});
const runningIds = (state: FeedState) => state.running?.map((agent) => agent.agentId);

test("an agent whose turn starts goes first, and a new turn of the same agent replaces the old", () => {
  const one = applyFeedEvent(TWO, { type: "started", agent: turn("x") });
  const two = applyFeedEvent(one, { type: "started", agent: turn("y") });
  expect(runningIds(two)).toEqual(["y", "x"]);
  expect(two.entries).toBe(TWO.entries);

  const again = turn("x", "2026-11-15T09:20:00.000Z");
  const three = applyFeedEvent(two, { type: "started", agent: again });
  expect(three.running).toEqual([again, turn("y")]);
});

test("a turn found running, without a start, goes after the turns that were seen to begin", () => {
  const seen = applyFeedEvent(TWO, { type: "started", agent: turn("x") });
  const found = applyFeedEvent(seen, { type: "started", agent: turn("old", null) });
  expect(runningIds(found)).toEqual(["x", "old"]);
});

test("an agent whose turn ends leaves; the last one takes the list with it", () => {
  const both = applyFeedEvent(applyFeedEvent(TWO, { type: "started", agent: turn("x") }), {
    type: "started",
    agent: turn("y"),
  });
  const one = applyFeedEvent(both, { type: "stopped", agentId: "x" });
  expect(runningIds(one)).toEqual(["y"]);
  // An agent that was not listed changes nothing.
  expect(applyFeedEvent(one, { type: "stopped", agentId: "zz" })).toBe(one);

  const none = applyFeedEvent(one, { type: "stopped", agentId: "y" });
  expect("running" in none).toBe(false);
  expect(none).toEqual(TWO);
});

test("what runs is no news: it does not count as unread", () => {
  const state = applyFeedEvent(TWO, { type: "started", agent: turn("x") });
  expect(newCount(state)).toBe(newCount(TWO));
});
