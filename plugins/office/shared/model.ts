import type {
  ActivityStep,
  OfficeAgent,
  OfficeSnapshot,
  OfficeWorkspace,
  Post,
} from "./contracts.js";
import { LOBBY } from "./names.js";

export const LOBBY_NAME = "Lobby";

export interface OfficeRow {
  agent: OfficeAgent;
  /** 1 for an agent whose parent is in the same room. */
  depth: 0 | 1;
  /** The "doing now" line; running agents only. */
  activity: string | null;
  /** The tool call a running agent is at, or made since the host's read before; null at none. */
  step: ActivityStep | null;
  /**
   * How many agents this one started are still at work, when its own turn has ended: it waits on
   * them, so it is not idle. 0 for everyone else.
   */
  waitingOn: number;
}

export interface OfficeRoom {
  /** A workspace id, or "lobby". */
  id: string;
  name: string;
  /** The project name of a workspace room. */
  subtitle: string | null;
  lobby: boolean;
  /** The room's workspace: its branch, its ticket and its pull request. Null for the lobby. */
  workspace: OfficeWorkspace | null;
  rows: OfficeRow[];
  /** Open and claimed tasks and notes. */
  posts: Post[];
}

export type AttentionReason = "permission" | "error";

export interface AttentionEntry {
  agentId: string;
  roomId: string;
  title: string;
  reason: AttentionReason;
}

export interface OfficeModel {
  rooms: OfficeRoom[];
  attention: AttentionEntry[];
  agents: ReadonlyMap<string, OfficeAgent>;
  roomOfAgent: ReadonlyMap<string, string>;
  /** The agents that wait on sub-agents, each with how many (`waitingOnOf`). */
  waitingOn: ReadonlyMap<string, number>;
}

export type DotTone = "running" | "idle" | "starting" | "warning" | "danger";

const ANSWERABLE_KINDS: ReadonlySet<string> = new Set(["tool", "mode", "other"]);

/** The office's name for a numbered sub-agent, else its own title. */
export function agentTitle(agent: OfficeAgent): string {
  if (agent.name) return agent.name;
  const title = agent.title?.trim();
  return title ? title : `Agent ${agent.id.slice(0, 8)}`;
}

/** A named sub-agent's own title, its task, when it says more than the name; else null. */
export function agentTask(agent: OfficeAgent): string | null {
  const title = agent.title?.trim();
  return agent.name && title && title !== agent.name ? title : null;
}

export function agentMeta(agent: OfficeAgent): string {
  return agent.model ? `${agent.provider} · ${agent.model}` : agent.provider;
}

export function attentionReason(agent: OfficeAgent): AttentionReason | null {
  if (agent.permissions.length > 0) return "permission";
  if (agent.status === "error") return "error";
  return null;
}

export function dotTone(agent: OfficeAgent): DotTone {
  const reason = attentionReason(agent);
  if (reason === "permission") return "warning";
  if (reason === "error") return "danger";
  if (agent.status === "running") return "running";
  if (agent.status === "initializing") return "starting";
  return "idle";
}

/** Approve and Deny answer these kinds; a plan or a question needs the session. */
export function answerableInOffice(kind: string): boolean {
  return ANSWERABLE_KINDS.has(kind);
}

/** At work, as far as a parent that waits is concerned: running, starting, or asking the user. */
function atWork(agent: OfficeAgent): boolean {
  return (
    agent.status === "running" || agent.status === "initializing" || agent.permissions.length > 0
  );
}

/**
 * Who waits on sub-agents, and on how many. An agent whose own turn has ended (idle, with no
 * question open) is busy while an agent it started, or one those started, runs, starts or waits
 * for the user. Only the agents given count: the directory drops the ones the office does not
 * show before they get here. This is the one place the rule is worked out; the floors, the
 * stand-up, the cards that ask an agent and the janitor read its answer.
 */
export function waitingOnOf(agents: Iterable<OfficeAgent>): Map<string, number> {
  const all = [...agents];
  const started = new Map<string, OfficeAgent[]>();
  for (const agent of all) {
    const parent = agent.parentAgentId;
    if (parent === null || parent === agent.id) continue;
    started.set(parent, [...(started.get(parent) ?? []), agent]);
  }
  const waiting = new Map<string, number>();
  for (const agent of all) {
    if (agent.status !== "idle" || agent.permissions.length > 0) continue;
    const seen = new Set([agent.id]);
    const below = [...(started.get(agent.id) ?? [])];
    let count = 0;
    // (the list grows as it is walked: each one's own sub-agents are added behind it)
    for (const one of below) {
      if (seen.has(one.id)) continue;
      seen.add(one.id);
      if (atWork(one)) count += 1;
      below.push(...(started.get(one.id) ?? []));
    }
    if (count > 0) waiting.set(agent.id, count);
  }
  return waiting;
}

