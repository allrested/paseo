import { expect, test } from "vitest";
import type {
  ChecklistStep,
  Checklists,
  OfficeAgent,
  OfficeEvent,
  Post,
} from "../shared/contracts.js";
import type { ActivityLines, ActivitySteps } from "./activity.js";
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
  emit(activity: ActivityLines, doing?: ActivitySteps, checklists?: Checklists): void;
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
  let activityListener:
    | ((activity: ActivityLines, doing: ActivitySteps, checklists: Checklists) => void)
    | null = null;
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
    emit: (next, doing = {}, checklists = {}) => activityListener?.(next, doing, checklists),
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
      doing: {},
      checklists: {},
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
  expect(subscriber.events.at(-1)).toEqual({
    type: "activity",
    activity: { a: "Thinking" },
    doing: {},
    checklists: {},
  });
  // A step travels with the lines, and the next snapshot has both.
  harness.activity.emit({ a: "Running Bash" }, { a: { kind: "deploy", key: "c7" } });
  expect(subscriber.events.at(-1)).toEqual({
    type: "activity",
    activity: { a: "Running Bash" },
    doing: { a: { kind: "deploy", key: "c7" } },
    checklists: {},
  });
  const late = subscribe(harness.hub);
  await settle();
  expect(late.events[0]).toMatchObject({
    type: "snapshot",
    state: { activity: { a: "Running Bash" }, doing: { a: { kind: "deploy", key: "c7" } } },
  });
  late.controller.abort();
  await late.done;
  subscriber.controller.abort();
  await subscriber.done;
});

const STEP: ChecklistStep = { text: "Run typecheck", status: "in_progress" };

test("a checklist stays after its agent stops and goes when the agent leaves", async () => {
  const harness = startHarness({ agents: [agent("a1", "running")], workspaces: [] });
  const subscriber = subscribe(harness.hub);
  await settle();
  harness.activity.emit({ a1: "Thinking" }, {}, { a1: [STEP] });
  expect(subscriber.events.slice(1)).toEqual([
    { type: "activity", activity: { a1: "Thinking" }, doing: {}, checklists: { a1: [STEP] } },
  ]);
  const late = subscribe(harness.hub);
  await settle();
  expect(late.events).toEqual([
    {
      type: "snapshot",
      state: {
        agents: [agent("a1", "running")],
        workspaces: [],
        activity: { a1: "Thinking" },
        doing: {},
        checklists: { a1: [STEP] },
        boards: {},
        wake: EMPTY_WAKE,
      },
    },
  ]);

  // a1 stopped: the poller reads it no more, and its checklist stays.
  harness.directory.emit({ agents: [agent("a1", "idle")], workspaces: [] });
  harness.activity.emit({}, {}, {});
  expect(subscriber.events.slice(2)).toEqual([
    { type: "activity", activity: {}, doing: {}, checklists: { a1: [STEP] } },
  ]);

  // a1 archived: it leaves the agent list, and its checklist goes before any poll round.
  harness.directory.emit({ agents: [], workspaces: [] });
  expect(subscriber.events.slice(3)).toEqual([
    { type: "activity", activity: {}, doing: {}, checklists: {} },
  ]);
  late.controller.abort();
  subscriber.controller.abort();
  await Promise.all([late.done, subscriber.done]);
});

test("an empty report removes the agent's checklist", async () => {
  const harness = startHarness({
    agents: [agent("a1", "running"), agent("a2", "running")],
    workspaces: [],
  });
  const subscriber = subscribe(harness.hub);
  await settle();
  harness.activity.emit({}, {}, { a1: [STEP], a2: [STEP] });
  // a1 finished every step; a2 was not read this round and keeps its own.
  harness.activity.emit({}, {}, { a1: [] });
  expect(subscriber.events.at(-1)).toEqual({
    type: "activity",
    activity: {},
    doing: {},
    checklists: { a2: [STEP] },
  });
  harness.activity.emit({}, {}, { a2: [] });
  expect(subscriber.events.at(-1)).toEqual({
    type: "activity",
    activity: {},
    doing: {},
    checklists: {},
  });
  subscriber.controller.abort();
  await subscriber.done;
});

