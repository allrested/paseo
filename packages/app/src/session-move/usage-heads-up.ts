import type { AgentMoveTarget } from "@getpaseo/protocol/messages";
import {
  chooseBestMoveTarget,
  msUntilRunOut,
  usageHeadsUpTone,
  usageLevel,
  type UsageLevel,
} from "@getpaseo/protocol/usage-heads-up";
import { findCurrentTarget, type AgentMoveTargetsView } from "./move-targets";

/** A warning about the agent's own account before it runs out. */
export interface UsageHeadsUp {
  /** The account window it is about; a dismissal holds for every agent on that window. */
  windowKey: string;
  account: string;
  usedPct: number;
  windowLabel: string | null;
  resetsAt: string | null;
  /** Only while the run-out comes before the reset. */
  runsOutAt: string | null;
  tone: "warning" | "danger";
  level: UsageLevel;
  /** Where the one-click Move goes; null when no target has room. */
  best: AgentMoveTarget | null;
}

/** The level and tone a heads-up was dismissed at, and the reset after which the dismissal ends. */
export interface UsageHeadsUpDismissal {
  level: UsageLevel;
  tone: "warning" | "danger";
  resetsAt: string | null;
}

/**
 * The heads-up for the agent's own account: from 80%, or below it when the account is on pace to
 * run out within 3 hours and before it resets. Null otherwise and until the targets load.
 */
export function resolveUsageHeadsUp(
  targets: AgentMoveTargetsView,
  now: number,
): UsageHeadsUp | null {
  if (targets.kind !== "ready") return null;
  const current = findCurrentTarget(targets);
  if (!current || current.usedPct === null) return null;
  const pace = {
    usedPct: current.usedPct,
    resetsAt: current.resetsAt,
    runsOutAt: current.runsOutAt ?? null,
  };
  const tone = usageHeadsUpTone(pace, now);
  if (tone === "none") return null;
  return {
    windowKey: `${current.provider}\n${current.windowLabel ?? ""}`,
    account: current.label,
    usedPct: current.usedPct,
    windowLabel: current.windowLabel ?? null,
    resetsAt: current.resetsAt,
    runsOutAt: msUntilRunOut(pace, now) === null ? null : pace.runsOutAt,
    tone,
    level: usageLevel(current.usedPct),
    best: chooseBestMoveTarget(targets.targets),
  };
}

/**
 * A dismissal holds until the window reaches a higher level, a dismissed warning turns to danger,
 * or the reset it named passes.
 */
export function isUsageHeadsUpDismissed(input: {
  headsUp: UsageHeadsUp;
  dismissal: UsageHeadsUpDismissal | null;
  now: number;
}): boolean {
  const { headsUp, dismissal, now } = input;
  if (!dismissal) return false;
  if (dismissal.resetsAt !== null && Date.parse(dismissal.resetsAt) <= now) return false;
  if (headsUp.tone === "danger" && dismissal.tone === "warning") return false;
  return headsUp.level <= dismissal.level;
}
