import {
  AgentStatusSchema,
  PermissionKindSchema,
  type OfficeAgent,
  type OfficeWorkspace,
  type PermissionKind,
} from "../shared/contracts.js";

// PARENT_AGENT_ID_LABEL in packages/protocol/src/agent-labels.ts. Server code may import the
// protocol's types, not its values.
export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";

export interface DirectoryPermissionInput {
  id: string;
  name: string;
  kind: string;
  title?: string;
}

/** The fields the office reads from an agent snapshot (AgentSnapshotPayload satisfies it). */
export interface DirectoryAgentInput {
  id: string;
  title: string | null;
  provider: string;
  model: string | null;
  status: string;
  workspaceId?: string;
  createdAt: string;
  labels?: Readonly<Record<string, string>>;
  pendingPermissions: readonly DirectoryPermissionInput[];
  archivedAt?: string | null;
  internal?: boolean;
  background?: boolean;
}

export type AgentUpdateInput =
  | { kind: "upsert"; agent: DirectoryAgentInput }
  | { kind: "remove"; agentId: string };

/** The fields the office reads from a workspace descriptor. */
export interface DirectoryWorkspaceInput {
  id: string;
  name: string;
  projectDisplayName: string;
  archivingAt?: string | null;
}

export type WorkspaceUpdateInput =
  | { kind: "upsert"; workspace: DirectoryWorkspaceInput }
  | { kind: "remove"; id: string };

function permissionKind(kind: string): PermissionKind {
  const parsed = PermissionKindSchema.safeParse(kind);
  return parsed.success ? parsed.data : "other";
}

/** The office's view of an agent, or null when the office does not show it. */
export function projectAgent(agent: DirectoryAgentInput): OfficeAgent | null {
  if (agent.internal === true || agent.background === true || agent.archivedAt) return null;
  const status = AgentStatusSchema.safeParse(agent.status);
  if (!status.success || status.data === "closed") return null;
  const parent = agent.labels?.[PARENT_AGENT_ID_LABEL]?.trim() ?? "";
  return {
    id: agent.id,
    title: agent.title,
    provider: agent.provider,
    model: agent.model,
    status: status.data,
    workspaceId: agent.workspaceId ?? null,
    parentAgentId: parent === "" ? null : parent,
    permissions: agent.pendingPermissions.map((request) => ({
      id: request.id,
      kind: permissionKind(request.kind),
      title: request.title ?? request.name,
    })),
    createdAt: agent.createdAt,
  };
}

export function agentsFromSnapshot(
  agents: readonly DirectoryAgentInput[],
): Map<string, OfficeAgent> {
  const map = new Map<string, OfficeAgent>();
  for (const agent of agents) {
    const projected = projectAgent(agent);
    if (projected) map.set(projected.id, projected);
  }
  return map;
}

export function applyAgentUpdate(
  agents: ReadonlyMap<string, OfficeAgent>,
  update: AgentUpdateInput,
): Map<string, OfficeAgent> {
  const next = new Map(agents);
  if (update.kind === "remove") {
    next.delete(update.agentId);
    return next;
  }
  const projected = projectAgent(update.agent);
  if (projected) next.set(projected.id, projected);
  else next.delete(update.agent.id);
  return next;
}

export function projectWorkspace(workspace: DirectoryWorkspaceInput): OfficeWorkspace | null {
  if (workspace.archivingAt) return null;
  return { id: workspace.id, name: workspace.name, projectName: workspace.projectDisplayName };
}

export function workspacesFromSnapshot(
  workspaces: readonly DirectoryWorkspaceInput[],
): Map<string, OfficeWorkspace> {
  const map = new Map<string, OfficeWorkspace>();
  for (const workspace of workspaces) {
    const projected = projectWorkspace(workspace);
    if (projected) map.set(projected.id, projected);
  }
  return map;
}

export function applyWorkspaceUpdate(
  workspaces: ReadonlyMap<string, OfficeWorkspace>,
  update: WorkspaceUpdateInput,
): Map<string, OfficeWorkspace> {
  const next = new Map(workspaces);
  if (update.kind === "remove") {
    next.delete(update.id);
    return next;
  }
  const projected = projectWorkspace(update.workspace);
  if (projected) next.set(projected.id, projected);
  else next.delete(update.workspace.id);
  return next;
}

export function sortAgents(agents: Iterable<OfficeAgent>): OfficeAgent[] {
  return [...agents].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

export function sortWorkspaces(workspaces: Iterable<OfficeWorkspace>): OfficeWorkspace[] {
  return [...workspaces].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.projectName.localeCompare(right.projectName) ||
      left.id.localeCompare(right.id),
  );
}
