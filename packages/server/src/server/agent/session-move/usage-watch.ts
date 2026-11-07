import type { Logger } from "pino";
import { isDelegatedAgent } from "@getpaseo/protocol/agent-labels";
import {
  chooseBestMoveTarget,
  usageLevel,
  windowUsedPct,
  type UsageLevel,
} from "@getpaseo/protocol/usage-heads-up";
import type { ProviderLaunchInfo } from "../provider-snapshot-manager.js";
import type { ListUsageReportsForScope } from "./list-move-targets.js";
import type { MoveTarget } from "./move-targets.js";

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
  launchInfo(providerId: string): ProviderLaunchInfo | null;
  usageEnabled(): boolean;
  /** Null when no plugin runtime reports usage. */
  listUsageReportsForScope: ListUsageReportsForScope | null;
  listMoveTargets(agentId: string): Promise<MoveTarget[]>;
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

function describeMove(best: MoveTarget | null): string | null {
  if (!best) return null;
  if (best.usedPct === null) return `Move to ${best.label}`;
  return `Move to ${best.label} · ${Math.round(best.usedPct)}%`;
}

/**
 * English, like every daemon notification: "Claude (work) 81% of Weekly" over
 * "Fix login · Move to Claude · 12%".
 */
function describeUsageNotice(input: {
  agent: WatchedAgent;
  account: string;
  windowLabel: string;
  usedPct: number;
  best: MoveTarget | null;
}): UsageNotice {
  const agentName = input.agent.title?.trim() || "Agent";
  const move = describeMove(input.best);
  return {
    agentId: input.agent.id,
    provider: input.agent.provider,
    title: `${input.account} ${Math.round(input.usedPct)}% of ${input.windowLabel}`,
    body: move ? `${agentName} · ${move}` : agentName,
  };
}

export function createUsageWatch(deps: UsageWatchDeps): UsageWatch {
  const crossings = createCrossingTracker();

  async function notifyCrossing(input: {
    agent: WatchedAgent;
    account: string;
    windowLabel: string;
    usedPct: number;
  }): Promise<void> {
    const targets = await deps
      .listMoveTargets(input.agent.id)
      .catch((err: unknown): MoveTarget[] => {
        deps.logger.warn({ err, agentId: input.agent.id }, "usage watch: move targets failed");
        return [];
      });
    const notice = describeUsageNotice({ ...input, best: chooseBestMoveTarget(targets) });
    await deps.notify(notice);
    deps.logger.info(
      { agentId: notice.agentId, provider: notice.provider, usedPct: input.usedPct },
      "usage watch: notified",
    );
  }

  async function checkAccount(agent: WatchedAgent): Promise<void> {
    const info = deps.launchInfo(agent.provider);
    const listReports = deps.listUsageReportsForScope;
    if (!info || !listReports) return;
    // Agents run the family CLI with the profile env, as the move targets read it.
    const reports = await listReports({ provider: info.family, env: info.env });
    for (const entry of reports) {
      if (entry.report.status !== "available") continue;
      for (const window of entry.report.windows) {
        const usedPct = windowUsedPct(window);
        if (usedPct === null) continue;
        const key = `${entry.id}\n${window.id}`;
        if (crossings.observe({ key, usedPct }) === null) continue;
        await notifyCrossing({ agent, account: info.label, windowLabel: window.label, usedPct });
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
