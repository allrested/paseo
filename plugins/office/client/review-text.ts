import type { OfficeAgent, Post, WorkspacePullRequest } from "../shared/contracts.js";
import {
  askedOf as answerOf,
  idleAgents,
  isUserRequest,
  latestRequest,
  type AskAgent,
  type Asked,
} from "./ask-text.js";
import type { HostNote } from "./machine-text.js";
import { agentTitle, type OfficeModel, type OfficeRoom } from "./model.js";
import { pullRequestLinkText, teamName } from "./standup-text.js";

/** Where a pull request stands with its review. The order is the queue's. */
export type ReviewStand = "review" | "changes" | "approved" | "draft";

const STAND_ORDER: readonly ReviewStand[] = ["review", "changes", "approved", "draft"];
const STAND_WORDS: Readonly<Record<ReviewStand, string>> = {
  review: "Waiting for a review",
  changes: "Changes requested",
  approved: "Approved",
  draft: "Draft",
};
const CHECK_WORDS: Readonly<Record<WorkspacePullRequest["checks"], string | null>> = {
  none: null,
  pending: "checks running",
  success: "checks pass",
  failure: "checks fail",
};

/** What a review an agent wrote is cut at in the card; the board has all of it. */
const REVIEW_MAX = 600;

/** How a request for a review starts on the board: the office finds its own requests by it. */
export const REVIEW_MARK = "Review request: ";

export type ReviewAgent = AskAgent;

/** The newest request for a review of a pull request, and the note that answered it. */
export type ReviewAsked = Asked;

export interface ReviewRow {
  /** The pull request's room: its workspace's id. */
  roomId: string;
  /** "#128 Retry failed card charges". */
  title: string;
  /** The team, the branch and where it goes, and the size of the changes. */
  meta: string;
  url: string;
  linkText: string;
  stand: ReviewStand;
  /** The stand, the checks and conflicts in words. */
  status: string;
  /** Something stands between it and a merge that is not the review itself. */
  troubled: boolean;
  asked: ReviewAsked | null;
  /**
   * Who a request would go to now: the team's newest idle agent. Null when none is idle, and
   * while the agent already asked has not answered.
   */
  reviewer: ReviewAgent | null;
}

function standOf(request: WorkspacePullRequest): ReviewStand {
  if (request.state === "draft") return "draft";
  if (request.review === "changes_requested") return "changes";
  return request.review === "approved" ? "approved" : "review";
}

/** A pull request by name: its number and its title. */
export function reviewTitle(request: Pick<WorkspacePullRequest, "number" | "title">): string {
  return request.number === null ? request.title : `#${request.number} ${request.title}`;
}

/**
 * What an agent is asked: a note that names it. The first line marks the note as a request and
 * the second is the pull request's address, which is how its answer is found again.
 */
export function reviewAsk(request: WorkspacePullRequest): string {
  const against = request.base === null ? "" : ` against ${request.base}`;
  return [
    `${REVIEW_MARK}${reviewTitle(request)}`,
    request.url,
    `Read the diff of this branch${against}, then post one note on this board with what you found, the worst first, each with its file and line. Change no files.`,
  ].join("\n");
}

function isRequestFor(post: Post, url: string): boolean {
  if (!isUserRequest(post)) return false;
  const [first, second] = post.text.split("\n");
  return first !== undefined && first.startsWith(REVIEW_MARK) && second === url;
}

function askedOf(
  room: OfficeRoom,
  url: string,
  agents: ReadonlyMap<string, OfficeAgent>,
): ReviewAsked | null {
  const found = latestRequest(room.posts, (post) => isRequestFor(post, url));
  return found === null ? null : answerOf(found, agents, REVIEW_MAX);
}

function reviewerOf(room: OfficeRoom, asked: ReviewAsked | null): ReviewAgent | null {
  const present = new Set(room.rows.map((row) => row.agent.id));
  // A request without an answer is still with its agent, as long as that agent is here.
  if (asked !== null && asked.text === null && present.has(asked.agentId)) return null;
  const [newest] = idleAgents(room);
  return newest === undefined ? null : { agentId: newest.id, title: agentTitle(newest) };
}

