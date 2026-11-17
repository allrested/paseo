import { expect, test } from "vitest";
import type { Incident, IncidentSource } from "../shared/contracts.js";
import { createFakeClock, type FakeClock, settle } from "./fake-clock.js";
import {
  createIncidentsCheck,
  type IncidentsCheck,
  type IncidentsCheckState,
  MAX_NEW_PER_CHECK,
  OPEN_FOR_MS,
  SEEN_FOR_MS,
  WINDOW_MARGIN_MS,
} from "./incidents-check.js";
import { type FoundIssue, TrackerProblem, type TrackerReader } from "./incidents-http.js";
import { EMPTY_INCIDENTS, type IncidentsData, type IncidentsStore } from "./incidents-store.js";

/** 08:00 on Tuesday 17 November 2026 in Riyadh. */
const NOW = Date.parse("2026-11-17T05:00:00.000Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const REFUSED = "Jira refused the token: check ATLASSIAN_API_TOKEN";

interface FakeReader extends TrackerReader {
  /** Every issue in the tracker; a read returns those made since the time asked, oldest first. */
  issues: FoundIssue[];
  /** Thrown by every read while set. */
  failure: Error | null;
  /** The `since` of every read, in order. */
  reads: number[];
  /** A read waits for this before it answers, while set. */
  hold: Promise<void> | null;
}

function fakeReader(events: string[]): FakeReader {
  const reader: FakeReader = {
    issues: [],
    failure: null,
    reads: [],
    hold: null,
    async read(since) {
      reader.reads.push(since);
      events.push("read");
      if (reader.hold !== null) await reader.hold;
      if (reader.failure !== null) throw reader.failure;
      const found = reader.issues.filter((issue) => issue.createdAt >= since);
      return found.sort((a, b) => a.createdAt - b.createdAt);
    },
  };
  return reader;
}

interface MemoryStore extends IncidentsStore {
  /** What is on disk; copied on each load and save, as the file is. */
  kept: IncidentsData;
  /** Thrown by every save while set. */
  failure: Error | null;
  /** Thrown by every load while set. */
  loadFailure: Error | null;
}

function memoryStore(events: string[]): MemoryStore {
  const store: MemoryStore = {
    kept: structuredClone(EMPTY_INCIDENTS),
    failure: null,
    loadFailure: null,
    async load() {
      events.push("load");
      if (store.loadFailure !== null) throw store.loadFailure;
      return structuredClone(store.kept);
    },
    async save(data) {
      events.push("save");
      if (store.failure !== null) throw store.failure;
      store.kept = structuredClone(data);
    },
  };
  return store;
}

interface Harness {
  check: IncidentsCheck;
  clock: FakeClock;
  store: MemoryStore;
  jira: FakeReader;
  sentry: FakeReader;
  /** The trackers that are on; `readers()` hands out these. */
  on: Set<IncidentSource>;
  /** Thrown by `readers()` while set, as a settings read that fails. */
  readersFailure: Error | null;
  changes: IncidentsCheckState[];
  logs: string[];
  /** load, read and save, in the order they happen. */
  events: string[];
}

function harness(): Harness {
  const events: string[] = [];
  const clock = createFakeClock(NOW);
  const store = memoryStore(events);
  const h: Harness = {
    clock,
    store,
    jira: fakeReader(events),
    sentry: fakeReader(events),
    on: new Set(["jira"]),
    readersFailure: null,
    changes: [],
    logs: [],
    events,
    check: createIncidentsCheck({
      async readers() {
        if (h.readersFailure !== null) throw h.readersFailure;
        const readers: Partial<Record<IncidentSource, TrackerReader>> = {};
        if (h.on.has("jira")) readers.jira = h.jira;
        if (h.on.has("sentry")) readers.sentry = h.sentry;
        return readers;
      },
      store,
      now: clock.now,
      log: (message) => h.logs.push(message),
      changed: (state) => h.changes.push(state),
    }),
  };
  return h;
}

function bug(key: string, createdAt: number, title = `Bug ${key}`): FoundIssue {
  return { key, title, url: `https://example.atlassian.net/browse/${key}`, createdAt };
}

function opened(source: IncidentSource, issue: FoundIssue, foundAt: number): Incident {
  return {
    id: `${source}:${issue.key}`,
    source,
    key: issue.key,
    title: issue.title,
    url: issue.url,
    createdAt: issue.createdAt,
    foundAt,
  };
}

/** A read of incidents.json that failed, as `readFile` rejects: its message holds the path. */
function fileError(code: string): Error {
  return Object.assign(new Error(`${code}: failed, open '/home/me/.paseo/office/incidents.json'`), {
    code,
  });
}

/** Holds the reader's reads until the returned function is called. */
function holdReads(reader: FakeReader): () => void {
  let release = () => {};
  reader.hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    reader.hold = null;
    release();
  };
}

