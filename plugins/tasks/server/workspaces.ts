import {
  TASK_ID,
  TASK_KEY,
  TASK_URL,
  type LinkedWorkspace,
  type LinkedWorkspaces,
} from "../shared/contracts.js";

// The daemon caps a page at 200 (FetchWorkspacesRequestMessageSchema, page.limit).
const PAGE_LIMIT = 200;
const JIRA_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

/** The slice of the Paseo API's workspace list this reads. */
export interface WorkspaceListPage {
  entries: ReadonlyArray<{
    id: string;
    name: string;
    metadata?: Readonly<Record<string, unknown>>;
    archivingAt?: string | null;
  }>;
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}
export type ListWorkspaces = (request: {
  page: { limit: number; cursor?: string };
}) => Promise<WorkspaceListPage>;

/**
 * The task a workspace names. One made before the id was kept has only the key: a Jira key is
 * the issue's id, and GitLab's holds the project's path where its API wants the project's number.
 */
function taskId(metadata: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const id = metadata[TASK_ID];
  if (typeof id === "string" && id !== "") return id;
  return JIRA_KEY.test(key) ? `jira:${key.toUpperCase()}` : undefined;
}

/** The host's workspaces and which of them were started on a task, before anyone asked how the task stands. */
export async function linkedWorkspaces(list: ListWorkspaces): Promise<LinkedWorkspaces> {
  const workspaceIds: string[] = [];
  const linked: LinkedWorkspace[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ page: { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) } });
    for (const workspace of page.entries) {
      workspaceIds.push(workspace.id);
      const metadata = workspace.metadata ?? {};
      const key = metadata[TASK_KEY];
      if (typeof key !== "string" || key === "" || workspace.archivingAt) continue;
      const url = metadata[TASK_URL];
      const id = taskId(metadata, key);
      linked.push({
        workspaceId: workspace.id,
        name: workspace.name,
        key,
        url: typeof url === "string" ? url : "",
        ...(id === undefined ? {} : { taskId: id }),
      });
    }
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return { workspaceIds, linked };
}
