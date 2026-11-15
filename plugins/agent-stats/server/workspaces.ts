// The host's workspaces, for their names.
import type { KnownWorkspace } from "./stats.js";

// The daemon caps a page at 200 (FetchWorkspacesRequestMessageSchema, page.limit).
const PAGE_LIMIT = 200;

interface WorkspacePage {
  entries: ReadonlyArray<{ id: string; name: string; archivingAt?: string | null }>;
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}

export type ListWorkspaces = (request: {
  page: { limit: number; cursor?: string };
}) => Promise<WorkspacePage>;

/** Every workspace that can still be opened. */
export async function listWorkspaces(list: ListWorkspaces): Promise<KnownWorkspace[]> {
  const known: KnownWorkspace[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ page: { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) } });
    for (const workspace of page.entries) {
      if (!workspace.archivingAt) known.push({ id: workspace.id, name: workspace.name });
    }
    cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return known;
}