/** A first check at NOW that saw FPOS-1, then five minutes on. */
async function checkedOnce(): Promise<Harness> {
  const h = harness();
  h.jira.issues.push(bug("FPOS-1", NOW - MINUTE));
  await h.check.check();
  h.clock.advance(5 * MINUTE);
  return h;
}

test("the first check opens nothing and remembers the keys", async () => {
  const h = harness();
  h.jira.issues.push(bug("FPOS-1", NOW - 5 * MINUTE), bug("FPOS-2", NOW - 60 * MINUTE));

  await h.check.check();

  expect(h.jira.reads).toEqual([NOW - WINDOW_MARGIN_MS]);
  expect(h.store.kept).toEqual({
    version: 1,
    trackers: { jira: { checkedAt: NOW, seen: { "FPOS-1": NOW } } },
    open: [],
  });
  expect(h.changes).toEqual([{ open: [], problems: {} }]);
  expect(h.logs).toEqual([]);
});

test("a new key opens one incident with id jira:FPOS-3 and the title cut at 200", async () => {
  const h = await checkedOnce();
  const issue = bug("FPOS-3", NOW + 2 * MINUTE, "x".repeat(250));
  h.jira.issues.push(issue);

  await h.check.check();

  const incident = { ...opened("jira", issue, NOW + 5 * MINUTE), title: "x".repeat(200) };
  expect(h.jira.reads).toEqual([NOW - WINDOW_MARGIN_MS, NOW - WINDOW_MARGIN_MS]);
  expect(h.store.kept).toEqual({
    version: 1,
    trackers: {
      jira: { checkedAt: NOW + 5 * MINUTE, seen: { "FPOS-1": NOW, "FPOS-3": NOW + 5 * MINUTE } },
    },
    open: [incident],
  });
  expect(h.store.kept.open[0].id).toBe("jira:FPOS-3");
  expect(h.changes.at(-1)).toEqual({ open: [incident], problems: {} });
});

test("start loads the store and pushes the state, reading no tracker", async () => {
  const h = harness();
  const incident = opened("jira", bug("FPOS-3", NOW - MINUTE), NOW);
  h.store.kept = {
    version: 1,
    trackers: { jira: { checkedAt: NOW, seen: { "FPOS-3": NOW } } },
    open: [incident],
  };

  await h.check.start();

  expect(h.changes).toEqual([{ open: [incident], problems: {} }]);
  expect(h.events).toEqual(["load"]);
});

test("start closes what is a day old before it pushes, and saves nothing", async () => {
  const h = harness();
  const old = opened("jira", bug("FPOS-2", NOW - 2 * DAY), NOW - OPEN_FOR_MS);
  const recent = opened("jira", bug("FPOS-3", NOW - 2 * MINUTE), NOW - MINUTE);
  h.store.kept = {
    version: 1,
    trackers: { jira: { checkedAt: NOW - MINUTE, seen: { "FPOS-2": NOW - OPEN_FOR_MS } } },
    open: [old, recent],
  };

  await h.check.start();

  expect(h.changes).toEqual([{ open: [recent], problems: {} }]);
  expect(h.events).toEqual(["load"]);
});

