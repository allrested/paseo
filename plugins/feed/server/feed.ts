// The feed the daemon keeps: loaded once, changed by the hooks, saved after each change, and
// sent to every device that has it open or shows its count.
import type { FeedEntry, FeedEvent, FeedState, RunningAgent } from "../shared/contracts.js";
import { EMPTY_FEED, applyFeedEvent } from "../shared/feed.js";
import { errorMessage } from "./errors.js";
import type { FeedStore } from "./feed-store.js";

export interface FeedSubscriber {
  push(event: FeedEvent): Promise<void>;
  signal: AbortSignal;
}

export interface Feed {
  /** Sends the feed, then each change. Resolves when the subscriber's signal aborts. */
  attach(subscriber: FeedSubscriber): Promise<void>;
  add(entry: FeedEntry): Promise<void>;
  /** A permission was answered: its entry goes. */
  answered(requestId: string): Promise<void>;
  /** An agent's turn began: it is listed as running until it is released. */
  started(agent: RunningAgent): Promise<void>;
  /**
   * An agent's turn ended, or the agent went: it runs no more and waits for no answer, so its
   * permissions go.
   */
  released(agentId: string): Promise<void>;
  /**
   * Lists the agents whose turn began before the feed listened, once `list` has found them. One
   * that is released meanwhile is not listed. Rejects when `list` does.
   */
  catchUp(list: () => Promise<RunningAgent[]>): Promise<void>;
  /** The feed is open on a device at `at`. */
  seen(at: string): Promise<{ seenAt: string }>;
  /** Marks an entry unread, or read again. */
  mark(id: string, unread: boolean): Promise<void>;
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export function createFeed(ports: { store: FeedStore; log(message: string): void }): Feed {
  let state: FeedState = EMPTY_FEED;
  const subscribers = new Set<FeedSubscriber>();
  // Never rejects: the store answers a file it cannot read with an empty feed.
  async function load(): Promise<void> {
    const stored = await ports.store.load();
    // A permission still in the file was asked of a process that is gone, or was answered while
    // nothing listened. Nothing tells which, and a row that says "waiting" must be true.
    const asked = stored.entries.filter((entry) => entry.kind === "permission");
    state = applyFeedEvent(stored, { type: "removed", ids: asked.map((entry) => entry.id) });
  }
  const loaded = load();
  /** The agents released while a catch-up reads the host's list; null when none reads. */
  let releasedMeanwhile: Set<string> | null = null;

  // A subscriber that left between the check and the push rejects it; nothing is owed to it.
  function send(subscriber: FeedSubscriber, event: FeedEvent): void {
    void subscriber.push(event).catch(() => undefined);
  }

  async function change(event: FeedEvent): Promise<void> {
    await loaded;
    const next = applyFeedEvent(state, event);
    if (next === state) return;
    state = next;
    for (const subscriber of subscribers) send(subscriber, event);
    // What runs is not in the file, so a turn that starts or ends leaves it as it is.
    if (event.type === "started" || event.type === "stopped") return;
    try {
      await ports.store.save(next);
    } catch (error) {
      // The feed in memory is still right, and the next change saves it whole.
      ports.log(`[feed] the feed could not be saved: ${errorMessage(error)}`);
    }
  }

  async function drop(match: (entry: FeedEntry) => boolean): Promise<void> {
    await loaded;
    const ids = state.entries
      .filter((entry) => entry.kind === "permission" && match(entry))
      .map((entry) => entry.id);
    if (ids.length > 0) await change({ type: "removed", ids });
  }

  return {
    async attach(subscriber) {
      await loaded;
      if (subscriber.signal.aborted) return;
      // Added and sent in one step: a change after this reaches it after the state.
      subscribers.add(subscriber);
      send(subscriber, { type: "state", state });
      await waitForAbort(subscriber.signal);
      subscribers.delete(subscriber);
    },
    add: (entry) => change({ type: "added", entry }),
    answered: (requestId) => drop((entry) => entry.requestId === requestId),
    started: (agent) => change({ type: "started", agent }),
    async released(agentId) {
      releasedMeanwhile?.add(agentId);
      await change({ type: "stopped", agentId });
      await drop((entry) => entry.agentId === agentId);
    },
    async catchUp(list) {
      const released = new Set<string>();
      releasedMeanwhile = released;
      try {
        const found = await list();
        await loaded;
        for (const agent of found) {
          const known = state.running?.some((each) => each.agentId === agent.agentId);
          if (!known && !released.has(agent.agentId)) await change({ type: "started", agent });
        }
      } finally {
        releasedMeanwhile = null;
      }
    },
    async seen(at) {
      await change({ type: "seen", seenAt: at });
      return { seenAt: at };
    },
    mark: (id, unread) => change({ type: "marked", id, unread }),
  };
}
