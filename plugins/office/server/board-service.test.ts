import { expect, test } from "vitest";
import type { Post } from "../shared/contracts.js";
import { EMPTY_BOARDS, type BoardStore, type BoardsFile } from "./board-store.js";
import { createBoardService, trimBoard, type BoardService } from "./board-service.js";
import { createFakeClock, settle, type FakeClock } from "./fake-clock.js";

const T0 = Date.parse("2026-11-11T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const NAMES = new Map([
  ["a", "Alice"],
  ["b", "Bob"],
]);

interface MemoryStore extends BoardStore {
  saved: BoardsFile[];
  failNext: boolean;
  /** A load waits for this. */
  ready: Promise<void>;
}

function memoryStore(initial: BoardsFile = EMPTY_BOARDS): MemoryStore {
  let current = initial;
  const store: MemoryStore = {
    saved: [],
    failNext: false,
    ready: Promise.resolve(),
    load: async () => {
      await store.ready;
      return current;
    },
    save: async (data) => {
      if (store.failNext) {
        store.failNext = false;
        throw new Error("disk full");
      }
      current = data;
      store.saved.push(data);
    },
  };
  return store;
}

interface Harness {
  service: BoardService;
  store: MemoryStore;
  clock: FakeClock;
  events: string[];
}

interface Listeners {
  onBoard?: (board: string, posts: readonly Post[]) => void;
  onBoardRemoved?: (board: string) => void;
}

/** A service that has not loaded its boards yet. */
function build(initial?: BoardsFile, listeners: Listeners = {}): Harness {
  const store = memoryStore(initial);
  const clock = createFakeClock(T0);
  const events: string[] = [];
  const service = createBoardService({
    store,
    clock,
    log: (message) => events.push(`log ${message}`),
    label: (author) => NAMES.get(author) ?? author,
    onBoard:
      listeners.onBoard ??
      ((board, posts) => events.push(`board ${board} ${posts.map((item) => item.id).join(",")}`)),
    onBoardRemoved: listeners.onBoardRemoved ?? ((board) => events.push(`removed ${board}`)),
  });
  return { service, store, clock, events };
}

async function harness(initial?: BoardsFile, listeners?: Listeners): Promise<Harness> {
  const built = build(initial, listeners);
  await built.service.start();
  return built;
}

function post(seq: number, fields: Partial<Post> = {}): Post {
  return {
    id: `p${seq}`,
    seq,
    board: "w1",
    kind: "note",
    text: `post ${seq}`,
    author: "user",
    createdAt: new Date(T0 + seq * 1000).toISOString(),
    updatedAt: new Date(T0 + seq * 1000).toISOString(),
    ...fields,
  };
}

function file(posts: Post[]): BoardsFile {
  return { version: 1, nextSeq: posts.length + 1, wakesPaused: false, posts };
}

test("a post gets the next seq, an id, trimmed text and an open state", async () => {
  const { service, events } = await harness();
  const result = await service.post({
    board: "w1",
    kind: "task",
    text: "  Write tests  ",
    author: "a",
    to: "b",
  });
  expect(result).toEqual({
    ok: true,
    post: {
      id: "p1",
      seq: 1,
      board: "w1",
      kind: "task",
      text: "Write tests",
      author: "a",
      to: "b",
      state: "open",
      createdAt: "2026-11-11T09:00:00.000Z",
      updatedAt: "2026-11-11T09:00:00.000Z",
    },
  });
  expect(events).toEqual(["board w1 p1"]);
  expect(service.boards()).toEqual({ w1: [result.ok ? result.post : null] });
});

test("posts made at the same time run one after the other", async () => {
  const { service } = await harness();
  const results = await Promise.all(
    ["one", "two", "three"].map((text) =>
      service.post({ board: "w1", kind: "note", text, author: "user" }),
    ),
  );
  expect(results.map((result) => result.ok && result.post.id)).toEqual(["p1", "p2", "p3"]);
  expect(service.boards().w1?.map((item) => item.text)).toEqual(["one", "two", "three"]);
});

