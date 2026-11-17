// The activity feed: what changed between two office states, in words, and the store that keeps
// the newest of it. Pure derivation plus a module-level store, so the office's surface and a
// panel that subscribes on its own route feed one feed. Nothing here reaches the server.
import type { AgentStatus, OfficeAgent, OfficeSnapshot } from "../shared/contracts.js";
import { agentTitle } from "../shared/model.js";
import type { ActivityStep } from "../shared/names.js";
import { eventText, type EventTextExtra, type FeedKind } from "./activity-feed-text.js";

export type { FeedKind } from "./activity-feed-text.js";

/** An agent's moment in the office, as the feed says it. */
export interface FeedEvent {
  /** `${agentId}:${what}`: the step's key, the permission's id, or the status and its moment. */
  id: string;
  /** The agent it happened to. A new sub-agent's start is its parent's event. */
  agentId: string;
  /** The office's name for the agent, kept after the agent has left. */
  title: string;
  /** Epoch ms of the read that saw it. */
  at: number;
  kind: FeedKind;
  /** Needs permission and stopped on an error: the events that stand alone in the feed. */
  alert: boolean;
  text: string;
}

export type FeedChip = "cmd" | "edit" | "read" | "web" | "agent";

const CHIPS: Readonly<Partial<Record<FeedKind, FeedChip>>> = {
  command: "cmd",
  test: "cmd",
  commit: "cmd",
  push: "cmd",
  deploy: "cmd",
  edit: "edit",
  write: "edit",
  read: "read",
  search: "read",
  skill: "read",
  web: "web",
  tool: "web",
  subagent: "agent",
  plan: "agent",
  "subagent-started": "agent",
};

/** The chip an event shows under; null for the status events, which show under All alone. */
export function chipOf(kind: FeedKind): FeedChip | null {
  return CHIPS[kind] ?? null;
}

function eventOf(
  agent: OfficeAgent,
  at: number,
  kind: FeedKind,
  what: string,
  extra: EventTextExtra = {},
): FeedEvent {
  return {
    id: `${agent.id}:${what}`,
    agentId: agent.id,
    title: agentTitle(agent),
    at,
    kind,
    alert: kind === "permission" || kind === "error",
    text: eventText(kind, extra),
  };
}

/** A status that changed, as the feed says it; null for a change it does not tell. */
function statusKind(before: AgentStatus, after: AgentStatus): FeedKind | null {
  if (before === after) return null;
  if (after === "running") return "started";
  if (after === "error") return "error";
  return after === "idle" && before === "running" ? "finished" : null;
}

function statusEvents(before: OfficeAgent, after: OfficeAgent, at: number): FeedEvent[] {
  const kind = statusKind(before.status, after.status);
  if (kind === null) return [];
  // The moment it changed: an idle agent says since when; any other is this read.
  return [eventOf(after, at, kind, `${after.status}@${after.idleSince ?? at}`)];
}

function permissionEvents(before: OfficeAgent, after: OfficeAgent, at: number): FeedEvent[] {
  const seen = new Set(before.permissions.map((permission) => permission.id));
  return after.permissions
    .filter((permission) => !seen.has(permission.id))
    .map((permission) =>
      eventOf(after, at, "permission", permission.id, { title: permission.title }),
    );
}

/**
 * A step's event: the agent moved to a step it was not at, or that step ended badly. The id is
 * the step's key, so a failure replaces the step's own event rather than adding one.
 */
function stepEvents(
  agent: OfficeAgent,
  before: ActivityStep | undefined,
  after: ActivityStep | undefined,
  at: number,
): FeedEvent[] {
  if (after === undefined) return [];
  const moved = before?.key !== after.key;
  const failed = after.result === "failed" && before?.result !== "failed";
  if (!moved && !failed) return [];
  return [eventOf(agent, at, after.kind, after.key, { failed })];
}

/** The event of a sub-agent that appeared under a parent, told as the parent's. */
function startedSubAgent(parent: OfficeAgent, child: OfficeAgent, at: number): FeedEvent {
  return {
    id: `${parent.id}:subagent:${child.id}`,
    agentId: parent.id,
    title: agentTitle(parent),
    at,
    kind: "subagent-started",
    alert: false,
    text: eventText("subagent-started", { title: agentTitle(child) }),
  };
}

function eventsFor(
  before: OfficeSnapshot,
  after: OfficeSnapshot,
  agent: OfficeAgent,
  at: number,
): FeedEvent[] {
  const was = before.agents.find((candidate) => candidate.id === agent.id);
  if (was === undefined) {
    // An agent the office had not shown: told by its status once it changes, never on arrival.
    // A sub-agent is the one exception: the parent started it, which is worth a line.
    const parentId = agent.parentAgentId;
    const parent =
      parentId === null
        ? undefined
        : after.agents.find((candidate) => candidate.id === parentId && candidate.id !== agent.id);
    return parent === undefined ? [] : [startedSubAgent(parent, agent, at)];
  }
  return [
    ...statusEvents(was, agent, at),
    ...permissionEvents(was, agent, at),
    ...stepEvents(agent, before.doing?.[agent.id], after.doing?.[agent.id], at),
  ];
}

/**
 * What changed between two states, in the office's order. The first state has nothing before it:
 * opening the office is no news.
 */
export function feedEvents(
  before: OfficeSnapshot | null,
  after: OfficeSnapshot,
  now: number,
): FeedEvent[] {
  if (before === null) return [];
  return after.agents.flatMap((agent) => eventsFor(before, after, agent, now));
}

