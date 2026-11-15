// The feed as a value: the host changes it by these events and sends them on, and a client
// applies the same events to its copy.
import { MAX_ENTRIES, type FeedEntry, type FeedEvent, type FeedState } from "./contracts.js";

export const EMPTY_FEED: FeedState = { entries: [], seenAt: null };

/** The feed with other entries. A mark on an entry that is gone goes with it. */
function withEntries(state: FeedState, entries: FeedEntry[]): FeedState {
  return withUnread(
    { ...state, entries },
    (state.unread ?? []).filter((id) => entries.some((entry) => entry.id === id)),
  );
}

function withUnread(state: FeedState, unread: string[]): FeedState {
  const { unread: _before, ...rest } = state;
  return unread.length === 0 ? rest : { ...rest, unread };
}

/** The feed after an event. The same object when the event changes nothing. */
export function applyFeedEvent(state: FeedState, event: FeedEvent): FeedState {
  if (event.type === "state") return event.state;
  if (event.type === "added") {
    return withEntries(state, [event.entry, ...state.entries].slice(0, MAX_ENTRIES));
  }
  if (event.type === "removed") {
    const entries = state.entries.filter((entry) => !event.ids.includes(entry.id));
    return entries.length === state.entries.length ? state : withEntries(state, entries);
  }
  if (event.type === "marked") {
    const marked = state.unread ?? [];
    const held = state.entries.some((entry) => entry.id === event.id);
    if (!held || marked.includes(event.id) === event.unread) return state;
    return withUnread(
      state,
      event.unread ? [...marked, event.id] : marked.filter((id) => id !== event.id),
    );
  }
  if (event.type === "started") {
    const others = (state.running ?? []).filter((agent) => agent.agentId !== event.agent.agentId);
    // A turn without a start began before every turn the feed saw begin.
    const running =
      event.agent.since === null ? [...others, event.agent] : [event.agent, ...others];
    return { ...state, running };
  }
  if (event.type === "stopped") {
    const running = state.running ?? [];
    const others = running.filter((agent) => agent.agentId !== event.agentId);
    if (others.length === running.length) return state;
    const { running: _before, ...rest } = state;
    return others.length === 0 ? rest : { ...rest, running: others };
  }
  return event.seenAt === state.seenAt ? state : { ...state, seenAt: event.seenAt };
}

/** Whether an entry came after the feed was last opened at `seenAt`. */
export function isNew(at: string, seenAt: string | null): boolean {
  // Both are ISO times in UTC, which sort as text.
  return seenAt === null || at > seenAt;
}

/** Whether an entry is marked unread. */
export function isMarked(state: FeedState, id: string): boolean {
  return state.unread?.includes(id) ?? false;
}

/** How many entries are unread: they came after the feed was last opened, or are marked. */
export function newCount(state: FeedState): number {
  return state.entries.filter((entry) => isNew(entry.at, state.seenAt) || isMarked(state, entry.id))
    .length;
}