test("a post made while the boards load waits for them", async () => {
  const { service, store } = build(file([post(1), post(2)]));
  let finishLoad: () => void = () => undefined;
  store.ready = new Promise((resolve) => {
    finishLoad = resolve;
  });
  const started = service.start();
  const posting = service.post({ board: "w1", kind: "note", text: "late", author: "user" });
  // Time for the post to go ahead of the load, if it does not wait.
  await settle();
  expect(store.saved).toEqual([]);
  finishLoad();
  await started;
  const late = await posting;
  expect(late.ok && late.post.id).toBe("p3");
  expect(service.boards().w1?.map((item) => item.id)).toEqual(["p1", "p2", "p3"]);
});

test("blank and overlong text is refused", async () => {
  const { service, store } = await harness();
  expect(await service.post({ board: "lobby", kind: "note", text: "   ", author: "user" })).toEqual(
    {
      ok: false,
      error: "Unable to post: the text is empty",
    },
  );
  expect(
    await service.post({ board: "lobby", kind: "note", text: "x".repeat(2001), author: "user" }),
  ).toEqual({
    ok: false,
    error: "Unable to post: the text is longer than 2,000 characters",
  });
  expect(store.saved).toEqual([]);
});

test("claim rules: one claimer, a repeat claim is a no-op, done cannot be claimed, reopen clears", async () => {
  const { service } = await harness();
  await service.post({ board: "w1", kind: "task", text: "Ship it", author: "user" });
  const claimed = await service.update({ id: "p1", action: "claim", actor: "a" });
  expect(claimed).toEqual({
    ok: true,
    post: expect.objectContaining({ state: "claimed", claimedBy: "a", seq: 2 }),
  });
  expect(await service.update({ id: "p1", action: "claim", actor: "b" })).toEqual({
    ok: false,
    error: "Unable to claim p1: claimed by Alice",
  });
  expect(await service.update({ id: "p1", action: "claim", actor: "a" })).toEqual(claimed);
  expect(await service.update({ id: "p1", action: "done", actor: "a" })).toEqual({
    ok: true,
    post: expect.objectContaining({ state: "done", claimedBy: "a", seq: 3 }),
  });
  expect(await service.update({ id: "p1", action: "claim", actor: "b" })).toEqual({
    ok: false,
    error: "Unable to claim p1: it is done",
  });
  const reopened = await service.update({ id: "p1", action: "reopen", actor: "b" });
  expect(reopened.ok && reopened.post).toEqual({
    id: "p1",
    seq: 4,
    board: "w1",
    kind: "task",
    text: "Ship it",
    author: "user",
    state: "open",
    createdAt: "2026-11-11T09:00:00.000Z",
    updatedAt: "2026-11-11T09:00:00.000Z",
  });
});

test("reopening an open task and finishing a done one change nothing", async () => {
  const { service, store } = await harness();
  const created = await service.post({
    board: "w1",
    kind: "task",
    text: "Ship it",
    author: "user",
  });
  expect(await service.update({ id: "p1", action: "reopen", actor: "a" })).toEqual(created);
  const done = await service.update({ id: "p1", action: "done", actor: "a" });
  expect(await service.update({ id: "p1", action: "done", actor: "b" })).toEqual(done);
  expect(store.saved).toHaveLength(2);
});

test("notes have no state, and unknown ids are refused", async () => {
  const { service } = await harness();
  await service.post({ board: "w1", kind: "note", text: "fyi", author: "a" });
  expect(await service.update({ id: "p1", action: "claim", actor: "b" })).toEqual({
    ok: false,
    error: "Unable to claim p1: it is a note",
  });
  expect(await service.update({ id: "p9", action: "done", actor: "b" })).toEqual({
    ok: false,
    error: "Unable to update p9: no such post",
  });
});

test("a full board drops its oldest done tasks, then its oldest notes", () => {
  const posts = [
    post(1, { kind: "note" }),
    post(2, { kind: "task", state: "done" }),
    post(3, { kind: "task", state: "open" }),
    post(4, { kind: "note" }),
  ];
  expect(trimBoard(posts, 3).map((item) => item.id)).toEqual(["p1", "p3", "p4"]);
  expect(trimBoard(posts, 2).map((item) => item.id)).toEqual(["p3", "p4"]);
  expect(trimBoard(posts, 1).map((item) => item.id)).toEqual(["p3"]);
});

