import { expect, test } from "vitest";
import type { Post, WakeState } from "../shared/contracts.js";
import { EMPTY_BOARDS, type BoardStore, type BoardsFile } from "./board-store.js";
import { createFakeClock, settle } from "./fake-clock.js";
import { PRUNE_INTERVAL_MS, createOffice, wakeAuthorLabel, type OfficeHub } from "./office.js";
import type { WakeTarget } from "./mention-queue.js";

interface RecordingHub extends OfficeHub {
  events: string[];
}

function recordingHub(): RecordingHub {
  const events: string[] = [];
  return {
    events,
    setBoards: (boards) => events.push(`boards ${Object.keys(boards).join(",")}`),
    setBoard: (board, posts: readonly Post[]) => events.push(`board ${board} ${posts.length}`),
    removeBoard: (board) => events.push(`removed ${board}`),
    setWake: (wake: WakeState) => events.push(`wake ${wake.paused} ${JSON.stringify(wake.queued)}`),
  };
}

interface MemoryStore extends BoardStore {
  current(): BoardsFile;
  /** The next save rejects with this message. */
  failNext(message: string): void;
  /** Loads wait until `release` is called. */
  hold(): void;
  release(): void;
}

function memoryStore(initial: BoardsFile = EMPTY_BOARDS): MemoryStore {
  let current = initial;
  let failure: string | null = null;
  let open: () => void = () => undefined;
  let gate: Promise<void> = Promise.resolve();
  return {
    current: () => current,
    failNext(message) {
      failure = message;
    },
    hold() {
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    release: () => open(),
    load: async () => {
      await gate;
      return current;
    },
    save: async (data) => {
      if (failure !== null) {
        const message = failure;
        failure = null;
        throw new Error(message);
      }
      current = data;
    },
  };
}

/** The agents the daemon knows, by full id and by a start of one. */
const FULL_IDS = new Map([
  ["a", "a"],
  ["b", "b"],
  ["bo", "b"],
]);

function setup(initial?: BoardsFile) {
  const clock = createFakeClock(Date.parse("2026-11-11T09:00:00.000Z"));
  const hub = recordingHub();
  const store = memoryStore(initial);
  const targets = new Map<string, WakeTarget>([["b", "wakeable"]]);
  const prompts: string[] = [];
  const sources: (string | null)[] = [];
  const logs: string[] = [];
  const build = () =>
    createOffice({
      store,
      clock,
      hub,
      agents: {
        status: async (agentId) => targets.get(agentId) ?? "gone",
        resolve: async (agentId) => FULL_IDS.get(agentId) ?? null,
        send: async (agentId, prompt, source) => {
          prompts.push(`${agentId}: ${prompt}`);
          sources.push(source);
        },
      },
      log: (message) => logs.push(message),
    });
  return { build, clock, hub, store, targets, prompts, sources, logs };
}

function start(initial?: BoardsFile) {
  const harness = setup(initial);
  return { ...harness, office: harness.build() };
}

function toolContext(agent: { id: string; title: string | null }) {
  return {
    agent: {
      id: agent.id,
      workspaceId: "w1",
      parentAgentId: null,
      provider: "claude",
      cwd: "/",
      title: agent.title,
      metadata: {},
    },
    paseo: undefined,
    signal: new AbortController().signal,
  };
}

test("author labels name the user, or the agent's title and id", () => {
  expect(wakeAuthorLabel("user", undefined)).toBe("the user");
  expect(wakeAuthorLabel("a1", "Review MR")).toBe("Review MR (a1)");
  expect(wakeAuthorLabel("a1", undefined)).toBe("agent a1");
});

test("on start the hub gets the boards and the wake state", async () => {
  const { office, hub } = start();
  await office.ready;
  expect(hub.events).toEqual(["boards ", "wake false {}"]);
});

test("a user post that names an agent lands on the board and wakes it", async () => {
  const { office, hub, prompts, sources } = start();
  await office.ready;
  expect((await office.post({ board: "w1", kind: "task", text: "Review this", to: "b" })).ok).toBe(
    true,
  );
  await settle();
  expect(prompts).toEqual(["b: Office board: 1 post(s) for you.\n- p1 from the user: Review this"]);
  // The user's post is a prompt as from the user: it names no source agent.
  expect(sources).toEqual([null]);
  expect(hub.events.slice(2)).toEqual(["board w1 1", 'wake false {"b":1}', "wake false {}"]);
});

test("an agent's tool post is labelled with its title and id, and the wake names it as the source", async () => {
  const { office, prompts, sources } = start();
  await office.ready;
  const post = office.tools.find((tool) => tool.name === "office_post");
  office.noteAgent({ id: "a", workspaceId: "w1", title: "Planner" });
  await post?.execute(
    { kind: "note", text: "Your turn", to: "b" },
    toolContext({ id: "a", title: "Planner" }),
  );
  await settle();
  expect(prompts).toEqual([
    "b: Office board: 1 post(s) for you.\n- p1 from Planner (a): Your turn",
  ]);
  expect(sources).toEqual(["a"]);
});

test("a tool post to the start of an agent's id is stored and queued under the full id", async () => {
  const { office, store, prompts } = start();
  await office.ready;
  const post = office.tools.find((tool) => tool.name === "office_post");
  const result = await post?.execute(
    { kind: "note", text: "Your turn", to: "bo" },
    toolContext({ id: "a", title: null }),
  );
  await settle();
  expect(result?.isError).toBeUndefined();
  expect(store.current().posts.map((item) => item.to)).toEqual(["b"]);
  // Queued under "bo", the agent's turn-end and close hooks (which carry "b") would never find it.
  expect(prompts).toEqual(["b: Office board: 1 post(s) for you.\n- p1 from agent a: Your turn"]);
});

test("a tool post to an agent the daemon does not know is refused and nothing is stored", async () => {
  const { office, store, prompts } = start();
  await office.ready;
  const post = office.tools.find((tool) => tool.name === "office_post");
  const result = await post?.execute(
    { kind: "note", text: "Anyone?", to: "zz" },
    toolContext({ id: "a", title: null }),
  );
  await settle();
  expect(result).toEqual({ text: "Unable to post: no agent zz", isError: true });
  expect(store.current().posts).toEqual([]);
  expect(prompts).toEqual([]);
});

test("a title with a line break names its agent on one line", async () => {
  const { office } = start();
  await office.ready;
  office.noteAgent({ id: "a", workspaceId: "w1", title: "  Plan\nner \n" });
  await office.post({ board: "w1", kind: "task", text: "Review this" });
  const update = office.tools.find((tool) => tool.name === "office_update");
  await update?.execute({ id: "p1", action: "claim" }, toolContext({ id: "a", title: null }));
  // The user is refused with the holder's name; a second line there would read as another entry.
  expect(await office.update({ id: "p1", action: "claim" })).toEqual({
    ok: false,
    error: "Unable to claim p1: claimed by Plan ner",
  });
});

test("pausing is saved and holds wakes until resumed", async () => {
  const { office, store, prompts } = start();
  await office.ready;
  expect(await office.setWakesPaused(true)).toEqual({ paused: true, queued: {} });
  expect(store.current().wakesPaused).toBe(true);
  await office.post({ board: "w1", kind: "note", text: "Later", to: "b" });
  await settle();
  expect(prompts).toEqual([]);
  expect(await office.setWakesPaused(false)).toEqual({ paused: false, queued: { b: 1 } });
  await settle();
  expect(prompts).toHaveLength(1);
});

test("a pause that cannot be saved is refused and wakes go on", async () => {
  const { office, store, prompts } = start();
  await office.ready;
  store.failNext("disk full");
  await expect(office.setWakesPaused(true)).rejects.toThrow("disk full");
  await office.post({ board: "w1", kind: "note", text: "Now", to: "b" });
  await settle();
  expect(prompts).toHaveLength(1);
});

test("a saved pause holds wakes from the start", async () => {
  const { office, hub, prompts } = start({ ...EMPTY_BOARDS, wakesPaused: true });
  await office.ready;
  expect(hub.events).toEqual(["boards ", "wake true {}"]);
  await office.post({ board: "w1", kind: "note", text: "Later", to: "b" });
  await settle();
  expect(prompts).toEqual([]);
});

test("an agent's turn end sends what waited for it, and a closed agent's queue is dropped", async () => {
  const { office, hub, targets, prompts } = start();
  await office.ready;
  targets.set("b", "busy");
  await office.post({ board: "w1", kind: "note", text: "one", to: "b" });
  await settle();
  expect(prompts).toEqual([]);
  targets.set("b", "wakeable");
  office.turnEnded("b");
  await settle();
  expect(prompts).toHaveLength(1);
  targets.set("b", "busy");
  await office.post({ board: "w1", kind: "note", text: "two", to: "b" });
  await settle();
  office.agentGone("b");
  expect(hub.events.slice(-2)).toEqual(['wake false {"b":1}', "wake false {}"]);
});

test("an archived workspace loses its board; done tasks are pruned every hour", async () => {
  const { office, hub, clock, store } = start();
  await office.ready;
  await office.post({ board: "w1", kind: "note", text: "one" });
  await office.workspaceArchived("w1");
  expect(hub.events.at(-1)).toBe("removed w1");
  await office.post({ board: "w2", kind: "task", text: "two" });
  await office.update({ id: "p2", action: "done" });
  clock.advance(7 * 24 * 60 * 60 * 1000);
  await settle();
  expect(store.current().posts).toHaveLength(1);
  clock.advance(PRUNE_INTERVAL_MS);
  await settle();
  expect(store.current().posts).toEqual([]);
  office.stop();
  expect(clock.pending()).toBe(0);
});

test("stopping the office cancels a wake that waited to be tried again", async () => {
  const { office, clock, targets, prompts } = start();
  await office.ready;
  targets.set("b", "busy");
  await office.post({ board: "w1", kind: "note", text: "one", to: "b" });
  await settle();
  office.stop();
  expect(clock.pending()).toBe(0);
  targets.set("b", "wakeable");
  clock.advance(60_000);
  await settle();
  expect(prompts).toEqual([]);
});

test("an office stopped while its boards load starts no timer and tells the hub nothing", async () => {
  const { build, store, hub, clock } = setup();
  store.hold();
  const office = build();
  office.stop();
  store.release();
  await office.ready;
  expect(hub.events).toEqual([]);
  expect(clock.pending()).toBe(0);
});
