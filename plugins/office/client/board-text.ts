import type { OfficeAgent, Post, WakeState } from "../shared/contracts.js";
import { USER_AUTHOR } from "../shared/names.js";
import { agentTitle } from "./model.js";

/** How many posts a room card shows before it counts the rest. The board sheet shows them all. */
export const CARD_POSTS = 3;

/** The user sees their own posts as "You". */
export function authorName(author: string, agents: ReadonlyMap<string, OfficeAgent>): string {
  if (author === USER_AUTHOR) return "You";
  const agent = agents.get(author);
  return agent ? agentTitle(agent) : `Agent ${author.slice(0, 8)}`;
}

export function postStateLabel(post: Post, name: (author: string) => string): string {
  if (post.kind === "note") return "Note";
  if (post.state === "claimed" && post.claimedBy !== undefined) {
    return `Task · claimed by ${name(post.claimedBy)}`;
  }
  return `Task · ${post.state ?? "open"}`;
}

/** Spec: a post that names an agent shows "from → to". */
export function postMeta(post: Post, name: (author: string) => string): string {
  const people =
    post.to === undefined ? name(post.author) : `${name(post.author)} → ${name(post.to)}`;
  return `${postStateLabel(post, name)} · ${people}`;
}

function rank(post: Post): number {
  if (post.kind === "note") return 2;
  return post.state === "claimed" ? 1 : 0;
}

/** Open tasks, then claimed tasks, then notes; oldest first within each. */
export function orderBoardPosts(posts: readonly Post[]): Post[] {
  return [...posts].sort(
    (left, right) =>
      rank(left) - rank(right) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.seq - right.seq,
  );
}

export interface BoardPreview {
  shown: Post[];
  /** Posts the card leaves to the board sheet. */
  more: number;
}

/** What a room card shows of its board: the first posts in board order, and how many are left. */
export function boardPreview(posts: readonly Post[], max: number = CARD_POSTS): BoardPreview {
  const shown = orderBoardPosts(posts).slice(0, max);
  return { shown, more: posts.length - shown.length };
}

export function queuedWakes(wake: WakeState): number {
  return Object.values(wake.queued).reduce((sum, count) => sum + count, 0);
}

/**
 * The words beside the "Wake agents" switch: how many posts wait for their agents, or nothing.
 * That wakes are paused is the switch's own position, so it is not said again.
 */
export function wakeSummary(wake: WakeState): string | null {
  const queued = queuedWakes(wake);
  return queued > 0 ? `${queued} waiting` : null;
}