/** The branch and where it goes: "fix into main". Null without a branch. */
function routeOf(branch: string | undefined, base: string | null): string | null {
  if (branch === undefined) return null;
  return base === null ? branch : `${branch} into ${base}`;
}

function metaOf(room: OfficeRoom, request: WorkspacePullRequest): string {
  const { branch, changes } = room.workspace ?? {};
  return [
    teamName({ name: room.name, project: room.subtitle }),
    routeOf(branch, request.base),
    // (a no-break space: the two numbers stay on one line)
    changes === undefined ? null : `+${changes.additions}\u00a0−${changes.deletions}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/**
 * The review queue: every open or draft pull request of a workspace, the ones that wait for a
 * review first, then the ones sent back, the approved ones and the drafts.
 */
export function reviewRows(model: Pick<OfficeModel, "rooms" | "agents">): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const room of model.rooms) {
    const request = room.workspace?.pullRequest;
    if (!request || (request.state !== "open" && request.state !== "draft")) continue;
    const stand = standOf(request);
    const checks = CHECK_WORDS[request.checks];
    const asked = askedOf(room, request.url, model.agents);
    rows.push({
      roomId: room.id,
      title: reviewTitle(request),
      meta: metaOf(room, request),
      url: request.url,
      linkText: pullRequestLinkText(request),
      stand,
      status: [STAND_WORDS[stand], checks, request.conflicts ? "has conflicts" : null]
        .filter((part) => part !== null)
        .join(", "),
      troubled: stand === "changes" || request.checks === "failure" || request.conflicts,
      asked,
      reviewer: reviewerOf(room, asked),
    });
  }
  return rows.sort((a, b) => STAND_ORDER.indexOf(a.stand) - STAND_ORDER.indexOf(b.stand));
}

function count(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

function waiting(rows: readonly ReviewRow[]): number {
  return rows.filter((row) => row.stand === "review").length;
}

/** The queue in a few words, for the strip; null when no pull request is open. */
export function reviewNote(rows: readonly ReviewRow[]): HostNote | null {
  if (rows.length === 0) return null;
  const toReview = waiting(rows);
  if (toReview > 0) return { text: `${toReview} to review`, tone: "warning" };
  return { text: count(rows.length, "pull request", "pull requests"), tone: "muted" };
}

/** What the card says under its first line: where the changes are read and the verdict given. */
export const REVIEW_HELP =
  "Read the changes in the workspace and give your verdict on the pull request's own page. An idle agent of the team can review it too: it answers with a note.";

/** The card's first line: how many pull requests are open and how many wait for a review. */
export function reviewSummary(rows: readonly ReviewRow[]): string {
  if (rows.length === 0) return "No open pull requests.";
  const toReview = waiting(rows);
  const open = count(rows.length, "open pull request", "open pull requests");
  return toReview === 0 ? `${open}, none waiting for a review` : `${open}, ${toReview} to review`;
}

/** The button that asks: "again" once a review of this pull request has come in. */
export function reviewAskLabel(row: Pick<ReviewRow, "asked">): string {
  return row.asked?.text ? "Ask for another review" : "Ask for a review";
}

/**
 * The line under a pull request's buttons: who would be asked, or why nobody can be. Null while
 * the agent already asked has not answered: the line about that request says it.
 */
export function reviewHint(
  row: Pick<ReviewRow, "asked" | "reviewer">,
  wakesPaused: boolean,
): string | null {
  if (row.reviewer === null) {
    return row.asked !== null && row.asked.text === null
      ? null
      : "No agent of this team is idle, so nobody can be asked.";
  }
  if (wakesPaused) return "Wake agents is off, so a request would wait. Turn it on to ask.";
  return `${row.reviewer.title} is idle and gets the request on the team's board.`;
}