test("a key seen before never opens again, even after it was dismissed", async () => {
  const h = await checkedOnce();
  h.jira.issues.push(bug("FPOS-3", NOW + 2 * MINUTE));
  await h.check.check();
  expect(await h.check.dismiss(["jira:FPOS-3"])).toBe(1);
  h.clock.advance(MINUTE);

  await h.check.check();

  // Still in the window, read again, and not opened.
  expect(h.jira.reads.at(-1)).toBe(NOW + 5 * MINUTE - WINDOW_MARGIN_MS);
  expect(h.store.kept.open).toEqual([]);
  expect(h.store.kept.trackers.jira?.seen).toEqual({
    "FPOS-1": NOW,
    "FPOS-3": NOW + 5 * MINUTE,
  });
  expect(h.changes.at(-1)).toEqual({ open: [], problems: {} });
});

test("an issue just inside the margin is read; one already seen is skipped", async () => {
  const h = await checkedOnce();
  // Indexed late: made before the first check, found by the tracker only now.
  const late = bug("FPOS-4", NOW - WINDOW_MARGIN_MS);
  h.jira.issues.push(late);

  await h.check.check();

  expect(h.jira.reads).toEqual([NOW - WINDOW_MARGIN_MS, NOW - WINDOW_MARGIN_MS]);
  // FPOS-1, seen by the first check, is read again and skipped.
  expect(h.store.kept.open).toEqual([opened("jira", late, NOW + 5 * MINUTE)]);
});

test("50 new issues: 20 now, 20 next, 10 after, none twice", async () => {
  const h = await checkedOnce();
  const burst = Array.from({ length: 50 }, (_, index) =>
    bug(`FPOS-${100 + index}`, NOW + MINUTE + index * 1000),
  );
  h.jira.issues.push(...burst);
  const openedKeys = () => h.store.kept.open.map((incident) => incident.key);
  const keys = burst.map((issue) => issue.key);

  await h.check.check();
  expect(MAX_NEW_PER_CHECK).toBe(20);
  expect(openedKeys()).toEqual(keys.slice(0, 20));
  // Left over: the next read starts from the last one opened.
  expect(h.store.kept.trackers.jira?.checkedAt).toBe(burst[19].createdAt);

  h.clock.advance(5 * MINUTE);
  await h.check.check();
  expect(openedKeys()).toEqual(keys.slice(0, 40));
  expect(h.store.kept.trackers.jira?.checkedAt).toBe(burst[39].createdAt);

  h.clock.advance(5 * MINUTE);
  await h.check.check();
  expect(openedKeys()).toEqual(keys);
  // Nothing left over: the mark moves to the check's time.
  expect(h.store.kept.trackers.jira?.checkedAt).toBe(NOW + 15 * MINUTE);

  h.clock.advance(5 * MINUTE);
  await h.check.check();
  expect(openedKeys()).toEqual(keys);
  expect(h.jira.reads).toEqual([
    NOW - WINDOW_MARGIN_MS,
    NOW - WINDOW_MARGIN_MS,
    burst[19].createdAt - WINDOW_MARGIN_MS,
    burst[39].createdAt - WINDOW_MARGIN_MS,
    NOW + 15 * MINUTE - WINDOW_MARGIN_MS,
  ]);
});

test("dismiss with ids closes those; without ids closes all; returns the count", async () => {
  const h = await checkedOnce();
  const issues = [3, 4, 5].map((n) => bug(`FPOS-${n}`, NOW + n * 1000));
  h.jira.issues.push(...issues);
  await h.check.check();
  const [three, four, five] = issues.map((issue) => opened("jira", issue, NOW + 5 * MINUTE));
  expect(h.store.kept.open).toEqual([three, four, five]);

  expect(await h.check.dismiss(["jira:FPOS-3", "jira:FPOS-9"])).toBe(1);
  expect(h.store.kept.open).toEqual([four, five]);
  expect(h.changes.at(-1)).toEqual({ open: [four, five], problems: {} });

  expect(await h.check.dismiss()).toBe(2);
  expect(h.store.kept.open).toEqual([]);
  expect(h.changes.at(-1)).toEqual({ open: [], problems: {} });

  expect(await h.check.dismiss()).toBe(0);
  // Each dismiss reads the store first and writes it after.
  expect(h.events.slice(-6)).toEqual(["load", "save", "load", "save", "load", "save"]);
});

