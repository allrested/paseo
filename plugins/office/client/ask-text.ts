import type { OfficeAgent, Post } from "../shared/contracts.js";
import { USER_AUTHOR } from "../shared/names.js";
import { agentTitle, type OfficeRoom } from "../shared/model.js";

// The office asks an agent for something with a note on a board that names it: a review, a
// skill. Nothing is stored beside the board, so the request and its answer are found again here.

/** An agent a request can name. */
export interface AskAgent {
  agentId: string;
  title: string;
}

/** The newest request, and the note that answered it. */
export interface Asked extends AskAgent {
  /** The asked agent's first note after the request; null while there is none. */
  text: string | null;
  /** The note was cut: the board has the rest. */
  cut: boolean;
}

/** A note from the user that names an agent: what each request of the office is. */
export function isUserRequest(post: Post): boolean {
  return post.kind === "note" && post.author === USER_AUTHOR && post.to !== undefined;
}

/** The newest post `isRequest` takes, and the asked agent's first note after it. */
export function latestRequest(
  posts: readonly Post[],
  isRequest: (post: Post) => boolean,
): { request: Post; agentId: string; answer: Post | null } | null {
  const request = posts
    .filter(isRequest)
    .reduce<Post | null>((latest, post) => (latest && latest.seq > post.seq ? latest : post), null);
  if (request === null || request.to === undefined) return null;
  const agentId = request.to;
  const answer = posts
    .filter((post) => post.kind === "note" && post.author === agentId && post.seq > request.seq)
    .reduce<Post | null>((first, post) => (first && first.seq < post.seq ? first : post), null);
  return { request, agentId, answer };
}

/** Who was asked, by name, and its answer cut at `max`. */
export function askedOf(
  found: { agentId: string; answer: Post | null },
  agents: ReadonlyMap<string, OfficeAgent>,
  max: number,
): Asked {
  const agent = agents.get(found.agentId);
  const text = found.answer?.text.trim() ?? null;
  const cut = text !== null && text.length > max;
  return {
    agentId: found.agentId,
    title: agent ? agentTitle(agent) : "An agent that left",
    text: text !== null && cut ? `${text.slice(0, max - 1)}…` : text,
    cut,
  };
}

function newestFirst(a: OfficeAgent, b: OfficeAgent): number {
  if (a.createdAt === b.createdAt) return 0;
  return a.createdAt < b.createdAt ? 1 : -1;
}

/**
 * The room's agents that can be asked now: idle, with no question open, and waiting on no
 * sub-agent. The newest first.
 */
export function idleAgents(room: OfficeRoom): OfficeAgent[] {
  return room.rows
    .filter((row) => row.waitingOn === 0)
    .map((row) => row.agent)
    .filter((agent) => agent.status === "idle" && agent.permissions.length === 0)
    .sort(newestFirst);
}
