// The agents in a turn, as the host lists them: for the turns that began before the feed
// listened to the turn hooks.
import type { RunningAgent } from "../shared/contracts.js";

// The daemon caps a page at 200 (FetchAgentsRequestMessageSchema, page.limit).
const PAGE_LIMIT = 200;

interface ListedAgent {
  id: string;
  title: string | null;
  cwd: string;
}

interface AgentPage {
  entries: ReadonlyArray<{ agent: ListedAgent }>;
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}

export type ListAgents = (request: {
  filter: { statuses: Array<"running"> };
  page: { limit: number; cursor?: string };
}) => Promise<AgentPage>;

/**
 * The agents that run now. Helpers are not listed unless asked for, so none is here. The host
 * does not keep when a turn began, so none has a start.
 */
export async function listRunning(list: ListAgents): Promise<RunningAgent[]> {
  const running: RunningAgent[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({
      filter: { statuses: ["running"] },
      page: { limit: PAGE_LIMIT, cursor },
    });
    for (const { agent } of page.entries) {
      running.push({
        agentId: agent.id,
        title: agent.title,
        folder: agent.cwd,
        since: null,
      });
    }
    const { hasMore, nextCursor } = page.pageInfo;
    cursor = hasMore && nextCursor !== null ? nextCursor : undefined;
  } while (cursor !== undefined);
  return running;
}
