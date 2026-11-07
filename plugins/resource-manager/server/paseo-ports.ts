import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  isClosableStatus,
  LiveStatusSchema,
  type CloseAgentResult,
  type LiveStatus,
} from "../shared/rpc.js";

// The slice of the in-process paseo client this plugin uses, so the logic can be tested against
// typed fakes. paseoPorts() adapts the real client; the compiler checks that it fits.

export interface AgentSummary {
  id: string;
  title: string | null;
  provider: string;
  status: string;
  updatedAt: string;
  /** The provider session a closed runtime resumes from; null when there is none. */
  persistence: { sessionId: string } | null;
}

export interface PageInfo {
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PageRequest {
  limit: number;
  cursor?: string;
}

export interface AgentListRequest {
  includeBackground: boolean;
  filter: { statuses: LiveStatus[]; includeBackground: boolean };
  page: PageRequest;
}

export interface AgentListPage {
  entries: { agent: AgentSummary }[];
  pageInfo: PageInfo;
}

export interface AgentHandlePort {
  refresh(): Promise<{ agent: AgentSummary } | null>;
  closeRuntime(): Promise<void>;
}

export interface AgentsPort {
  list(request: AgentListRequest): Promise<AgentListPage>;
  ref(agentId: string): AgentHandlePort;
}

export interface WorkspaceSummary {
  projectRootPath: string;
  workspaceDirectory?: string;
}

export interface WorkspaceListRequest {
  page: PageRequest;
}

export interface WorkspaceListPage {
  entries: WorkspaceSummary[];
  pageInfo: PageInfo;
}

export interface WorkspacesPort {
  list(request: WorkspaceListRequest): Promise<WorkspaceListPage>;
}

export interface PaseoPorts {
  agents: AgentsPort;
  workspaces: WorkspacesPort;
}

export interface LiveAgent {
  id: string;
  title: string | null;
  provider: string;
  status: LiveStatus;
  updatedAt: string;
}

// The daemon caps a page at 200 (FetchAgentsRequestMessageSchema, page.limit).
const PAGE_LIMIT = 200;
const LIVE_STATUSES: LiveStatus[] = Object.values(LiveStatusSchema.enum);

function nextCursor(pageInfo: PageInfo): string | undefined {
  if (!pageInfo.hasMore || pageInfo.nextCursor === null) return undefined;
  return pageInfo.nextCursor;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Every agent whose runtime may hold processes, background agents included. A status outside
// the live set is dropped even if the daemon returns it.
export async function listLiveAgents(agents: AgentsPort): Promise<LiveAgent[]> {
  const live: LiveAgent[] = [];
  let cursor: string | undefined;
  do {
    const page = await agents.list({
      includeBackground: true,
      filter: { statuses: LIVE_STATUSES, includeBackground: true },
      page: { limit: PAGE_LIMIT, cursor },
    });
    for (const { agent } of page.entries) {
      const status = LiveStatusSchema.safeParse(agent.status);
      if (!status.success) continue;
      live.push({
        id: agent.id,
        title: agent.title,
        provider: agent.provider,
        status: status.data,
        updatedAt: agent.updatedAt,
      });
    }
    cursor = nextCursor(page.pageInfo);
  } while (cursor !== undefined);
  return live;
}

// The directory each workspace runs in: the worktree for a worktree workspace, else the project
// root. Claude's local-scope config and .mcp.json are keyed by that directory.
export async function listWorkspaceDirectories(workspaces: WorkspacesPort): Promise<string[]> {
  const directories = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await workspaces.list({ page: { limit: PAGE_LIMIT, cursor } });
    for (const workspace of page.entries) {
      directories.add(workspace.workspaceDirectory ?? workspace.projectRootPath);
    }
    cursor = nextCursor(page.pageInfo);
  } while (cursor !== undefined);
  return [...directories];
}

// Re-reads the agent so a stale screen cannot close a busy or errored one. "closed" is already
// done. An agent without a persistence handle stays open: its next prompt would start a new
// provider session instead of resuming (agent-loading.ts ensureAgentLoaded), which is also why
// idle collection skips it (AgentManager.getRuntimeCleanupCandidates). The daemon repeats these
// checks and asks the provider about background work (AgentManager.closeRuntimeIfIdle);
// closeRuntime() rejects with its reason. Never rejects: an error comes back as the message.
export async function closeIdleAgent(
  agents: AgentsPort,
  agentId: string,
): Promise<CloseAgentResult> {
  try {
    const handle = agents.ref(agentId);
    const snapshot = await handle.refresh();
    if (snapshot === null) return { ok: false, error: "Agent not found" };
    const { status, persistence } = snapshot.agent;
    if (status === "closed") return { ok: true, error: null };
    if (!isClosableStatus(status)) {
      return { ok: false, error: "Agent is busy; close it once it is idle" };
    }
    if (persistence === null) {
      return { ok: false, error: "This agent has no saved session to resume, so it stays open" };
    }
    await handle.closeRuntime();
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export function paseoPorts(paseo: PluginHandlerContext["paseo"]): PaseoPorts {
  return {
    agents: {
      list: (request) => paseo.agents.list(request),
      ref: (agentId) => paseo.agents.ref(agentId),
    },
    workspaces: {
      list: (request) => paseo.workspaces.list(request),
    },
  };
}
