import type { UnavailableReason } from "../shared/run.js";

/** The fields of a Paseo agent snapshot this plugin reads. */
export interface AgentSnapshot {
  id: string;
  cwd: string;
  persistence: { sessionId: string } | null;
}

export interface AgentRef {
  refresh(): Promise<{ agent: AgentSnapshot } | null>;
}

/** The part of `paseo.agents` the handler uses; tests pass an in-memory one. */
export interface AgentDirectory {
  ref(agentId: string): AgentRef;
}

export type AgentFacts =
  | { kind: "claude"; sessionId: string; cwd: string }
  | { kind: "unavailable"; reason: UnavailableReason };

// The provider-subagent pane names its timeline
// `provider:${encodeURIComponent(parent)}:${encodeURIComponent(sub)}`
// (packages/app/src/panels/provider-subagent-panel.tsx), and the run belongs to the parent.
const PROVIDER_SUBAGENT_ID = /^provider:([^:]+):[^:]+$/;

/**
 * The agent that owns the run: the parent of a provider-subagent pane's id, else the id itself.
 * Null when the parent part is not valid percent-encoding.
 */
export function parentAgentId(agentId: string): string | null {
  const parent = PROVIDER_SUBAGENT_ID.exec(agentId)?.[1];
  if (parent === undefined) return agentId;
  try {
    return decodeURIComponent(parent);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

/**
 * The agent's Claude session id and cwd, from its snapshot; an archived agent still has one. A
 * snapshot read that throws rejects: that is a failed call, which the card retries on its next
 * poll, not a missing agent.
 */
export async function readAgentFacts(agents: AgentDirectory, agentId: string): Promise<AgentFacts> {
  const id = parentAgentId(agentId);
  if (id === null) return { kind: "unavailable", reason: "agent-not-found" };
  const agent = (await agents.ref(id).refresh())?.agent;
  // fetch_agent also resolves id prefixes and titles; only the agent with this exact id counts.
  if (agent?.id !== id) return { kind: "unavailable", reason: "agent-not-found" };
  const { persistence, cwd } = agent;
  if (persistence === null) return { kind: "unavailable", reason: "not-claude" };
  return { kind: "claude", sessionId: persistence.sessionId, cwd };
}