test("a failed read keeps checkedAt, sets the problem, logs it once over two runs", async () => {
  const h = await checkedOnce();
  h.jira.issues.push(bug("FPOS-3", NOW + 2 * MINUTE));
  h.jira.failure = new TrackerProblem(REFUSED);

  await h.check.check();
  h.clock.advance(5 * MINUTE);
  await h.check.check();

  const since = NOW - WINDOW_MARGIN_MS;
  expect(h.jira.reads).toEqual([since, since, since]);
  expect(h.store.kept.trackers.jira).toEqual({ checkedAt: NOW, seen: { "FPOS-1": NOW } });
  expect(h.store.kept.open).toEqual([]);
  expect(h.changes.at(-1)).toEqual({ open: [], problems: { jira: REFUSED } });
  expect(h.logs).toEqual([`[office] incidents: ${REFUSED}`]);
});

test("a later success clears the problem", async () => {
  const h = await checkedOnce();
  const issue = bug("FPOS-3", NOW + 2 * MINUTE);
  h.jira.issues.push(issue);
  h.jira.failure = new TrackerProblem(REFUSED);
  await h.check.check();
  h.jira.failure = null;
  h.clock.advance(5 * MINUTE);

  await h.check.check();

  const incident = opened("jira", issue, NOW + 10 * MINUTE);
  expect(h.changes.at(-1)).toEqual({ open: [incident], problems: {} });
  expect(h.store.kept.trackers.jira?.checkedAt).toBe(NOW + 10 * MINUTE);

  // Once cleared, the same refusal is a change again, so it is logged again.
  h.jira.failure = new TrackerProblem(REFUSED);
  await h.check.check();
  expect(h.logs).toEqual([`[office] incidents: ${REFUSED}`, `[office] incidents: ${REFUSED}`]);
});

test("any other error from a reader is a short problem, logged by its kind only", async () => {
  const h = await checkedOnce();
  h.jira.failure = new TypeError("fetch https://example.atlassian.net with Basic c2VjcmV0 failed");

  await h.check.check();

  expect(h.changes.at(-1)).toEqual({ open: [], problems: { jira: "Jira check failed" } });
  expect(h.logs).toEqual(["[office] incidents: Jira check failed (TypeError)"]);
  expect(h.store.kept.trackers.jira?.checkedAt).toBe(NOW);
});

test("a save that fails is logged, and the check still resolves and pushes", async () => {
  const h = await checkedOnce();
  const issue = bug("FPOS-3", NOW + 2 * MINUTE);
  h.jira.issues.push(issue);
  h.store.failure = new Error("EACCES: permission denied");

  await expect(h.check.check()).resolves.toBeUndefined();

  expect(h.logs).toEqual(["[office] unable to save the incidents: EACCES: permission denied"]);
  expect(h.changes.at(-1)).toEqual({
    open: [opened("jira", issue, NOW + 5 * MINUTE)],
    problems: {},
  });
});

test("a dismiss whose save fails rejects, pushes nothing and leaves the incidents", async () => {
  const h = await checkedOnce();
  const issue = bug("FPOS-3", NOW + 2 * MINUTE);
  h.jira.issues.push(issue);
  await h.check.check();
  const pushed = h.changes.length;
  h.store.failure = new Error("EACCES: permission denied");

  await expect(h.check.dismiss()).rejects.toThrow("EACCES: permission denied");

  expect(h.store.kept.open).toEqual([opened("jira", issue, NOW + 5 * MINUTE)]);
  expect(h.changes).toHaveLength(pushed);
  // The next one is not stuck behind it.
  h.store.failure = null;
  expect(await h.check.dismiss()).toBe(1);
});