/** One card of the feed: an agent's consecutive events, or an alert on its own. */
export interface FeedCard {
  agentId: string;
  title: string;
  /** The newest event's time: the card's own. */
  at: number;
  /** The newest four lines, newest first. */
  lines: string[];
  /** How many more lines the card holds. */
  more: number;
  /** Needs permission or stopped on an error: the card stands alone and offers its session. */
  alert: boolean;
}

/** Events of one agent this close together share a card: four minutes. */
export const CARD_GAP_MS = 4 * 60 * 1000;
/** The lines of a card before "+N more". */
export const CARD_LINES = 4;

export type FeedTab = "all" | "attention";

function shown(event: FeedEvent, tab: FeedTab, chips: ReadonlySet<FeedChip>): boolean {
  if (tab === "attention" && !event.alert) return false;
  if (chips.size === 0) return true;
  const chip = chipOf(event.kind);
  return chip !== null && chips.has(chip);
}

/** Newest first; two events of one read keep the later-told first. */
function byNewest(events: readonly FeedEvent[]): FeedEvent[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => right.event.at - left.event.at || right.index - left.index)
    .map(({ event }) => event);
}

function sharesCard(card: FeedCard, event: FeedEvent): boolean {
  return (
    !card.alert &&
    !event.alert &&
    card.agentId === event.agentId &&
    card.at - event.at <= CARD_GAP_MS
  );
}

function addToCard(card: FeedCard, event: FeedEvent): void {
  if (card.lines.length < CARD_LINES) card.lines.push(event.text);
  else card.more += 1;
}

/**
 * The feed as cards, newest first. The tab keeps the alerts or everything; the chips keep the
 * kinds they name, and no chip keeps all of them.
 */
export function feedCards(
  events: readonly FeedEvent[],
  tab: FeedTab,
  chips: ReadonlySet<FeedChip>,
): FeedCard[] {
  const cards: FeedCard[] = [];
  let open: FeedCard | null = null;
  for (const event of byNewest(events)) {
    if (!shown(event, tab, chips)) continue;
    if (open !== null && sharesCard(open, event)) {
      addToCard(open, event);
      continue;
    }
    open = {
      agentId: event.agentId,
      title: event.title,
      at: event.at,
      lines: [event.text],
      more: 0,
      alert: event.alert,
    };
    cards.push(open);
  }
  return cards;
}

/** The newest events the feed keeps. */
export const FEED_EVENT_MAX = 300;

function sameEvent(left: FeedEvent, right: FeedEvent): boolean {
  return (
    left.at === right.at &&
    left.text === right.text &&
    left.title === right.title &&
    left.alert === right.alert
  );
}

/** Two subscriptions receive the same broadcast milliseconds apart, and stamp its status with each. */
export const STATUS_SAME_MS = 2_000;

const STATUS_KINDS: ReadonlySet<FeedKind> = new Set(["started", "finished", "error"]);

/** A status event already kept for the same change: same agent, same kind, close in time. */
function statusTwin(kept: readonly FeedEvent[], event: FeedEvent): boolean {
  return (
    STATUS_KINDS.has(event.kind) &&
    kept.some(
      (other) =>
        other.agentId === event.agentId &&
        other.kind === event.kind &&
        Math.abs(other.at - event.at) <= STATUS_SAME_MS,
    )
  );
}

let store: readonly FeedEvent[] = [];
const listeners = new Set<() => void>();

function tell(): void {
  for (const listener of listeners) listener();
}

/**
 * The feed's store: one per app run, written by every subscription to the office's state and read
 * by the Activity panel. An event id says what it is, so the same event pushed twice is kept once.
 */
export const feedStore = {
  push(incoming: readonly FeedEvent[]): void {
    if (incoming.length === 0) return;
    const next = [...store];
    const index = new Map(next.map((event, position) => [event.id, position]));
    let changed = false;
    for (const event of incoming) {
      // The earlier telling of a status change is kept; the other subscription's is dropped.
      if (statusTwin(next, event)) continue;
      const position = index.get(event.id);
      if (position === undefined) {
        index.set(event.id, next.length);
        next.push(event);
        changed = true;
        continue;
      }
      const kept = next[position];
      if (kept !== undefined && sameEvent(kept, event)) continue;
      // The newest telling of an id wins: a test run's end replaces the step it ended.
      next[position] = event;
      changed = true;
    }
    if (!changed) return;
    store = next.length > FEED_EVENT_MAX ? next.slice(next.length - FEED_EVENT_MAX) : next;
    tell();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  getSnapshot(): readonly FeedEvent[] {
    return store;
  },
  /** Tests only: an empty feed, as at the start of an app run. Changes no caller's own state. */
  reset(): void {
    store = [];
    tell();
  },
};

/**
 * Feeds one subscription's change to the store: the state it came from and the state it has now.
 * Each caller brings its own pair, because two subscriptions to the office's state do not share
 * an order, and a pair diffed against another caller's state could run backwards. A first state
 * (`before === null`) says nothing: opening the office is no news. The dedup by id makes the same
 * change seen by two callers one event.
 */
export function recordOfficeState(
  before: OfficeSnapshot | null,
  after: OfficeSnapshot,
  now: number = Date.now(),
): void {
  feedStore.push(feedEvents(before, after, now));
}
