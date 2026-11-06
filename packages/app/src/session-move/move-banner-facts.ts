import { getMovedFromAgentId } from "@getpaseo/protocol/agent-labels";
import type { Agent } from "@/stores/session-store";
import { findSessionAgent } from "./resolve-moved-agent";

type BannerAgent = Pick<Agent, "provider" | "archivedAt" | "labels" | "limitReached">;

interface BannerSession {
  agents: Map<string, BannerAgent>;
  agentDetails: Map<string, BannerAgent>;
}

/**
 * What the move banner needs to know about an agent. `inactive` is an agent that is not in the
 * session or is archived. The live variant stays flat, because the banner compares it shallowly.
 */
export type MoveBannerFacts =
  | { kind: "inactive" }
  | {
      kind: "live";
      provider: string;
      hasReachedLimit: boolean;
      movedFromAgentId: string | null;
      /** Null until the agent it was moved from is in the session. */
      movedFromProvider: string | null;
    };

const INACTIVE: MoveBannerFacts = { kind: "inactive" };

/** What the move banner needs to know about an agent, from the host's session. */
export function selectMoveBannerFacts(
  session: BannerSession | undefined,
  agentId: string,
): MoveBannerFacts {
  const agent = findSessionAgent(session, agentId);
  if (!agent || agent.archivedAt) return INACTIVE;
  const movedFromAgentId = getMovedFromAgentId(agent.labels);
  const movedFromAgent = movedFromAgentId ? findSessionAgent(session, movedFromAgentId) : null;
  return {
    kind: "live",
    provider: agent.provider,
    hasReachedLimit: Boolean(agent.limitReached),
    movedFromAgentId,
    movedFromProvider: movedFromAgent?.provider ?? null,
  };
}

/**
 * The agent this one was moved from when the session does not hold it yet, as after an app
 * restart, so the banner can fetch it for its label. Null when nothing needs fetching.
 */
export function selectMovedFromAgentToFetch(facts: MoveBannerFacts): string | null {
  if (facts.kind === "inactive" || facts.movedFromProvider !== null) return null;
  return facts.movedFromAgentId;
}