test("an incident 24 h old is dropped; seen keys 2 days old are dropped", async () => {
  const h = await checkedOnce();
  const issue = bug("FPOS-3", NOW + 2 * MINUTE);
  h.jira.issues.push(issue);
  await h.check.check();
  const foundAt = NOW + 5 * MINUTE;

  h.clock.advance(OPEN_FOR_MS - 1);
  await h.check.check();
  expect(h.store.kept.open).toEqual([opened("jira", issue, foundAt)]);

  h.clock.advance(1);
  await h.check.check();
  expect(h.store.kept.open).toEqual([]);
  expect(h.changes.at(-1)).toEqual({ open: [], problems: {} });
  expect(h.store.kept.trackers.jira?.seen).toEqual({ "FPOS-1": NOW, "FPOS-3": foundAt });

  // Two days after NOW: FPOS-1 goes, FPOS-3 has five minutes left.
  h.clock.advance(SEEN_FOR_MS - OPEN_FOR_MS - 5 * MINUTE);
  await h.check.check();
  expect(h.store.kept.trackers.jira?.seen).toEqual({ "FPOS-3": foundAt });
});

test("reads that fail for 3 days, then succeed, do not open the key seen in the margin", async () => {
  const h = await checkedOnce();
  h.jira.issues.push(bug("FPOS-3", NOW + 2 * MINUTE));
  await h.check.check();
  h.clock.advance(15 * MINUTE);
  // Made two minutes before the last good check: the next read still returns it.
  h.jira.issues.push(bug("FPOS-4", NOW + 18 * MINUTE));
  await h.check.check();
  const checkedAt = NOW + 20 * MINUTE;
  h.jira.failure = new TrackerProblem(REFUSED);
  h.clock.advance(5 * MINUTE);
  await h.check.check();
  h.clock.advance(3 * DAY);
  await h.check.check();

  // FPOS-1 and FPOS-3 were seen before the window and are two days old: they go.
  expect(h.store.kept.trackers.jira).toEqual({ checkedAt, seen: { "FPOS-4": checkedAt } });

  h.jira.failure = null;
  h.clock.advance(5 * MINUTE);
  await h.check.check();

  expect(h.jira.reads.at(-1)).toBe(checkedAt - WINDOW_MARGIN_MS);
  expect(h.store.kept.open).toEqual([]);
  expect(h.changes.at(-1)).toEqual({ open: [], problems: {} });
});

test("a tracker turned off forgets its mark; its incidents stay until they close", async () => {
  const h = await checkedOnce();
  h.on.add("sentry");
  const issue = bug("FPOS-3", NOW + 2 * MINUTE);
  h.jira.issues.push(issue);
  await h.check.check();
  h.jira.failure = new TrackerProblem(REFUSED);
  h.clock.advance(5 * MINUTE);
  await h.check.check();
  const reads = h.jira.reads.length;

  h.on.delete("jira");
  h.clock.advance(5 * MINUTE);
  await h.check.check();

  const incident = opened("jira", issue, NOW + 5 * MINUTE);
  expect(h.jira.reads).toHaveLength(reads);
  expect(h.sentry.reads).toHaveLength(3);
  expect(h.store.kept.trackers.jira).toBeUndefined();
  expect(h.store.kept.open).toEqual([incident]);
  // A tracker that is off is not failing.
  expect(h.changes.at(-1)).toEqual({ open: [incident], problems: {} });

  h.clock.advance(OPEN_FOR_MS);
  await h.check.check();
  expect(h.store.kept.open).toEqual([]);
});

test("turned on again, the next check opens nothing and marks what it finds as seen", async () => {
  const h = await checkedOnce();
  h.on.delete("jira");
  await h.check.check();
  // A week off, with bugs coming in.
  h.clock.advance(7 * DAY);
  h.jira.issues.push(bug("FPOS-3", NOW + DAY), bug("FPOS-4", NOW + 7 * DAY - MINUTE));
  h.on.add("jira");

  await h.check.check();

  const now = NOW + 7 * DAY + 5 * MINUTE;
  expect(h.jira.reads.at(-1)).toBe(now - WINDOW_MARGIN_MS);
  expect(h.store.kept.open).toEqual([]);
  expect(h.store.kept.trackers.jira).toEqual({ checkedAt: now, seen: { "FPOS-4": now } });
  expect(h.changes.at(-1)).toEqual({ open: [], problems: {} });
});

