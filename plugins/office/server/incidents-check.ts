import {
  INCIDENT_SOURCES,
  type Incident,
  type IncidentSource,
  type IncidentsState,
} from "../shared/contracts.js";
import { errorMessage } from "./errors.js";
import { type FoundIssue, TrackerProblem, type TrackerReader } from "./incidents-http.js";
import type { IncidentsData, IncidentsStore } from "./incidents-store.js";

/** A read starts this long before the last check: Jira compares `created` to the minute. */
export const WINDOW_MARGIN_MS = 600_000;
/** A seen key is kept this long, so an issue never opens twice. */
export const SEEN_FOR_MS = 172_800_000;
/** An incident not dismissed closes this long after it was found. */
export const OPEN_FOR_MS = 86_400_000;
/** The most incidents one check opens per tracker, the oldest first; the rest wait their turn. */
export const MAX_NEW_PER_CHECK = 20;
const TITLE_MAX = 200;

const TRACKER_NAMES: Record<IncidentSource, string> = { jira: "Jira", sentry: "Sentry" };

/** The check's part of the incidents state; the office adds the rest beside it. */
export type IncidentsCheckState = Pick<IncidentsState, "open" | "problems">;

export interface IncidentsPorts {
  /** The trackers that are on now. */
  readers(): Promise<Partial<Record<IncidentSource, TrackerReader>>>;
  store: IncidentsStore;
  now(): number;
  log(message: string): void;
  changed(state: IncidentsCheckState): void;
}

export interface IncidentsCheck {
  /** Loads the store and pushes the state. */
  start(): Promise<void>;
  /** One run over the trackers that are on. Never rejects. */
  check(): Promise<void>;
  /** Closes the open incidents with these ids, or all of them. Resolves with how many closed. */
  dismiss(ids?: string[]): Promise<number>;
}

/** An error's kind, never its message: it may hold an address or a header. */
function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

// Closed incidents leave the file; their keys stay seen for longer, so they never open again.
function closeByAge(data: IncidentsData, now: number): void {
  data.open = data.open.filter((open) => now - open.foundAt < OPEN_FOR_MS);
  for (const mark of Object.values(data.trackers)) {
    const kept = Object.entries(mark.seen).filter(([, seenAt]) => now - seenAt < SEEN_FOR_MS);
    mark.seen = Object.fromEntries(kept);
  }
}

interface TrackerCheck {
  data: IncidentsData;
  source: IncidentSource;
  reader: TrackerReader;
  now: number;
}

function incident(source: IncidentSource, issue: FoundIssue, now: number): Incident {
  return {
    id: `${source}:${issue.key}`,
    source,
    key: issue.key,
    title: issue.title.slice(0, TITLE_MAX),
    url: issue.url,
    createdAt: issue.createdAt,
    foundAt: now,
  };
}

export function createIncidentsCheck(ports: IncidentsPorts): IncidentsCheck {
  // In memory only: after a restart, the next check finds a problem that is still there.
  const problems: IncidentsCheckState["problems"] = {};

  function push(data: IncidentsData): void {
    ports.changed({ open: data.open, problems: { ...problems } });
  }

  // Logged when it changes, so a tracker down all night logs once.
  function failed(source: IncidentSource, error: unknown): void {
    const known = error instanceof TrackerProblem;
    const problem = known ? error.message : `${TRACKER_NAMES[source]} check failed`;
    const logged = known ? problem : `${problem} (${errorKind(error)})`;
    if (problems[source] !== problem) ports.log(`[office] incidents: ${logged}`);
    problems[source] = problem;
  }

  async function checkTracker({ data, source, reader, now }: TrackerCheck): Promise<void> {
    const mark = data.trackers[source];
    let found: FoundIssue[];
    try {
      found = await reader.read((mark?.checkedAt ?? now) - WINDOW_MARGIN_MS);
    } catch (error) {
      failed(source, error);
      return;
    }
    delete problems[source];
    // The first check: what exists now is the backlog, not news.
    if (mark === undefined) {
      const seen: Record<string, number> = {};
      for (const issue of found) seen[issue.key] = now;
      data.trackers[source] = { checkedAt: now, seen };
      return;
    }
    const fresh = found.filter((issue) => !Object.hasOwn(mark.seen, issue.key));
    const taken = fresh.slice(0, MAX_NEW_PER_CHECK);
    for (const issue of taken) {
      mark.seen[issue.key] = now;
      data.open.push(incident(source, issue, now));
    }
    // With some left over, the next read starts at the last one opened and finds the rest.
    const leftOver = fresh.length > taken.length;
    mark.checkedAt = leftOver ? taken[taken.length - 1].createdAt : now;
  }

  async function checkTrackers(data: IncidentsData, now: number): Promise<void> {
    let readers: Partial<Record<IncidentSource, TrackerReader>>;
    try {
      readers = await ports.readers();
    } catch (error) {
      ports.log(`[office] incidents: unable to tell which trackers are on (${errorKind(error)})`);
      return;
    }
    for (const source of INCIDENT_SOURCES) {
      const reader = readers[source];
      if (reader !== undefined) {
        await checkTracker({ data, source, reader, now });
      } else {
        // Turned off: nothing will clear its problem, and it is not failing.
        delete problems[source];
      }
    }
  }

  // The store is read on each run and dismiss, so a file deleted while the daemon runs makes the
  // next run a first check.
  async function run(): Promise<void> {
    const now = ports.now();
    const data = await ports.store.load();
    await checkTrackers(data, now);
    closeByAge(data, now);
    try {
      await ports.store.save(data);
    } catch (error) {
      ports.log(`[office] unable to save the incidents: ${errorMessage(error)}`);
    }
    push(data);
  }

  async function start(): Promise<void> {
    push(await ports.store.load());
  }

  async function dismiss(ids?: string[]): Promise<number> {
    const data = await ports.store.load();
    const closing = new Set(ids ?? data.open.map((open) => open.id));
    const kept = data.open.filter((open) => !closing.has(open.id));
    const closed = data.open.length - kept.length;
    data.open = kept;
    await ports.store.save(data);
    push(data);
    return closed;
  }

  // Runs and dismisses one at a time, each reading what the one before saved.
  let chain: Promise<void> = Promise.resolve();
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const queued = chain.then(task);
    chain = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  return {
    start: () => enqueue(start),
    check: () => enqueue(run),
    dismiss: (ids) => enqueue(() => dismiss(ids)),
  };
}