/** What a waiting agent is at, in words: "Waiting on 2 sub-agents". */
export function waitingOnText(count: number): string {
  return count === 1 ? "Waiting on 1 sub-agent" : `Waiting on ${count} sub-agents`;
}

// Same order as server/directory.ts sortAgents; the fake office (Task 16) is not pre-sorted.
function byCreation(left: OfficeAgent, right: OfficeAgent): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function orderRows(
  agents: readonly OfficeAgent[],
  activity: Readonly<Record<string, string>>,
  doing: Readonly<Record<string, ActivityStep>>,
  waitingOn: ReadonlyMap<string, number>,
): OfficeRow[] {
  const sorted = [...agents].sort(byCreation);
  const ids = new Set(sorted.map((agent) => agent.id));
  const children = new Map<string, OfficeAgent[]>();
  const roots: OfficeAgent[] = [];
  for (const agent of sorted) {
    const parent = agent.parentAgentId;
    if (parent !== null && parent !== agent.id && ids.has(parent)) {
      children.set(parent, [...(children.get(parent) ?? []), agent]);
    } else {
      roots.push(agent);
    }
  }
  const rows: OfficeRow[] = [];
  const seen = new Set<string>();
  function visit(agent: OfficeAgent, depth: 0 | 1): void {
    if (seen.has(agent.id)) return;
    seen.add(agent.id);
    const running = agent.status === "running";
    rows.push({
      agent,
      depth,
      activity: running ? (activity[agent.id] ?? null) : null,
      step: running ? (doing[agent.id] ?? null) : null,
      waitingOn: waitingOn.get(agent.id) ?? 0,
    });
    for (const child of children.get(agent.id) ?? []) visit(child, 1);
  }
  for (const root of roots) visit(root, 0);
  // A parent chain that loops has no root; show what is left from its oldest agent.
  for (const agent of sorted) visit(agent, 0);
  return rows;
}

function visiblePosts(posts: readonly Post[]): Post[] {
  return posts
    .filter((post) => !(post.kind === "task" && post.state === "done"))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.seq - right.seq);
}

function attentionList(
  agents: Iterable<OfficeAgent>,
  roomOfAgent: ReadonlyMap<string, string>,
): AttentionEntry[] {
  const entries: AttentionEntry[] = [];
  for (const agent of agents) {
    const reason = attentionReason(agent);
    if (reason === null) continue;
    entries.push({
      agentId: agent.id,
      roomId: roomOfAgent.get(agent.id) ?? LOBBY,
      title: agentTitle(agent),
      reason,
    });
  }
  const rank = (reason: AttentionReason) => (reason === "permission" ? 0 : 1);
  return entries.sort(
    (left, right) =>
      rank(left.reason) - rank(right.reason) || left.title.localeCompare(right.title),
  );
}

export function buildOfficeModel(state: OfficeSnapshot): OfficeModel {
  const workspaceIds = new Set(state.workspaces.map((workspace) => workspace.id));
  const agents = new Map<string, OfficeAgent>();
  for (const agent of state.agents) if (agent.status !== "closed") agents.set(agent.id, agent);
  const waitingOn = waitingOnOf(agents.values());
  const byRoom = new Map<string, OfficeAgent[]>();
  const roomOfAgent = new Map<string, string>();
  for (const agent of agents.values()) {
    const known = agent.workspaceId !== null && workspaceIds.has(agent.workspaceId);
    const roomId = known && agent.workspaceId !== null ? agent.workspaceId : LOBBY;
    roomOfAgent.set(agent.id, roomId);
    byRoom.set(roomId, [...(byRoom.get(roomId) ?? []), agent]);
  }
  function room(
    id: string,
    name: string,
    subtitle: string | null,
    workspace: OfficeWorkspace | null,
  ): OfficeRoom {
    return {
      id,
      name,
      subtitle,
      lobby: workspace === null,
      workspace,
      rows: orderRows(byRoom.get(id) ?? [], state.activity, state.doing ?? {}, waitingOn),
      posts: visiblePosts(state.boards[id] ?? []),
    };
  }
  const rooms = [
    room(LOBBY, LOBBY_NAME, null, null),
    ...state.workspaces.map((workspace) =>
      room(workspace.id, workspace.name, workspace.projectName, workspace),
    ),
  ];
  return {
    rooms,
    attention: attentionList(agents.values(), roomOfAgent),
    agents,
    roomOfAgent,
    waitingOn,
  };
}

/** A workspace tab shows its own room first, then the lobby, then the rest in order. */
export function orderRoomsForFocus(
  rooms: readonly OfficeRoom[],
  focusRoomId: string | null,
): OfficeRoom[] {
  const focus = rooms.find((candidate) => candidate.id === focusRoomId && !candidate.lobby);
  if (!focus) return [...rooms];
  return [focus, ...rooms.filter((candidate) => candidate !== focus)];
}
