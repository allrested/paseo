// The feed as a value: the host changes it by these events and sends them on, and a client
// applies the same events to its copy.
import { MAX_ENTRIES, type FeedEvent, type FeedState } from "./contracts.js";

export const EMPTY_FEED: FeedState = { entries: [], seenAt: null };

/** The feed after an event. The same object when the event changes nothing. */
export function applyFeedEvent(state: FeedState, event: FeedEvent): FeedState {
  if (event.type === "state") return event.state;
  if (event.type === "added") {
    return { ...state, entries: [event.entry, ...state.entries].slice(0, MAX_ENTRIES) };
  }
  if (event.type === "removed") {
    const entries = state.entries.filter((entry) => !event.ids.includes(entry.id));
    return entries.length === state.entries.length ? state : { ...state, entries };
  }
  return event.seenAt === state.seenAt ? state : { ...state, seenAt: event.seenAt };
}

/** Whether an entry came after the feed was last opened at `seenAt`. */
export function isNew(at: string, seenAt: string | null): boolean {
  // Both are ISO times in UTC, which sort as text.
  return seenAt === null || at > seenAt;
}

/** How many entries came after the feed was last opened. */
export function newCount(state: FeedState): number {
  return state.entries.filter((entry) => isNew(entry.at, state.seenAt)).length;
}
