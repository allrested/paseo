import type { Post, WorkspacePullRequest, WorkspaceTicket } from "../shared/contracts.js";
import type { HostNote } from "./machine-text.js";
import { agentTitle, type OfficeModel, type OfficeRoom, type OfficeRow } from "./model.js";

/** A note counts as what its agent says at the stand-up for this long. */
export const SAID_WITHIN_MS = 24 * 60 * 60 * 1000;
const SAID_MAX = 240;

/** What an agent is asked when the stand-up asks for updates: a post that names it. */
export const STANDUP_ASK =
  "Stand-up: post a note on this board, three lines at most: what you did, what is next, and what blocks you.";

export interface StandupPerson {
  agentId: string;
  title: string;
  /** What the agent is at. */
  line: string;
  /** Its newest note on the room's board from the last day; null without one. */
  said: string | null;
  /** A request for an update reaches it now: it is idle. */
  free: boolean;
}

export interface StandupTeam {
  roomId: string;
  name: string;
  /** The project of a workspace's team; null for the lobby. */
  project: string | null;
  branch: string | null;
  ticket: WorkspaceTicket | null;
  pullRequest: WorkspacePullRequest | null;
  /** The pull request in words; null without one. */
  review: string | null;
  /** The board's tasks in words; null when it has none to do. */
  tasks: string | null;
  /** What keeps the team from going on, each in a sentence. */
  blockers: string[];
  people: StandupPerson[];
}

const CHECKS: Readonly<Record<WorkspacePullRequest["checks"], string | null>> = {
  none: null,
  pending: "checks running",
  success: "checks pass",
  failure: "checks fail",
};
const REVIEW: Readonly<Record<NonNullable<WorkspacePullRequest["review"]>, string>> = {
  approved: "approved",
  changes_requested: "changes requested",
  pending: "review pending",
};

/** What the link to a pull request reads: "#12", or "Pull request" without a number. */
export function pullRequestLinkText(request: Pick<WorkspacePullRequest, "number">): string {
  return request.number === null ? "Pull request" : `#${request.number}`;
}

/** "#12", or the words for a request whose forge gave no number. */
export function pullRequestRef(request: Pick<WorkspacePullRequest, "number">): string {
  return request.number === null ? "the pull request" : `#${request.number}`;
}

/** A pull request in one line: its number and title, then how it stands. */
export function pullRequestLine(request: WorkspacePullRequest): string {
  const name = request.number === null ? request.title : `#${request.number} ${request.title}`;
  const live = request.state === "open" || request.state === "draft";
  const facts = [
    request.state,
    ...(live
      ? [
          CHECKS[request.checks],
          request.review === null ? null : REVIEW[request.review],
          request.conflicts ? "has conflicts" : null,
        ]
      : []),
  ].filter((fact) => fact !== null);
  return `${name}: ${facts.join(", ")}`;
}

function personLine(row: OfficeRow): string {
  const { agent } = row;
  if (agent.permissions.length > 0) return "Waiting for your answer";
  if (agent.status === "error") return "Stopped on an error";
  if (agent.status === "running") return row.activity ?? "Working";
  return agent.status === "initializing" ? "Starting" : "Idle";
}

function saidBy(agentId: string, posts: readonly Post[], now: number): string | null {
  const notes = posts.filter(
    (post) =>
      post.kind === "note" &&
      post.author === agentId &&
      now - Date.parse(post.createdAt) <= SAID_WITHIN_MS,
  );
  const newest = notes.reduce<Post | null>(
    (latest, post) => (latest === null || post.seq > latest.seq ? post : latest),
    null,
  );
  if (newest === null) return null;
  const text = newest.text.replace(/\s+/g, " ").trim();
  return text.length > SAID_MAX ? `${text.slice(0, SAID_MAX - 1)}…` : text;
}

