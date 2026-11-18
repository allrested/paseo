import type { Logger } from "pino";
import type { UsageReportEntry } from "@getpaseo/protocol/messages";
import { isDelegatedAgent } from "@getpaseo/protocol/agent-labels";
import { usageLevel, windowUsedPct, type UsageLevel } from "@getpaseo/protocol/usage-heads-up";

/** Just over the usage registry's five-minute cache, so every check reads a fresh report. */
export const USAGE_WATCH_INTERVAL_MS = 310_000;

/** A running agent whose account the watch reads. */
export interface WatchedAgent {
  id: string;
  provider: string;
  title: string | null;
}

/** One notification: an account window crossed 80% or 95%. */
export interface UsageNotice {
  agentId: string;
  provider: string;
  title: string;
  body: string;
}

export interface UsageWatchDeps {
  /** Agents that pass `isWatchedAgent`, with their stored titles. */
  runningAgents(): Promise<WatchedAgent[]>;
  /** The provider's label, which names its account in a notice. */
  providerLabel(providerId: string): string;
  usageEnabled(): boolean;
  /** The usage of the agent's own account and model, as its usage popover shows it. */
  listAgentUsage(agentId: string): Promise<UsageReportEntry[]>;
  notify(notice: UsageNotice): Promise<void>;
  logger: Pick<Logger, "info" | "warn">;
}

export interface CrossingTracker {
  /** The level this reading newly crossed, or null. */
  observe(input: { key: string; usedPct: number }): UsageLevel | null;
}

/**
 * The level each account window has crossed since its last reset. A reading below the last
 * level means the window reset, so it re-arms. The first reading after a daemon start counts.
 */
export function createCrossingTracker(): CrossingTracker {
  const levels = new Map<string, UsageLevel>();
  return {
    observe({ key, usedPct }) {
      const level = usageLevel(usedPct);
      const previous = levels.get(key) ?? 0;
      levels.set(key, level);
      return level > previous ? level : null;
    },
  };
}

export interface UsageWatch {
  /** Reads the account of each provider with a watched agent, and notifies new crossings. */
  check(): Promise<void>;
}

/** English, like every daemon notification: "Claude (work) 81% of Weekly" over "Fix login". */
function describeUsageNotice(input: {
  agent: WatchedAgent;
  account: string;
  windowLabel: string;
  usedPct: number;
}): UsageNotice {
  return {
    agentId: input.agent.id,
    provider: input.agent.provider,
    title: `${input.account} ${Math.round(input.usedPct)}% of ${input.windowLabel}`,
    body: input.agent.title?.trim() || "Agent",
  };
}

export function createUsageWatch(deps: UsageWatchDeps): UsageWatch {
  const crossings = createCrossingTracker();

  async function checkAccount(agent: WatchedAgent): Promise<void> {
    const reports = await deps.listAgentUsage(agent.id);
    for (const entry of reports) {
      if (entry.report.status !== "available") continue;
      for (const window of entry.report.windows) {
        const usedPct = windowUsedPct(window);
        if (usedPct === null) continue;
        const key = `${entry.id}\n${window.id}`;
        if (crossings.observe({ key, usedPct }) === null) continue;
        const notice = describeUsageNotice({
          agent,
          account: deps.providerLabel(agent.provider),
          windowLabel: window.label,
          usedPct,
        });
        await deps.notify(notice);
        deps.logger.info(
          { agentId: notice.agentId, provider: notice.provider, usedPct },
          "usage watch: notified",
        );
      }
    }
  }

  async function check(): Promise<void> {
    if (!deps.usageEnabled()) return;
    // One account per provider: the first running agent on it is the one the notice names.
    const firstByProvider = new Map<string, WatchedAgent>();
    for (const agent of await deps.runningAgents()) {
      if (!firstByProvider.has(agent.provider)) firstByProvider.set(agent.provider, agent);
    }
    for (const agent of firstByProvider.values()) {
      try {
        await checkAccount(agent);
      } catch (err) {
        deps.logger.warn({ err, provider: agent.provider }, "usage watch: check failed");
      }
    }
  }

  return { check };
}

/** What `isWatchedAgent` reads from a managed agent. */
export interface WatchCandidate {
  lifecycle: string;
  internal?: boolean;
  background?: boolean;
  workspaceId?: string;
  labels: Record<string, string>;
}

/**
 * The agents whose accounts are watched, mirroring the agent attention rules
 * (`AgentManager.broadcastAgentAttention` and `raisesAttention`): running, in a workspace, and
 * neither internal, background nor delegated.
 */
export function isWatchedAgent(agent: WatchCandidate): boolean {
  return (
    agent.lifecycle === "running" &&
    !agent.internal &&
    !agent.background &&
    Boolean(agent.workspaceId) &&
    !isDelegatedAgent(agent)
  );
}

export interface IntervalTimer {
  /** Calls `tick` every `ms` until the returned function is called. */
  every(input: { ms: number; tick: () => void }): () => void;
}

export const nodeIntervalTimer: IntervalTimer = {
  every({ ms, tick }) {
    const handle = setInterval(tick, ms);
    // The watch alone never keeps the daemon running.
    handle.unref();
    return () => clearInterval(handle);
  },
};

export interface StartUsageWatchInput {
  watch: UsageWatch;
  logger: Pick<Logger, "info" | "warn">;
  timer?: IntervalTimer;
  intervalMs?: number;
}

/** Runs the watch every interval and returns the function that stops it. */
export function startUsageWatch(input: StartUsageWatchInput): () => void {
  const intervalMs = input.intervalMs ?? USAGE_WATCH_INTERVAL_MS;
  const timer = input.timer ?? nodeIntervalTimer;
  let checking = false;
  function tick(): void {
    // A check still running skips this tick rather than piling up behind it.
    if (checking) return;
    checking = true;
    // Never rejects or throws: either would exit the daemon, whose uncaughtException and
    // unhandledRejection handlers in daemon-worker.ts end the process.
    void Promise.resolve()
      .then(() => input.watch.check())
      .catch((err: unknown) => {
        input.logger.warn({ err }, "usage watch: tick failed");
      })
      .finally(() => {
        checking = false;
      });
  }
  const stop = timer.every({ ms: intervalMs, tick });
  input.logger.info({ intervalMs }, "usage watch: started");
  return stop;
}