test("a report that names an agent no longer listed does not bring its checklist back", async () => {
  const harness = startHarness({
    agents: [agent("a1", "running"), agent("a2", "running")],
    workspaces: [],
  });
  const subscriber = subscribe(harness.hub);
  await settle();
  harness.activity.emit({}, {}, { a1: [STEP] });
  // a1 is archived while a round is reading it; that round's report still names it.
  harness.directory.emit({ agents: [agent("a2", "running")], workspaces: [] });
  harness.activity.emit({}, {}, { a1: [STEP], a2: [STEP] });
  expect(subscriber.events.at(-1)).toEqual({
    type: "activity",
    activity: {},
    doing: {},
    checklists: { a2: [STEP] },
  });
  subscriber.controller.abort();
  await subscriber.done;
});

test("stopping the directory empties the checklists", async () => {
  const harness = startHarness({ agents: [agent("a1", "running")], workspaces: [] });
  const first = subscribe(harness.hub);
  await settle();
  harness.activity.emit({ a1: "Thinking" }, {}, { a1: [STEP] });
  first.controller.abort();
  await first.done;
  await settle();
  expect(harness.directory.stops).toBe(1);
  expect((await harness.hub.read()).checklists).toEqual({});

  const next = subscribe(harness.hub);
  await settle();
  expect(next.events).toEqual([officeOf([agent("a1", "running")])]);
  next.controller.abort();
  await next.done;
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
        doing: {},
        checklists: {},
        boards: { lobby: [note("p1")] },
        wake: { paused: true, queued: { a: 2 } },
      },
    },
  ]);
  first.controller.abort();
  second.controller.abort();
  await Promise.all([first.done, second.done]);
});

const NOTES = {
  folderSet: true,
  writing: true,
  writtenAt: null,
  failedAgentId: null,
  problem: null,
  scheduleError: null,
};

test("the notes reach subscribers in a snapshot, and the same notes again send nothing", async () => {
  const harness = startHarness({ agents: [], workspaces: [] });
  harness.hub.setNotes(NOTES);
  const subscriber = subscribe(harness.hub);
  await settle();
  expect(subscriber.events).toEqual([
    {
      type: "snapshot",
      state: {
        agents: [],
        workspaces: [],
        activity: {},
        doing: {},
        checklists: {},
        boards: {},
        wake: EMPTY_WAKE,
        notes: NOTES,
      },
    },
  ]);
  harness.hub.setNotes({ ...NOTES });
  expect(subscriber.events).toHaveLength(1);
  harness.hub.setNotes({ ...NOTES, writing: false, writtenAt: 1 });
  expect(subscriber.events.at(-1)).toMatchObject({
    type: "snapshot",
    state: { notes: { writing: false, writtenAt: 1 } },
  });
  subscriber.controller.abort();
  await subscriber.done;
});

const INCIDENTS = {
  open: [
    {
      id: "jira:OPS-7",
      source: "jira" as const,
      key: "OPS-7",
      title: "Checkout fails on a split bill",
      url: "https://jira.example.test/browse/OPS-7",
      createdAt: 1,
      foundAt: 2,
    },
  ],
  problems: {},
  jiraReady: true,
  sentryReady: false,
  scheduleError: null,
};

test("setIncidents broadcasts a snapshot carrying incidents; the same state sends nothing", async () => {
  const harness = startHarness({ agents: [], workspaces: [] });
  const subscriber = subscribe(harness.hub);
  await settle();
  expect(subscriber.events).toHaveLength(1);
  harness.hub.setIncidents(INCIDENTS);
  expect(subscriber.events.at(-1)).toEqual({
    type: "snapshot",
    state: {
      agents: [],
      workspaces: [],
      activity: {},
      doing: {},
      boards: {},
      wake: EMPTY_WAKE,
      checklists: {},
      incidents: INCIDENTS,
    },
  });
  harness.hub.setIncidents({ ...INCIDENTS, open: [...INCIDENTS.open] });
  expect(subscriber.events).toHaveLength(2);
  harness.hub.setIncidents({ ...INCIDENTS, problems: { jira: "Jira answered 503" } });
  expect(subscriber.events).toHaveLength(3);
  expect(subscriber.events.at(-1)).toMatchObject({
    type: "snapshot",
    state: { incidents: { problems: { jira: "Jira answered 503" } } },
  });
  subscriber.controller.abort();
  await subscriber.done;
});

