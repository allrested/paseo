import type { PluginHandlerContext } from "@getpaseo/plugin/server";

// The slice of the in-process paseo client this plugin uses, so the search can be tested against
// a typed fake. agentsPort() adapts the real client; the compiler checks that it fits.

export interface AgentSummary {
  id: string;
  title: string | null;
  /** The provider session a closed runtime resumes from. */
  persistence?: { sessionId: string } | null;
  /** The session a running runtime is in; it differs from the stored one after a rewind. */
  runtimeInfo?: { sessionId: string | null };
}

export interface AgentListRequest {
  includeBackground: boolean;
  filter: { includeArchived: boolean; includeBackground: boolean };
  page: { limit: number; cursor?: string };
}

export interface AgentListPage {
  entries: { agent: AgentSummary }[];
  pageInfo: { nextCursor: string | null; hasMore: boolean };
}

export interface AgentsPort {
  list(request: AgentListRequest): Promise<AgentListPage>;
}

export interface SessionOwner {
  agentId: string;
  title: string | null;
}

// The daemon caps a page at 200 (FetchAgentsRequestMessageSchema, page.limit).
const PAGE_LIMIT = 200;

/**
 * The agent each provider session belongs to, archived and background agents included: a chat
 * the user archived is still a chat they may look for. Session ids are UUIDs, so no provider
 * check is needed to tell a Claude session from another provider's.
 */
export async function sessionOwners(agents: AgentsPort): Promise<Map<string, SessionOwner>> {
  const owners = new Map<string, SessionOwner>();
  let cursor: string | undefined;
  do {
    const page = await agents.list({
      includeBackground: true,
      filter: { includeArchived: true, includeBackground: true },
      page: { limit: PAGE_LIMIT, cursor },
    });
    for (const { agent } of page.entries) {
      const owner = { agentId: agent.id, title: agent.title };
      for (const sessionId of [agent.persistence?.sessionId, agent.runtimeInfo?.sessionId]) {
        if (sessionId) owners.set(sessionId, owner);
      }
    }
    const { hasMore, nextCursor } = page.pageInfo;
    cursor = hasMore && nextCursor !== null ? nextCursor : undefined;
  } while (cursor !== undefined);
  return owners;
}

export function agentsPort(paseo: PluginHandlerContext["paseo"]): AgentsPort {
  return { list: (request) => paseo.agents.list(request) };
}
