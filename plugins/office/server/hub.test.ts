import { expect, test } from "vitest";
import type { OfficeAgent, OfficeEvent, Post } from "../shared/contracts.js";
import { createFakeClock, settle, type FakeClock } from "./fake-clock.js";
import { newestAgents } from "./paseo-directory.js";
import {
  DIRECTORY_FLUSH_MS,
  DIRECTORY_RESTART_MS,
  createHub,
  type DirectoryView,
  type Hub,
  type HubPorts,
} from "./hub.js";

function agent(id: string, status: OfficeAgent["status"]): OfficeAgent {
  return {
    id,
    title: id,
    provider: "claude",
    model: null,
    status,
    workspaceId: null,
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-11T08:00:00.000Z",
  };
}

interface Deferred {
  promise: Promise<void>;
  release(): void;
}

function deferred(): Deferred {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function note(id: string): Post {
  return {
    id,
    seq: 1,
    board: "lobby",
    kind: "note",
    text: "hello",
    author: "user",
    createdAt: "2026-11-11T08:00:00.000Z",
    updatedAt: "2026-11-11T08:00:00.000Z",
  };
}

interface FakeDirectory {
  opens: number;
  stops: number;
  failure: Error | null;
  /** When set, an open waits for it before it reports the first view. */
  openGate: Promise<void> | null;
  /** When set, a stop waits for it after it counted. */
  stopGate: Promise<void> | null;
  /** When set, a stop rejects with it after its gate. */
  stopFailure: Error | null;
  emit(view: DirectoryView): void;
  /** The open directory ends on its own, as when the client drops its subscription. */
  end(): void;
}

interface FakeActivity {
  starts: number;
  stops: number;
  running(): readonly string[];
  emit(activity: Readonly<Record<string, string>>): void;
}

interface Harness {
  hub: Hub;
  clock: FakeClock;
  directory: FakeDirectory;
  activity: FakeActivity;
}

function startHarness(initial: DirectoryView, extra: Partial<HubPorts> = {}): Harness {
  const clock = createFakeClock();
  let directoryListener: ((view: DirectoryView) => void) | null = null;
  let endListener: (() => void) | null = null;
  let activityListener: ((activity: Readonly<Record<string, string>>) => void) | null = null;
  let runningList: () => readonly string[] = () => [];
  const directory: FakeDirectory = {
    opens: 0,
    stops: 0,
    failure: null,
    openGate: null,
    stopGate: null,
    stopFailure: null,
    emit: (view) => directoryListener?.(view),
    end: () => endListener?.(),
  };
  const activity: FakeActivity = {
    starts: 0,
    stops: 0,
    running: () => runningList(),
    emit: (next) => activityListener?.(next),
  };
  const ports: HubPorts = {
    async openDirectory(listener, onEnd) {
      directory.opens += 1;
      if (directory.openGate) await directory.openGate;
      if (directory.failure) throw directory.failure;
      directoryListener = listener;
      endListener = onEnd ?? null;
      listener(initial);
      return async () => {
        directory.stops += 1;
        directoryListener = null;
        endListener = null;
        if (directory.stopGate) await directory.stopGate;
        if (directory.stopFailure) throw directory.stopFailure;
      };
    },
    startActivity(running, listener) {
      activity.starts += 1;
      runningList = running;
      activityListener = listener;
      return () => {
        activity.stops += 1;
        activityListener = null;
      };
    },
    timers: clock,
    log: () => undefined,
    ...extra,
  };
  return { hub: createHub(ports), clock, directory, activity };
}

interface Subscriber {
  events: OfficeEvent[];
  controller: AbortController;
  done: Promise<void>;
}

function subscribe(hub: Hub): Subscriber {
  const events: OfficeEvent[] = [];
  const controller = new AbortController();
  const done = hub.attach({
    signal: controller.signal,
    push: async (event) => {
      events.push(event);
    },
  });
  return { events, controller, done };
}

const EMPTY_WAKE = { paused: false, queued: {} };

test("the first subscriber opens the directory and gets a snapshot; a second shares it", async () => {
  const harness = startHarness({ agents: [agent("a", "idle")], workspaces: [] });
  const first = subscribe(harness.hub);
  await settle();
  const snapshot: OfficeEvent = {
    type: "snapshot",
    state: {
      agents: [agent("a", "idle")],
      workspaces: [],
      activity: {},
      boards: {},
      wake: EMPTY_WAKE,
    },
  };
  expect(first.events).toEqual([snapshot]);

  const second = subscribe(harness.hub);
  await settle();
  expect(second.events).toEqual([snapshot]);
  expect(harness.directory.opens).toBe(1);
  expect(harness.activity.starts).toBe(1);

  first.controller.abort();
  await first.done;
  expect(harness.directory.stops).toBe(0);
  second.controller.abort();
  await second.done;
  await settle();
  expect(harness.directory.stops).toBe(1);
  expect(harness.activity.stops).toBe(1);

  const third = subscribe(harness.hub);
  await settle();
  expect(harness.directory.opens).toBe(2);
  third.controller.abort();
  await third.done;
});

test("directory changes reach subscribers once per flush window, and only when they differ", async () => {
  const harness = startHarness({ agents: [agent("a", "idle")], workspaces: [] });
  const subscriber = subscribe(harness.hub);
  await settle();
  harness.directory.emit({ agents: [agent("a", "running")], workspaces: [] });
  harness.directory.emit({
    agents: [agent("a", "running"), agent("b", "idle")],
    workspaces: [{ id: "w1", name: "main", projectName: "paseo" }],
  });
  expect(subscriber.events).toHaveLength(1);

  harness.clock.advance(DIRECTORY_FLUSH_MS);
  expect(subscriber.events.slice(1)).toEqual([
    { type: "agents", agents: [agent("a", "running"), agent("b", "idle")] },
    { type: "workspaces", workspaces: [{ id: "w1", name: "main", projectName: "paseo" }] },
  ]);

  harness.directory.emit({
    agents: [agent("a", "running"), agent("b", "idle")],
    workspaces: [{ id: "w1", name: "main", projectName: "paseo" }],
  });
  harness.clock.advance(DIRECTORY_FLUSH_MS);
  expect(subscriber.events).toHaveLength(3);
  subscriber.controller.abort();
  await subscriber.done;
});

test("activity covers the running agents and is pushed as it changes", async () => {
  const harness = startHarness({
    agents: [agent("a", "running"), agent("b", "idle")],
    workspaces: [],
  });
  const subscriber = subscribe(harness.hub);
  await settle();
  expect(harness.activity.running()).toEqual(["a"]);
  harness.activity.emit({ a: "Thinking" });
  expect(subscriber.events.at(-1)).toEqual({ type: "activity", activity: { a: "Thinking" } });
  subscriber.controller.abort();
  await subscriber.done;
});

test("boards and wake state reach subscribers and the next snapshot", async () => {
  const harness = startHarness({ agents: [], workspaces: [] });
  const first = subscribe(harness.hub);
  await settle();
  harness.hub.setBoard("lobby", [note("p1")]);
  harness.hub.setWake({ paused: true, queued: { a: 2 } });
  harness.hub.removeBoard("w-gone");
  expect(first.events.slice(1)).toEqual([
    { type: "board", board: "lobby", posts: [note("p1")] },
    { type: "wake", wake: { paused: true, queued: { a: 2 } } },
  ]);
  harness.hub.setBoard("w1", [note("p2")]);
  harness.hub.removeBoard("w1");
  expect(first.events.at(-1)).toEqual({ type: "board-removed", board: "w1" });

  const second = subscribe(harness.hub);
  await settle();
  expect(second.events).toEqual([
    {
      type: "snapshot",
      state: {
        agents: [],
        workspaces: [],
        activity: {},
        boards: { lobby: [note("p1")] },
        wake: { paused: true, queued: { a: 2 } },
      },
    },
  ]);
  first.controller.abort();
  second.controller.abort();
  await Promise.all([first.done, second.done]);
});

test("a directory that cannot open refuses the subscriber, and the next one tries again", async () => {
  const harness = startHarness({ agents: [], workspaces: [] });
  harness.directory.failure = new Error("directory down");
  const refused = subscribe(harness.hub);
  await expect(refused.done).rejects.toThrow("directory down");
  expect(refused.events).toEqual([]);

  harness.directory.failure = null;
  const next = subscribe(harness.hub);
  await settle();
  expect(harness.directory.opens).toBe(2);
  expect(next.events).toHaveLength(1);
  next.controller.abort();
  await next.done;
});

function officeOf(agents: OfficeAgent[]): OfficeEvent {
  return {
    type: "snapshot",
    state: { agents, workspaces: [], activity: {}, boards: {}, wake: EMPTY_WAKE },
  };
}

test("a subscriber that arrives while a cancelled start closes the directory gets a live office", async () => {
  const harness = startHarness({ agents: [agent("a", "idle")], workspaces: [] });
  const open = deferred();
  const close = deferred();
  harness.directory.openGate = open.promise;
  const left = subscribe(harness.hub);
  await settle();
  left.controller.abort();
  harness.directory.openGate = null;
  harness.directory.stopGate = close.promise;
  open.release();
  await settle();
  expect(harness.directory.stops).toBe(1);

  const arrived = subscribe(harness.hub);
  await settle();
  close.release();
  await settle();
  await left.done;
  expect(harness.directory.opens).toBe(2);
  expect(left.events).toEqual([]);
  expect(arrived.events).toEqual([officeOf([agent("a", "idle")])]);

  harness.directory.emit({ agents: [agent("a", "running")], workspaces: [] });
  harness.clock.advance(DIRECTORY_FLUSH_MS);
  expect(arrived.events.slice(1)).toEqual([{ type: "agents", agents: [agent("a", "running")] }]);
  arrived.controller.abort();
  await arrived.done;
});

test("a directory that ends on its own restarts while subscribers remain, at most once per window", async () => {
  const harness = startHarness({ agents: [agent("a", "idle")], workspaces: [] });
  const first = subscribe(harness.hub);
  const second = subscribe(harness.hub);
  await settle();
  const office = officeOf([agent("a", "idle")]);

  harness.directory.end();
  await settle();
  expect(harness.directory.stops).toBe(1);
  expect(harness.directory.opens).toBe(2);
  expect(harness.activity.starts).toBe(2);
  expect(first.events).toEqual([office, office]);
  expect(second.events).toEqual([office, office]);

  harness.directory.end();
  await settle();
  harness.clock.advance(DIRECTORY_RESTART_MS - 1);
  await settle();
  expect(harness.directory.opens).toBe(2);
  harness.clock.advance(1);
  await settle();
  expect(harness.directory.opens).toBe(3);
  expect(first.events).toEqual([office, office, office]);
  expect(second.events).toEqual([office, office, office]);

  harness.directory.end();
  first.controller.abort();
  second.controller.abort();
  await Promise.all([first.done, second.done]);
  await settle();
  expect(harness.directory.stops).toBe(3);
  harness.clock.advance(DIRECTORY_RESTART_MS);
  await settle();
  expect(harness.directory.opens).toBe(3);
  expect(harness.clock.pending()).toBe(0);
});

test("a subscriber gets its snapshot before any change made while the directory was starting", async () => {
  const harness = startHarness({ agents: [], workspaces: [] });
  const open = deferred();
  harness.directory.openGate = open.promise;
  const subscriber = subscribe(harness.hub);
  await settle();
  harness.hub.setBoard("lobby", [note("p1")]);
  open.release();
  await settle();
  expect(subscriber.events).toEqual([
    {
      type: "snapshot",
      state: {
        agents: [],
        workspaces: [],
        activity: {},
        boards: { lobby: [note("p1")] },
        wake: EMPTY_WAKE,
      },
    },
  ]);
  subscriber.controller.abort();
  await subscriber.done;
});

function createdAgent(index: number): OfficeAgent {
  return {
    ...agent(`a${index}`, "idle"),
    createdAt: new Date(Date.UTC(2026, 10, 11, 8, 0, index)).toISOString(),
  };
}

test("the directory keeps the 200 newest agents, oldest first", () => {
  const agents: OfficeAgent[] = [];
  for (let index = 0; index < 202; index += 1) agents.push(createdAgent(index));
  expect(newestAgents(agents.toReversed())).toEqual(agents.slice(2));
});

test("a restart whose open fails after the window closed is retried one window later", async () => {
  const harness = startHarness({ agents: [agent("a", "idle")], workspaces: [] });
  const subscriber = subscribe(harness.hub);
  await settle();
  const office = officeOf([agent("a", "idle")]);
  const open = deferred();
  harness.directory.openGate = open.promise;
  harness.directory.end();
  await settle();
  expect(harness.directory.stops).toBe(1);
  expect(harness.directory.opens).toBe(2);

  // An open that times out fails long after the restart window closed.
  harness.clock.advance(60_000);
  await settle();
  harness.directory.openGate = null;
  harness.directory.failure = new Error("request timed out");
  open.release();
  await settle();
  harness.directory.failure = null;
  harness.clock.advance(DIRECTORY_RESTART_MS - 1);
  await settle();
  expect(harness.directory.opens).toBe(2);
  harness.clock.advance(1);
  await settle();
  expect(harness.directory.opens).toBe(3);
  expect(subscriber.events).toEqual([office, office]);
  subscriber.controller.abort();
  await subscriber.done;
});

test("a new subscriber whose start fails while a restart waits does not cancel the retry", async () => {
  const harness = startHarness({ agents: [agent("a", "idle")], workspaces: [] });
  const subscriber = subscribe(harness.hub);
  await settle();
  const office = officeOf([agent("a", "idle")]);
  harness.directory.failure = new Error("directory down");
  harness.directory.end();
  await settle();
  expect(harness.directory.opens).toBe(2);

  const refused = subscribe(harness.hub);
  await expect(refused.done).rejects.toThrow("directory down");
  expect(harness.directory.opens).toBe(3);
  harness.directory.failure = null;
  harness.clock.advance(DIRECTORY_RESTART_MS);
  await settle();
  expect(harness.directory.opens).toBe(4);
  expect(subscriber.events).toEqual([office, office]);
  expect(refused.events).toEqual([]);
  subscriber.controller.abort();
  await subscriber.done;
});

test("subscribers attached before a start that recovers the directory get a fresh snapshot", async () => {
  const harness = startHarness({ agents: [agent("a", "idle")], workspaces: [] });
  const subscriber = subscribe(harness.hub);
  await settle();
  const office = officeOf([agent("a", "idle")]);
  harness.directory.failure = new Error("directory down");
  harness.directory.end();
  await settle();
  harness.directory.failure = null;

  const arrived = subscribe(harness.hub);
  await settle();
  expect(harness.directory.opens).toBe(3);
  expect(subscriber.events).toEqual([office, office]);
  expect(arrived.events).toEqual([office]);
  // The queued retry belonged to the failed start; the recovered directory is not restarted.
  harness.clock.advance(DIRECTORY_RESTART_MS);
  await settle();
  expect(harness.directory.opens).toBe(3);
  subscriber.controller.abort();
  arrived.controller.abort();
  await Promise.all([subscriber.done, arrived.done]);
});

test("a cancelled start whose close fails does not refuse the subscriber that joined it", async () => {
  const harness = startHarness({ agents: [agent("a", "idle")], workspaces: [] });
  const open = deferred();
  const close = deferred();
  harness.directory.openGate = open.promise;
  const left = subscribe(harness.hub);
  await settle();
  left.controller.abort();
  harness.directory.openGate = null;
  harness.directory.stopGate = close.promise;
  harness.directory.stopFailure = new Error("release failed");
  open.release();
  await settle();

  const arrived = subscribe(harness.hub);
  await settle();
  close.release();
  await settle();
  harness.directory.stopFailure = null;
  await left.done;
  expect(harness.directory.opens).toBe(2);
  expect(arrived.events).toEqual([officeOf([agent("a", "idle")])]);
  arrived.controller.abort();
  await arrived.done;
});

test("stopping the hub cancels a pending restart", async () => {
  const harness = startHarness({ agents: [agent("a", "idle")], workspaces: [] });
  const subscriber = subscribe(harness.hub);
  await settle();
  harness.directory.failure = new Error("directory down");
  harness.directory.end();
  await settle();
  expect(harness.clock.pending()).toBe(1);

  await harness.hub.stop();
  expect(harness.clock.pending()).toBe(0);
  harness.directory.failure = null;
  harness.clock.advance(DIRECTORY_RESTART_MS);
  await settle();
  expect(harness.directory.opens).toBe(2);
  subscriber.controller.abort();
  await subscriber.done;
});

test("the snapshot says whether the host can draw 3D", async () => {
  for (const available of [true, false]) {
    const { hub } = startHarness(
      { agents: [], workspaces: [] },
      { renderAvailable: () => available },
    );
    const subscriber = subscribe(hub);
    await settle();

    expect(subscriber.events[0]).toMatchObject({
      type: "snapshot",
      state: { render: { available } },
    });
    subscriber.controller.abort();
    await subscriber.done;
  }
});
