import type { Logger } from "pino";
import type { UsageReportEntry } from "@getpaseo/protocol/messages";
import { windowUsedPct } from "@getpaseo/protocol/usage-heads-up";
import type { AgentManager } from "../agent-manager.js";
import { isUsageLimitError } from "./limit-matcher.js";

export interface UsageLimitFallbackDeps {
  agentManager: Pick<AgentManager, "subscribe" | "getAgent" | "setLimitReached">;
  usageEnabled(): boolean;
  /** A fresh read of the usage windows of the agent's own account. */
  listAgentUsage(agentId: string): Promise<UsageReportEntry[]>;
  now(): Date;
  logger: Pick<Logger, "warn">;
}

function hasSpentWindow(reports: readonly UsageReportEntry[]): boolean {
  return reports.some(
    (entry) =>
      entry.report.status === "available" &&
      entry.report.windows.some((window) => (windowUsedPct(window) ?? 0) >= 100),
  );
}

/**
 * Sets `limitReached` when a turn fails on an error the limit matcher does not know and the
 * agent's account has a window at 100%. The matcher reads English error text, so a provider that
 * words its limit differently would otherwise never offer the move.
 */
export function startUsageLimitFallback(deps: UsageLimitFallbackDeps): () => void {
  async function check(agentId: string, error: string): Promise<void> {
    if (!deps.usageEnabled()) return;
    if (!hasSpentWindow(await deps.listAgentUsage(agentId))) return;
    // The read takes a while: a turn that ran since then owns the agent's state.
    const agent = deps.agentManager.getAgent(agentId);
    if (!agent || agent.lastError !== error || agent.limitReached) return;
    await deps.agentManager.setLimitReached(agentId, {
      at: deps.now().toISOString(),
      message: error,
    });
  }

  return deps.agentManager.subscribe(
    (event) => {
      if (event.type !== "agent_stream" || event.event.type !== "turn_failed") return;
      const error = event.event.error;
      // The agent manager already flagged a failure the matcher knows.
      if (isUsageLimitError(error)) return;
      check(event.agentId, error).catch((err: unknown) => {
        deps.logger.warn({ err, agentId: event.agentId }, "usage limit fallback: check failed");
      });
    },
    { replayState: false },
  );
}
