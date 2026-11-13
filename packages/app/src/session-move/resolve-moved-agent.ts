import { getMovedToAgentId } from "@getpaseo/protocol/agent-labels";
import type { Agent } from "@/stores/session-store";

export type MovableAgent = Pick<Agent, "id" | "archivedAt" | "labels">;

interface AgentMaps<T> {
  agents: Map<string, T>;
  agentDetails: Map<string, T>;
}

/**
 * An agent of a host session by id. Archived agents are not in the active directory (`agents`);
 * the ones fetched for an open tab live in `agentDetails`.
 */
export function findSessionAgent<T>(session: AgentMaps<T> | undefined, agentId: string): T | null {
  return session?.agents.get(agentId) ?? session?.agentDetails.get(agentId) ?? null;
}

/** Whether the session holds the agent as archived. An agent it does not hold yet counts as live. */
export function isSessionAgentArchived(
  session: AgentMaps<Pick<Agent, "archivedAt">> | undefined,
  agentId: string,
): boolean {
  return Boolean(findSessionAgent(session, agentId)?.archivedAt);
}

function readMovedToAgentId(agent: MovableAgent | null): string | null {
  return agent?.archivedAt ? getMovedToAgentId(agent.labels) : null;
}

/**
 * Follows paseo.moved-to-agent-id from an archived agent to the live one; null if not moved.
 * A client that was away during the move holds no record of the archived agent, so for an agent
 * `getAgent` does not know, `findLiveSuccessor` names the live agent that was moved from it.
 */
export function resolveMovedAgentId(
  agentId: string,
  getAgent: (id: string) => MovableAgent | null,
  findLiveSuccessor?: (id: string) => string | null,
): string | null {
  const nextOf = (id: string): string | null => {
    const agent = getAgent(id);
    return agent ? readMovedToAgentId(agent) : (findLiveSuccessor?.(id) ?? null);
  };
  const seen = new Set<string>([agentId]);
  let next = nextOf(agentId);
  let resolved: string | null = null;
  while (next) {
    if (seen.has(next)) return null;
    seen.add(next);
    resolved = next;
    next = nextOf(next);
  }
  return resolved;
}
