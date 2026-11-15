// What the daemon's hooks say, as feed entries.
import type { FeedEntry } from "../shared/contracts.js";
import { errorMessage } from "./errors.js";
import { lastMessage, oneLine, type TimelineEntry } from "./summary.js";

/** The newest timeline entries read for a turn's last message: it is at the turn's end. */
export const TAIL_LIMIT = 30;

/** The fields read from a hook's agent; PluginHookAgent satisfies it. */
export interface FeedAgent {
  id: string;
  title: string | null;
  cwd: string;
  /** A helper hidden from tabs, lists and attention. */
  background: boolean;
}

export type TurnOutcome =
  | { kind: "completed" }
  | { kind: "failed"; error: { message: string } }
  | { kind: "canceled"; reason: string };

/** What stamps an entry. */
export interface StampPorts {
  /** Now, as an ISO time. */
  now(): string;
  newId(): string;
}

export interface RecorderPorts extends StampPorts {
  /** The newest TAIL_LIMIT entries of an agent's timeline, oldest first. */
  tail(agentId: string): Promise<readonly TimelineEntry[]>;
  log(message: string): void;
}

function entryOf(ports: StampPorts, agent: FeedAgent) {
  return {
    id: ports.newId(),
    at: ports.now(),
    agentId: agent.id,
    title: agent.title,
    folder: agent.cwd,
  };
}

/**
 * The entry for a turn that ended, or null for one that is no news: a helper's turn, and a turn
 * that was stopped. A finished turn whose last message cannot be read still gets its entry.
 */
export async function turnEntry(
  ports: RecorderPorts,
  turn: { agent: FeedAgent; turnId: string | null; outcome: TurnOutcome },
): Promise<FeedEntry | null> {
  const { agent, outcome } = turn;
  if (agent.background || outcome.kind === "canceled") return null;
  if (outcome.kind === "failed") {
    return { ...entryOf(ports, agent), kind: "failed", text: oneLine(outcome.error.message) };
  }
  let text: string | null = null;
  try {
    const said = lastMessage(await ports.tail(agent.id), turn.turnId);
    if (said !== null) text = oneLine(said);
  } catch (error) {
    ports.log(`[feed] the last message of ${agent.id} could not be read: ${errorMessage(error)}`);
  }
  // Stamped after the read, when the entry reaches the feed: the feed's order is the order of
  // its times, and an entry that comes after the feed was opened is new.
  return { ...entryOf(ports, agent), kind: "finished", text };
}

/** The entry for a permission an agent asks for; null for a helper's. */
export function permissionEntry(
  ports: StampPorts,
  asked: { agent: FeedAgent; request: { id: string; name: string; title?: string } },
): FeedEntry | null {
  const { agent, request } = asked;
  if (agent.background) return null;
  return {
    ...entryOf(ports, agent),
    kind: "permission",
    text: oneLine(request.title ?? request.name),
    requestId: request.id,
  };
}