test("a chat source is in the next snapshot and subscribers get one when it is set", async () => {
  const harness = startHarness({ agents: [], workspaces: [] });
  const first = subscribe(harness.hub);
  await settle();
  harness.hub.setChat(() => ({ messages: [], typing: ["A"] }));
  expect(first.events).toHaveLength(2);
  expect(first.events.at(-1)).toMatchObject({
    type: "snapshot",
    state: { chat: { messages: [], typing: ["A"] } },
  });

  const second = subscribe(harness.hub);
  await settle();
  expect(second.events).toEqual([
    {
      type: "snapshot",
      state: {
        agents: [],
        workspaces: [],
        activity: {},
        doing: {},
        checklists: {},
        boards: {},
        wake: EMPTY_WAKE,
        chat: { messages: [], typing: ["A"] },
      },
    },
  ]);

  harness.hub.setChat(null);
  const last = first.events.at(-1);
  expect(last?.type).toBe("snapshot");
  expect(last?.type === "snapshot" && "chat" in last.state).toBe(false);
  first.controller.abort();
  second.controller.abort();
  await Promise.all([first.done, second.done]);
});

test("a chat change goes to subscribers that have their snapshot, as a chat event", async () => {
  const harness = startHarness({ agents: [], workspaces: [] });
  const gate = deferred();
  harness.directory.openGate = gate.promise;
  const subscriber = subscribe(harness.hub);
  await settle();
  harness.hub.chatChange({ op: "typing", names: ["A"] });
  expect(subscriber.events).toEqual([]);

  gate.release();
  await settle();
  harness.hub.chatChange({ op: "typing", names: ["B"] });
  expect(subscriber.events.map((event) => event.type)).toEqual(["snapshot", "chat"]);
  expect(subscriber.events.at(-1)).toEqual({
    type: "chat",
    change: { op: "typing", names: ["B"] },
  });
  subscriber.controller.abort();
  await subscriber.done;
});

test("a watcher gets each view the directory reports, and null when it stops", async () => {
  const first: DirectoryView = { agents: [agent("a", "idle")], workspaces: [] };
  const harness = startHarness(first);
  const seen: (DirectoryView | null)[] = [];
  harness.hub.watch((view) => seen.push(view));
  expect(seen).toEqual([]);

  const subscriber = subscribe(harness.hub);
  await settle();
  expect(seen).toEqual([first]);

  const next: DirectoryView = { agents: [agent("a", "running")], workspaces: [] };
  harness.directory.emit(next);
  expect(seen).toEqual([first, next]);

  subscriber.controller.abort();
  await subscriber.done;
  await settle();
  expect(seen).toEqual([first, next, null]);
});

test("a watcher added while a directory is open gets the current view at once, and can be removed", async () => {
  const first: DirectoryView = { agents: [agent("a", "idle")], workspaces: [] };
  const harness = startHarness(first);
  const subscriber = subscribe(harness.hub);
  await settle();
  const seen: (DirectoryView | null)[] = [];
  const stop = harness.hub.watch((view) => seen.push(view));
  expect(seen).toEqual([first]);

  stop();
  harness.directory.emit({ agents: [agent("a", "running")], workspaces: [] });
  subscriber.controller.abort();
  await subscriber.done;
  await settle();
  expect(seen).toEqual([first]);
});

