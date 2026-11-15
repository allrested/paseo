import { expect, test } from "vitest";
import type { FeedEntry, FeedEvent, FeedState } from "../shared/contracts.js";
import { EMPTY_FEED } from "../shared/feed.js";
import { createFeed, type FeedSubscriber } from "./feed.js";
import type { FeedStore } from "./feed-store.js";

const entry = (id: string, extra: Partial<FeedEntry> = {}): FeedEntry => ({
  id,
  at: "2026-11-15T09:00:00.000Z",
  kind: "finished",
  agentId: "a1",
  title: "Checkout total",
  folder: "/work/shop",
  text: "Done",
  ...extra,
});

function memoryStore(stored: FeedState = EMPTY_FEED) {
  const saved: FeedState[] = [];
  let failing = false;
  const store: FeedStore = {
    load: async () => stored,
    save: async (state) => {
      if (failing) throw new Error("disk full");
      saved.push(state);
    },
  };
  return { store, saved, fail: () => (failing = true) };
}

function subscriber() {
  const events: FeedEvent[] = [];
  const controller = new AbortController();
  const made: FeedSubscriber = {
    push: async (event) => void events.push(event),
    signal: controller.signal,
  };
  return { made, events, leave: () => controller.abort() };
}

const settle = () => new Promise((done) => setTimeout(done, 0));

test("a subscriber gets the stored feed, then each change, until it leaves", async () => {
  const stored: FeedState = { entries: [entry("old")], seenAt: null };
  const { store, saved } = memoryStore(stored);
  const feed = createFeed({ store, log: () => {} });
  const first = subscriber();
  const attached = feed.attach(first.made);
  await settle();

  await feed.add(entry("new"));
  await feed.seen("2026-11-15T10:00:00.000Z");
  first.leave();
  await attached;
  await feed.add(entry("later"));

  expect(first.events).toEqual([
    { type: "state", state: stored },
    { type: "added", entry: entry("new") },
    { type: "seen", seenAt: "2026-11-15T10:00:00.000Z" },
  ]);
  // Every change is saved whole.
  expect(saved.map((state) => state.entries.map((each) => each.id))).toEqual([
    ["new", "old"],
    ["new", "old"],
    ["later", "new", "old"],
  ]);
  expect(saved.at(-1)?.seenAt).toBe("2026-11-15T10:00:00.000Z");
});

test("a subscriber that comes later starts from the feed as it is then", async () => {
  const { store } = memoryStore();
  const feed = createFeed({ store, log: () => {} });
  await feed.add(entry("e1"));
  const late = subscriber();
  void feed.attach(late.made);
  await settle();

  expect(late.events).toEqual([{ type: "state", state: { entries: [entry("e1")], seenAt: null } }]);
});

test("an answered permission takes its entry out, and an unknown one changes nothing", async () => {
  const { store, saved } = memoryStore();
  const feed = createFeed({ store, log: () => {} });
  const watcher = subscriber();
  void feed.attach(watcher.made);
  await feed.add(entry("ask", { kind: "permission", requestId: "req-1" }));
  await feed.add(entry("done"));

  await feed.answered("req-9");
  await feed.answered("req-1");

  expect(watcher.events.at(-1)).toEqual({ type: "removed", ids: ["ask"] });
  expect(watcher.events).toHaveLength(4);
  expect(saved.at(-1)?.entries.map((each) => each.id)).toEqual(["done"]);
  expect(saved).toHaveLength(3);
});

test("an agent whose turn ended waits for nothing: its permissions go, its news stays", async () => {
  const { store, saved } = memoryStore();
  const feed = createFeed({ store, log: () => {} });
  await feed.add(entry("ask", { kind: "permission", requestId: "req-1" }));
  await feed.add(entry("other", { kind: "permission", requestId: "req-2", agentId: "a2" }));
  await feed.add(entry("done"));

  await feed.released("a1");

  expect(saved.at(-1)?.entries.map((each) => each.id)).toEqual(["done", "other"]);
});

test("a permission left in the file is not waited for any more", async () => {
  const stored: FeedState = {
    entries: [entry("done"), entry("ask", { kind: "permission", requestId: "req-1" })],
    seenAt: null,
  };
  const { store } = memoryStore(stored);
  const feed = createFeed({ store, log: () => {} });
  const watcher = subscriber();
  void feed.attach(watcher.made);
  await settle();

  expect(watcher.events).toEqual([
    { type: "state", state: { entries: [entry("done")], seenAt: null } },
  ]);
});

test("opening the feed twice at one time is one change", async () => {
  const { store, saved } = memoryStore();
  const feed = createFeed({ store, log: () => {} });

  expect(await feed.seen("2026-11-15T10:00:00.000Z")).toEqual({
    seenAt: "2026-11-15T10:00:00.000Z",
  });
  await feed.seen("2026-11-15T10:00:00.000Z");

  expect(saved).toHaveLength(1);
});

test("a save that fails is logged, and the feed goes on", async () => {
  const logs: string[] = [];
  const { store, fail } = memoryStore();
  const feed = createFeed({ store, log: (message) => logs.push(message) });
  const watcher = subscriber();
  void feed.attach(watcher.made);
  fail();

  await feed.add(entry("e1"));

  expect(logs).toEqual(["[feed] the feed could not be saved: disk full"]);
  expect(watcher.events.at(-1)).toEqual({ type: "added", entry: entry("e1") });
});

test("a subscriber whose push fails does not stop the others", async () => {
  const { store } = memoryStore();
  const feed = createFeed({ store, log: () => {} });
  const gone: FeedSubscriber = {
    push: async () => {
      throw new Error("left");
    },
    signal: new AbortController().signal,
  };
  const watcher = subscriber();
  void feed.attach(gone);
  void feed.attach(watcher.made);
  await settle();

  await feed.add(entry("e1"));

  expect(watcher.events.at(-1)).toEqual({ type: "added", entry: entry("e1") });
});

test("a subscriber that already left gets nothing", async () => {
  const { store } = memoryStore();
  const feed = createFeed({ store, log: () => {} });
  const early = subscriber();
  early.leave();

  await feed.attach(early.made);
  await feed.add(entry("e1"));

  expect(early.events).toEqual([]);
});