function count(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

function tasksLine(posts: readonly Post[]): string | null {
  const tasks = posts.filter((post) => post.kind === "task");
  const open = tasks.filter((post) => post.state === "open").length;
  const claimed = tasks.filter((post) => post.state === "claimed").length;
  if (open + claimed === 0) return null;
  const parts = [
    ...(open > 0 ? [count(open, "open task", "open tasks")] : []),
    ...(claimed > 0 ? [`${claimed} claimed`] : []),
  ];
  return parts.join(", ");
}

function blockersOf(room: OfficeRoom): string[] {
  const blockers: string[] = [];
  for (const { agent } of room.rows) {
    if (agent.permissions.length > 0) blockers.push(`${agentTitle(agent)} waits for your answer`);
    else if (agent.status === "error") blockers.push(`${agentTitle(agent)} stopped on an error`);
  }
  const request = room.workspace?.pullRequest;
  if (request && (request.state === "open" || request.state === "draft")) {
    const ref = pullRequestRef(request);
    if (request.checks === "failure") blockers.push(`Checks fail on ${ref}`);
    if (request.review === "changes_requested") blockers.push(`Changes requested on ${ref}`);
    if (request.conflicts) {
      blockers.push(`${ref.charAt(0).toUpperCase()}${ref.slice(1)} has conflicts`);
    }
  }
  return blockers;
}

/** The stand-up: every room with an agent in it, in the office's order. */
export function standupTeams(model: Pick<OfficeModel, "rooms">, now: number): StandupTeam[] {
  return model.rooms
    .filter((room) => room.rows.length > 0)
    .map((room) => {
      const request = room.workspace?.pullRequest ?? null;
      return {
        roomId: room.id,
        name: room.name,
        project: room.subtitle,
        branch: room.workspace?.branch ?? null,
        ticket: room.workspace?.ticket ?? null,
        pullRequest: request,
        review: request === null ? null : pullRequestLine(request),
        tasks: tasksLine(room.posts),
        blockers: blockersOf(room),
        people: room.rows.map((row) => ({
          agentId: row.agent.id,
          title: agentTitle(row.agent),
          line: personLine(row),
          said: saidBy(row.agent.id, room.posts, now),
          free: row.agent.status === "idle" && row.agent.permissions.length === 0,
        })),
      };
    });
}

/** The stand-up in a few words, for the strip; null in an office without agents. */
export function standupNote(teams: readonly StandupTeam[]): HostNote | null {
  if (teams.length === 0) return null;
  const blockers = teams.reduce((sum, team) => sum + team.blockers.length, 0);
  if (blockers > 0) return { text: count(blockers, "blocker", "blockers"), tone: "warning" };
  return { text: count(teams.length, "team", "teams"), tone: "muted" };
}

/** A team's name with its project: "shop-api (shop)". The lobby has no project. */
export function teamName(team: Pick<StandupTeam, "name" | "project">): string {
  return team.project === null ? team.name : `${team.name} (${team.project})`;
}

/** A team's first line: its name, its project, its ticket and its branch. */
export function teamHeading(team: StandupTeam): string {
  return [teamName(team), team.ticket?.key ?? null, team.branch]
    .filter((part) => part !== null)
    .join(" · ");
}

/**
 * The stand-up as plain text, to paste where the team reads it. A link is its address there, on
 * a line of its own under what it belongs to.
 */
export function standupText(teams: readonly StandupTeam[]): string {
  const blocks = teams.map((team) =>
    [
      teamHeading(team),
      ...(team.ticket?.url ? [`${team.ticket.key}: ${team.ticket.url}`] : []),
      ...(team.review === null ? [] : [`Pull request ${team.review}`]),
      ...(team.pullRequest === null
        ? []
        : [`${pullRequestLinkText(team.pullRequest)}: ${team.pullRequest.url}`]),
      ...(team.tasks === null ? [] : [`Board: ${team.tasks}`]),
      ...team.blockers.map((blocker) => `Blocked: ${blocker}`),
      ...team.people.map((person) =>
        person.said === null
          ? `- ${person.title}: ${person.line}`
          : `- ${person.title}: ${person.line}. Said: ${person.said}`,
      ),
    ].join("\n"),
  );
  return [`Stand-up, ${count(teams.length, "team", "teams")}`, ...blocks].join("\n\n");
}

/** The stand-up's first line: how many teams and agents, and how many blockers. */
export function standupSummary(teams: readonly StandupTeam[]): string {
  if (teams.length === 0) return "No agents on this host yet.";
  const agents = teams.reduce((sum, team) => sum + team.people.length, 0);
  const blockers = teams.reduce((sum, team) => sum + team.blockers.length, 0);
  const parts = [count(teams.length, "team", "teams"), count(agents, "agent", "agents")];
  parts.push(blockers === 0 ? "nothing blocked" : count(blockers, "blocker", "blockers"));
  return parts.join(", ");
}

/** The button that asks: how many idle agents it would reach. */
export function askLabel(free: number): string {
  if (free === 0) return "Ask for an update";
  return free === 1 ? "Ask 1 agent for an update" : `Ask ${free} agents for an update`;
}

/**
 * The line under the stand-up's buttons: why nobody can be asked, what was asked, or what
 * asking does. `free` counts the idle agents not asked yet, `asked` those this stand-up asked.
 */
export function askHint(input: { free: number; asked: number; wakesPaused: boolean }): string {
  if (input.wakesPaused) {
    return "Wake agents is off, so a post would wait. Turn it on to ask for updates.";
  }
  const asked =
    input.asked === 0
      ? null
      : `Asked ${count(input.asked, "agent", "agents")}. Each answers on its team's board, and its note shows here.`;
  if (input.free === 0) return asked ?? "Nobody is idle. An agent at work is not asked.";
  const does =
    "An idle agent gets a post on its team's board and answers there with a note. An agent at work is not asked.";
  return asked === null ? does : `${asked} ${does}`;
}