test("a watcher hears null after a start whose subscriber left before the directory opened", async () => {
  const full = { ...agent("a", "idle"), context: { usedTokens: 1_000, maxTokens: 200_000 } };
  const first: DirectoryView = { agents: [full], workspaces: [] };
  const harness = startHarness(first);
  const gate = deferred();
  harness.directory.openGate = gate.promise;
  const seen: (DirectoryView | null)[] = [];
  harness.hub.watch((view) => seen.push(view));
  const subscriber = subscribe(harness.hub);
  await settle();
  subscriber.controller.abort();
  gate.release();
  await subscriber.done;
  await settle();
  // The leave says null; the stale directory's first report follows it, and its close says null again.
  expect(seen).toEqual([null, first, null]);
  expect(harness.directory.stops).toBe(1);
  // The closed directory's view is gone: a reset has nothing to replay.
  harness.hub.contextReset("a");
  await settle();
  expect(seen).toEqual([null, first, null]);
});

test("a watcher that throws is logged and does not stop the others", async () => {
  const logs: string[] = [];
  const first: DirectoryView = { agents: [agent("a", "idle")], workspaces: [] };
  const harness = startHarness(first, { log: (message) => logs.push(message) });
  const seen: (DirectoryView | null)[] = [];
  harness.hub.watch(() => {
    throw new Error("chat is down");
  });
  harness.hub.watch((view) => seen.push(view));
  const subscriber = subscribe(harness.hub);
  await settle();
  expect(seen).toEqual([first]);
  expect(logs).toEqual(["[office] chat watcher failed: chat is down"]);
  subscriber.controller.abort();
  await subscriber.done;
});

test("with no office open, a read opens the directory for itself and closes it", async () => {
  const harness = startHarness({ agents: [agent("a", "idle")], workspaces: [] });
  harness.hub.setBoard("lobby", [note("p1")]);
  expect(await harness.hub.read()).toEqual({
    agents: [agent("a", "idle")],
    workspaces: [],
    activity: {},
    doing: {},
    checklists: {},
    boards: { lobby: [note("p1")] },
    wake: EMPTY_WAKE,
  });
  expect(harness.directory.opens).toBe(1);
  expect(harness.directory.stops).toBe(1);
  // The hub stays idle: the next subscriber opens its own directory.
  const subscriber = subscribe(harness.hub);
  await settle();
  expect(harness.directory.opens).toBe(2);
  subscriber.controller.abort();
  await subscriber.done;
});

test("with no office open, a read names a numbered sub-agent after its parent", async () => {
  const parent = { ...agent("p", "idle"), title: "Mjd" };
  const numbered = { ...agent("c1", "running"), parentAgentId: "p", number: 1 };
  const harness = startHarness({ agents: [parent, numbered], workspaces: [] });
  const { agents } = await harness.hub.read();
  expect(agents.find((one) => one.id === "c1")?.name).toBe("Mjd-1");
});

