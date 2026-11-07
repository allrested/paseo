import type {
  AgentHandlePort,
  AgentListPage,
  AgentListRequest,
  AgentsPort,
  AgentSummary,
  PageRequest,
  WorkspaceListPage,
  WorkspaceListRequest,
  WorkspacesPort,
  WorkspaceSummary,
} from "./paseo-ports.js";

// Typed in-memory stand-ins for the paseo client, for tests. Cursors are entry indexes. Like a
// daemon that ignores the status filter, FakeAgents returns every snapshot, so tests also cover
// the client-side live filter.

function pageOf<Entry>(items: readonly Entry[], page: PageRequest, pageSize: number) {
  const start = page.cursor === undefined ? 0 : Number(page.cursor);
  const end = start + Math.min(pageSize, page.limit);
  const hasMore = end < items.length;
  return {
    entries: items.slice(start, end),
    pageInfo: { nextCursor: hasMore ? String(end) : null, hasMore },
  };
}

export class FakeAgents implements AgentsPort {
  readonly requests: AgentListRequest[] = [];
  readonly closed: string[] = [];
  listError: Error | null = null;
  refreshError: Error | null = null;
  closeError: Error | null = null;
  private readonly snapshots: AgentSummary[];
  private readonly pageSize: number;

  constructor(snapshots: AgentSummary[], pageSize = 200) {
    this.snapshots = snapshots;
    this.pageSize = pageSize;
  }

  list(request: AgentListRequest): Promise<AgentListPage> {
    this.requests.push(request);
    if (this.listError !== null) return Promise.reject(this.listError);
    const page = pageOf(this.snapshots, request.page, this.pageSize);
    return Promise.resolve({
      entries: page.entries.map((agent) => ({ agent })),
      pageInfo: page.pageInfo,
    });
  }

  ref(agentId: string): AgentHandlePort {
    return {
      refresh: () => this.refresh(agentId),
      closeRuntime: () => this.closeRuntime(agentId),
    };
  }

  private refresh(agentId: string): Promise<{ agent: AgentSummary } | null> {
    if (this.refreshError !== null) return Promise.reject(this.refreshError);
    const agent = this.snapshots.find((candidate) => candidate.id === agentId);
    return Promise.resolve(agent === undefined ? null : { agent: { ...agent } });
  }

  private closeRuntime(agentId: string): Promise<void> {
    if (this.closeError !== null) return Promise.reject(this.closeError);
    this.closed.push(agentId);
    const agent = this.snapshots.find((candidate) => candidate.id === agentId);
    if (agent !== undefined) agent.status = "closed";
    return Promise.resolve();
  }
}

export class FakeWorkspaces implements WorkspacesPort {
  readonly requests: WorkspaceListRequest[] = [];
  listError: Error | null = null;
  private readonly workspaces: WorkspaceSummary[];
  private readonly pageSize: number;

  constructor(workspaces: WorkspaceSummary[], pageSize = 200) {
    this.workspaces = workspaces;
    this.pageSize = pageSize;
  }

  list(request: WorkspaceListRequest): Promise<WorkspaceListPage> {
    this.requests.push(request);
    if (this.listError !== null) return Promise.reject(this.listError);
    return Promise.resolve(pageOf(this.workspaces, request.page, this.pageSize));
  }
}