test("trackers that cannot be listed are left as they were; incidents still close", async () => {
  const h = await checkedOnce();
  h.jira.issues.push(bug("FPOS-3", NOW + 2 * MINUTE));
  await h.check.check();
  h.jira.failure = new TrackerProblem(REFUSED);
  h.clock.advance(5 * MINUTE);
  await h.check.check();
  const mark = h.store.kept.trackers.jira;
  h.jira.failure = null;
  h.readersFailure = new Error("unable to read /home/me/.paseo/settings.json");
  h.clock.advance(OPEN_FOR_MS);

  await h.check.check();

  expect(h.jira.reads).toHaveLength(3);
  expect(h.store.kept).toEqual({ version: 1, trackers: { jira: mark }, open: [] });
  expect(h.changes.at(-1)).toEqual({ open: [], problems: { jira: REFUSED } });
  expect(h.logs).toEqual([
    `[office] incidents: ${REFUSED}`,
    "[office] incidents: unable to tell which trackers are on (Error)",
  ]);
});

test("a store that loads empty mid-run makes the next run a first check", async () => {
  const h = await checkedOnce();
  h.jira.issues.push(bug("FPOS-3", NOW + 2 * MINUTE));
  await h.check.check();
  // incidents.json deleted or broken while the daemon runs.
  h.store.kept = structuredClone(EMPTY_INCIDENTS);
  h.jira.issues.push(bug("FPOS-4", NOW + 6 * MINUTE));
  h.clock.advance(5 * MINUTE);

  await h.check.check();

  const now = NOW + 10 * MINUTE;
  expect(h.jira.reads.at(-1)).toBe(now - WINDOW_MARGIN_MS);
  expect(h.store.kept).toEqual({
    version: 1,
    trackers: { jira: { checkedAt: now, seen: { "FPOS-3": now, "FPOS-4": now } } },
    open: [],
  });
  expect(h.changes.at(-1)).toEqual({ open: [], problems: {} });
});

test("a run whose store cannot be read logs its kind and reads, saves and pushes nothing", async () => {
  const h = await checkedOnce();
  h.jira.issues.push(bug("FPOS-3", NOW + 2 * MINUTE));
  const kept = structuredClone(h.store.kept);
  const pushed = h.changes.length;
  h.store.loadFailure = fileError("EMFILE");
  h.events.length = 0;

  await expect(h.check.check()).resolves.toBeUndefined();

  expect(h.events).toEqual(["load"]);
  expect(h.store.kept).toEqual(kept);
  expect(h.changes).toHaveLength(pushed);
  expect(h.logs).toEqual(["[office] unable to read the incidents (EMFILE)"]);

  // Readable again: the next run opens what came in meanwhile.
  h.store.loadFailure = null;
  h.clock.advance(5 * MINUTE);
  await h.check.check();
  expect(h.store.kept.open.map((open) => open.key)).toEqual(["FPOS-3"]);
});

test("with a store that cannot be read, start logs and pushes nothing, and a dismiss rejects", async () => {
  const h = harness();
  h.store.loadFailure = fileError("EACCES");

  await expect(h.check.start()).resolves.toBeUndefined();
  await expect(h.check.dismiss()).rejects.toHaveProperty("code", "EACCES");

  expect(h.events).toEqual(["load", "load"]);
  expect(h.changes).toEqual([]);
  expect(h.logs).toEqual(["[office] unable to read the incidents (EACCES)"]);
});

test("two checks at once run one after the other", async () => {
  const h = harness();
  const release = holdReads(h.jira);

  const first = h.check.check();
  const second = h.check.check();
  await settle();
  expect(h.events).toEqual(["load", "read"]);
  release();
  await Promise.all([first, second]);

  expect(h.events).toEqual(["load", "read", "save", "load", "read", "save"]);
});

test("a dismiss during a check waits for it, and closes what it opened", async () => {
  const h = await checkedOnce();
  h.jira.issues.push(bug("FPOS-3", NOW + 2 * MINUTE));
  const release = holdReads(h.jira);

  const checking = h.check.check();
  const dismissing = h.check.dismiss();
  await settle();
  release();
  await checking;

  expect(await dismissing).toBe(1);
  expect(h.store.kept.open).toEqual([]);
  expect(h.changes.at(-1)).toEqual({ open: [], problems: {} });
});