test("a board of 200 open tasks refuses a new post; one with a note makes room", async () => {
  const open = Array.from({ length: 200 }, (_, index) =>
    post(index + 1, { kind: "task", state: "open" }),
  );
  const full = await harness(file(open));
  expect(
    await full.service.post({ board: "w1", kind: "note", text: "hi", author: "user" }),
  ).toEqual({
    ok: false,
    error: "Unable to post: the board holds 200 open or claimed tasks",
  });
  const withNote = await harness(file([post(1, { kind: "note" }), ...open.slice(1)]));
  const result = await withNote.service.post({
    board: "w1",
    kind: "note",
    text: "hi",
    author: "user",
  });
  expect(result.ok).toBe(true);
  expect(
    withNote.service
      .boards()
      .w1?.map((item) => item.id)
      .includes("p1"),
  ).toBe(false);
  expect(withNote.service.boards().w1).toHaveLength(200);
});

test("done tasks are removed 7 days after they were finished", async () => {
  const { service, clock } = await harness();
  await service.post({ board: "w1", kind: "task", text: "Old", author: "user" });
  await service.update({ id: "p1", action: "done", actor: "user" });
  clock.advance(7 * DAY);
  await service.prune();
  expect(service.boards().w1).toHaveLength(1);
  clock.advance(1);
  await service.prune();
  expect(service.boards()).toEqual({});
});

test("read returns the newest 30, or the next 30 after a cursor, newest last", async () => {
  const { service } = await harness(
    file(Array.from({ length: 40 }, (_, index) => post(index + 1))),
  );
  const first = service.read("w1", null);
  expect([
    first.posts[0]?.id,
    first.posts.at(-1)?.id,
    first.posts.length,
    first.cursor,
    first.more,
  ]).toEqual(["p11", "p40", 30, 40, false]);
  const paged = service.read("w1", 5);
  expect([paged.posts[0]?.id, paged.posts.at(-1)?.id, paged.cursor, paged.more]).toEqual([
    "p6",
    "p35",
    35,
    true,
  ]);
  expect(service.read("w1", 40)).toEqual({ posts: [], cursor: 40, more: false });
  expect(service.read("lobby", null)).toEqual({ posts: [], cursor: 0, more: false });
});

test("a failed save changes nothing and says so", async () => {
  const { service, store, events } = await harness();
  store.failNext = true;
  expect(await service.post({ board: "w1", kind: "note", text: "hi", author: "user" })).toEqual({
    ok: false,
    error: "Unable to save the board: disk full",
  });
  expect(service.boards()).toEqual({});
  expect(events).toEqual(["log [office] unable to save the board: disk full"]);
  expect((await service.post({ board: "w1", kind: "note", text: "hi", author: "user" })).ok).toBe(
    true,
  );
});

test("deleting a post, removing a board, and the persisted wake pause", async () => {
  const { service, store, events } = await harness();
  await service.post({ board: "w1", kind: "note", text: "one", author: "user" });
  await service.post({ board: "w2", kind: "note", text: "two", author: "user" });
  expect(await service.remove("p1")).toEqual({ ok: true });
  expect(await service.remove("p1")).toEqual({
    ok: false,
    error: "Unable to delete p1: no such post",
  });
  await service.removeBoard("w2");
  await service.removeBoard("w3");
  expect(service.boards()).toEqual({});
  expect(events.slice(-3)).toEqual(["board w1 ", "removed w2", "removed w3"]);
  await service.setWakesPaused(true);
  expect(service.wakesPaused()).toBe(true);
  expect(store.saved.at(-1)?.wakesPaused).toBe(true);
  store.failNext = true;
  await expect(service.setWakesPaused(false)).rejects.toThrow(
    "Unable to save the board: disk full",
  );
  expect(service.wakesPaused()).toBe(true);
});

test("a listener that throws is logged and the change still stands", async () => {
  const { service, events } = await harness(undefined, {
    onBoard: () => {
      throw new Error("hub down");
    },
    onBoardRemoved: () => {
      throw new Error("hub gone");
    },
  });
  expect((await service.post({ board: "w1", kind: "note", text: "hi", author: "user" })).ok).toBe(
    true,
  );
  await service.removeBoard("w1");
  expect(service.boards()).toEqual({});
  expect(events).toEqual([
    "log [office] board listener failed: hub down",
    "log [office] board listener failed: hub gone",
  ]);
});
