import { expect, test } from "vitest";
import type { OfficeAgent, OfficeEvent, Post } from "../shared/contracts.js";
import { createFakeClock, settle, type FakeClock } from "./fake-clock.js";
import {
  DIRECTORY_FLUSH_MS,
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
  emit(view: DirectoryView): void;
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

function startHarness(initial: DirectoryView): Harness {
  const clock = createFakeClock();
  let directoryListener: ((view: DirectoryView) => void) | null = null;
  let activityListener: ((activity: Readonly<Record<string, string>>) => void) | null = null;
  let runningList: () => readonly string[] = () => [];
  const directory: FakeDirectory = {
    opens: 0,
    stops: 0,
    failure: null,
    emit: (view) => directoryListener?.(view),
  };
  const activity: FakeActivity = {
    starts: 0,
    stops: 0,
    running: () => runningList(),
    emit: (next) => activityListener?.(next),
  };
  const ports: HubPorts = {
    async openDirectory(listener) {
      directory.opens += 1;
      if (directory.failure) throw directory.failure;
      directoryListener = listener;
      listener(initial);
      return async () => {
        directory.stops += 1;
        directoryListener = null;
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
