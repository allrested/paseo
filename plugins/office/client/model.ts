import type { OfficeAgent, OfficeSnapshot, Post } from "../shared/contracts.js";
import { LOBBY } from "../shared/names.js";

export const LOBBY_NAME = "Lobby";

export interface OfficeRow {
  agent: OfficeAgent;
  /** 1 for an agent whose parent is in the same room. */
  depth: 0 | 1;
  /** The "doing now" line; running agents only. */
  activity: string | null;
}

export interface OfficeRoom {
  /** A workspace id, or "lobby". */
  id: string;
  name: string;
  /** The project name of a workspace room. */
  subtitle: string | null;
  lobby: boolean;
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
}

export type DotTone = "running" | "idle" | "starting" | "warning" | "danger";

const ANSWERABLE_KINDS: ReadonlySet<string> = new Set(["tool", "mode", "other"]);

export function agentTitle(agent: OfficeAgent): string {
  const title = agent.title?.trim();
  return title ? title : `Agent ${agent.id.slice(0, 8)}`;
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

// Same order as server/directory.ts sortAgents; the fake office (Task 16) is not pre-sorted.
function byCreation(left: OfficeAgent, right: OfficeAgent): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function orderRows(
  agents: readonly OfficeAgent[],
  activity: Readonly<Record<string, string>>,
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
    const line = agent.status === "running" ? (activity[agent.id] ?? null) : null;
    rows.push({ agent, depth, activity: line });
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
  const byRoom = new Map<string, OfficeAgent[]>();
  const roomOfAgent = new Map<string, string>();
  for (const agent of agents.values()) {
    const known = agent.workspaceId !== null && workspaceIds.has(agent.workspaceId);
    const roomId = known && agent.workspaceId !== null ? agent.workspaceId : LOBBY;
    roomOfAgent.set(agent.id, roomId);
    byRoom.set(roomId, [...(byRoom.get(roomId) ?? []), agent]);
  }
  function room(id: string, name: string, subtitle: string | null, lobby: boolean): OfficeRoom {
    return {
      id,
      name,
      subtitle,
      lobby,
      rows: orderRows(byRoom.get(id) ?? [], state.activity),
      posts: visiblePosts(state.boards[id] ?? []),
    };
  }
  const rooms = [
    room(LOBBY, LOBBY_NAME, null, true),
    ...state.workspaces.map((workspace) =>
      room(workspace.id, workspace.name, workspace.projectName, false),
    ),
  ];
  return { rooms, attention: attentionList(agents.values(), roomOfAgent), agents, roomOfAgent };
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