test("with an office open, a read is what its subscribers see, and opens nothing more", async () => {
  const harness = startHarness({ agents: [agent("a", "running")], workspaces: [] });
  const subscriber = subscribe(harness.hub);
  await settle();
  harness.activity.emit({ a: "Thinking" });
  expect(await harness.hub.read()).toMatchObject({
    agents: [agent("a", "running")],
    activity: { a: "Thinking" },
  });
  expect(harness.directory.opens).toBe(1);
  subscriber.controller.abort();
  await subscriber.done;
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
    state: {
      agents,
      workspaces: [],
      activity: {},
      doing: {},
      checklists: {},
      boards: {},
      wake: EMPTY_WAKE,
    },
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
        doing: {},
        checklists: {},
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

test("a reset agent's context reads empty at once, and the provider's next number replaces it", async () => {
  const full = { ...agent("a", "idle"), context: { usedTokens: 164_000, maxTokens: 200_000 } };
  const harness = startHarness({ agents: [full, agent("b", "idle")], workspaces: [] });
  const subscriber = subscribe(harness.hub);
  await settle();
  subscriber.events.length = 0;

  harness.hub.contextReset("a");
  // An agent whose context nobody reports has nothing to empty.
  harness.hub.contextReset("b");
  harness.hub.contextReset("ghost");
  harness.clock.advance(DIRECTORY_FLUSH_MS);
  const emptied = { ...full, context: { usedTokens: 0, maxTokens: 200_000 } };
  expect(subscriber.events).toEqual([{ type: "agents", agents: [emptied, agent("b", "idle")] }]);

  // The directory repeats the number from before the reset: still empty, and nothing is sent.
  harness.directory.emit({
    agents: [{ ...full, status: "idle" }, agent("b", "idle")],
    workspaces: [],
  });
  harness.clock.advance(DIRECTORY_FLUSH_MS);
  expect(subscriber.events).toHaveLength(1);

  const next = { ...full, context: { usedTokens: 2100, maxTokens: 200_000 } };
  harness.directory.emit({ agents: [next, agent("b", "idle")], workspaces: [] });
  harness.clock.advance(DIRECTORY_FLUSH_MS);
  expect(subscriber.events[1]).toEqual({ type: "agents", agents: [next, agent("b", "idle")] });

  // The reset is over: the same number as before it is a full context again.
  harness.directory.emit({ agents: [full, agent("b", "idle")], workspaces: [] });
  harness.clock.advance(DIRECTORY_FLUSH_MS);
  expect(subscriber.events[2]).toEqual({ type: "agents", agents: [full, agent("b", "idle")] });

  subscriber.controller.abort();
  await subscriber.done;
});

test("a subscriber that joins after a reset gets the emptied context in its snapshot", async () => {
  const full = { ...agent("a", "idle"), context: { usedTokens: 164_000, maxTokens: 200_000 } };
  const harness = startHarness({ agents: [full], workspaces: [] });
  const first = subscribe(harness.hub);
  await settle();
  harness.hub.contextReset("a");

  const second = subscribe(harness.hub);
  await settle();
  expect(second.events[0]).toMatchObject({
    type: "snapshot",
    state: { agents: [{ id: "a", context: { usedTokens: 0, maxTokens: 200_000 } }] },
  });
  first.controller.abort();
  second.controller.abort();
  await Promise.all([first.done, second.done]);
});

test("the hub knows a workspace's script while a directory is open", async () => {
  const dev = {
    name: "dev",
    kind: "service" as const,
    running: true,
    health: null,
    exitCode: null,
    port: 5173,
    terminalId: "t1",
  };
  const harness = startHarness({
    agents: [],
    workspaces: [{ id: "w1", name: "main", projectName: "shop", scripts: [dev] }],
  });
  expect(harness.hub.script("w1", "dev")).toBeNull();
  expect(harness.hub.workspaceIds()).toEqual([]);
  const subscriber = subscribe(harness.hub);
  await settle();
  expect(harness.hub.script("w1", "dev")).toEqual(dev);
  expect(harness.hub.workspaceIds()).toEqual(["w1"]);
  expect(harness.hub.script("w1", "test")).toBeNull();
  expect(harness.hub.script("w2", "dev")).toBeNull();

  // A script that restarted in another terminal is known at once, before the flush.
  harness.directory.emit({
    agents: [],
    workspaces: [
      { id: "w1", name: "main", projectName: "shop", scripts: [{ ...dev, terminalId: "t2" }] },
    ],
  });
  expect(harness.hub.script("w1", "dev")?.terminalId).toBe("t2");

  subscriber.controller.abort();
  await subscriber.done;
  expect(harness.hub.script("w1", "dev")).toBeNull();
  expect(harness.hub.workspaceIds()).toEqual([]);
});

test("sub-agents are named after their parent, and a new number is written once", async () => {
  const writes: { agentId: string; patch: Record<string, number> }[] = [];
  const parent = { ...agent("p", "idle"), title: "Mjd" };
  const numbered = { ...agent("c1", "running"), parentAgentId: "p", number: 1 };
  const fresh = {
    ...agent("c2", "running"),
    parentAgentId: "p",
    createdAt: "2026-11-11T08:01:00.000Z",
  };
  const harness = startHarness(
    { agents: [parent, numbered, fresh], workspaces: [] },
    {
      setAgentMetadata: async (agentId, patch) => {
        writes.push({ agentId, patch });
      },
    },
  );
  const subscriber = subscribe(harness.hub);
  await settle();
  const first = subscriber.events[0];
  const agents = first?.type === "snapshot" ? first.state.agents : [];
  expect(agents.find((one) => one.id === "c1")?.name).toBe("Mjd-1");
  expect(agents.find((one) => one.id === "c2")?.name).toBeUndefined();
  // The parent's next is stored first, so a failure leaves a gap, never a reused number.
  expect(writes).toEqual([
    { agentId: "p", patch: { "office.subagent.next": 3 } },
    { agentId: "c2", patch: { "office.subagent.number": 2 } },
  ]);

  harness.directory.emit({ agents: [parent, numbered, fresh], workspaces: [] });
  await settle();
  expect(writes).toHaveLength(2);

  harness.directory.emit({
    agents: [{ ...parent, next: 3 }, numbered, { ...fresh, number: 2 }],
    workspaces: [],
  });
  harness.clock.advance(DIRECTORY_FLUSH_MS);
  await settle();
  const update = subscriber.events.findLast((event) => event.type === "agents");
  expect(
    update?.type === "agents" ? update.agents.find((one) => one.id === "c2")?.name : null,
  ).toBe("Mjd-2");
  expect(writes).toHaveLength(2);
  subscriber.controller.abort();
  await subscriber.done;
});

test("numbers that come back out of order are not handed out again", async () => {
  const writes: { agentId: string; patch: Record<string, number> }[] = [];
  const parent = { ...agent("p", "idle"), title: "Mjd" };
  const c1 = { ...agent("c1", "running"), parentAgentId: "p" };
  const c2 = {
    ...agent("c2", "running"),
    parentAgentId: "p",
    createdAt: "2026-11-11T08:01:00.000Z",
  };
  const harness = startHarness(
    { agents: [parent, c1, c2], workspaces: [] },
    {
      setAgentMetadata: async (agentId, patch) => {
        writes.push({ agentId, patch });
      },
    },
  );
  const subscriber = subscribe(harness.hub);
  await settle();
  expect(writes).toHaveLength(3);
  // c2's number and the parent's next come back; c1's has not yet.
  harness.directory.emit({
    agents: [{ ...parent, next: 3 }, c1, { ...c2, number: 2 }],
    workspaces: [],
  });
  await settle();
  expect(writes).toHaveLength(3);
  harness.directory.emit({
    agents: [
      { ...parent, next: 3 },
      { ...c1, number: 1 },
      { ...c2, number: 2 },
    ],
    workspaces: [],
  });
  await settle();
  expect(writes).toEqual([
    { agentId: "p", patch: { "office.subagent.next": 3 } },
    { agentId: "c1", patch: { "office.subagent.number": 1 } },
    { agentId: "c2", patch: { "office.subagent.number": 2 } },
  ]);
  subscriber.controller.abort();
  await subscriber.done;
});

test("a parent whose next cannot be stored gets no new sub-agent number, and both are tried again", async () => {
  let fail = true;
  const writes: string[] = [];
  const parent = { ...agent("p", "idle"), title: "Mjd" };
  const fresh = { ...agent("c", "running"), parentAgentId: "p" };
  const harness = startHarness(
    { agents: [parent, fresh], workspaces: [] },
    {
      setAgentMetadata: async (agentId) => {
        writes.push(agentId);
        if (fail) throw new Error("daemon away");
      },
    },
  );
  const subscriber = subscribe(harness.hub);
  await settle();
  expect(writes).toEqual(["p"]);
  fail = false;
  harness.directory.emit({ agents: [parent, fresh], workspaces: [] });
  await settle();
  expect(writes).toEqual(["p", "p", "c"]);
  subscriber.controller.abort();
  await subscriber.done;
});
