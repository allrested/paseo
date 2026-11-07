import type { TFunction } from "i18next";
import type { AgentMoveTarget } from "@getpaseo/protocol/messages";
import {
  chooseBestMoveTarget,
  msUntilRunOut,
  usageHeadsUpTone,
  usageLevel,
  type UsageLevel,
} from "@getpaseo/protocol/usage-heads-up";
import { formatPct } from "@/usage/format";
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

/** The level a heads-up was dismissed at, and the reset after which the dismissal ends. */
export interface UsageHeadsUpDismissal {
  level: UsageLevel;
  resetsAt: string | null;
}

/** Formats a time on the clock, or null for none or one that has passed. */
export type FormatClock = (iso: string | null) => string | null;

export interface UsageHeadsUpCopy {
  message: string;
  /** Null when no target has room. */
  moveLabel: string | null;
}

interface CopyOptions {
  t: TFunction;
  formatClock: FormatClock;
  locale?: string;
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

/** A dismissal holds until the window reaches a higher level or the reset it named passes. */
export function isUsageHeadsUpDismissed(input: {
  headsUp: UsageHeadsUp;
  dismissal: UsageHeadsUpDismissal | null;
  now: number;
}): boolean {
  const { headsUp, dismissal, now } = input;
  if (!dismissal) return false;
  if (dismissal.resetsAt !== null && Date.parse(dismissal.resetsAt) <= now) return false;
  return headsUp.level <= dismissal.level;
}

function describeFacts(headsUp: UsageHeadsUp, options: CopyOptions): string {
  const used = formatPct(headsUp.usedPct, options.locale);
  // Shown verbatim: sources name windows such as "Weekly · Fable", which no case rule survives.
  if (headsUp.windowLabel === null) {
    return options.t("sessionMove.headsUp.usage", { account: headsUp.account, used });
  }
  return options.t("sessionMove.headsUp.usageOfWindow", {
    account: headsUp.account,
    used,
    window: headsUp.windowLabel,
  });
}

function describeTiming(headsUp: UsageHeadsUp, options: CopyOptions): string | null {
  const runsOut = options.formatClock(headsUp.runsOutAt);
  const reset = options.formatClock(headsUp.resetsAt);
  if (runsOut && reset) return options.t("sessionMove.headsUp.runsOutResets", { runsOut, reset });
  if (runsOut) return options.t("sessionMove.headsUp.runsOut", { runsOut });
  if (reset) return options.t("sessionMove.headsUp.resets", { reset });
  return null;
}

function describeMove(best: AgentMoveTarget | null, options: CopyOptions): string | null {
  if (!best) return null;
  if (best.usedPct === null) return options.t("sessionMove.headsUp.moveTo", { label: best.label });
  return options.t("sessionMove.headsUp.moveToUsage", {
    label: best.label,
    used: formatPct(best.usedPct, options.locale),
  });
}

/** "Claude (work) 84% of Weekly · on pace to run out Thu 14:00, resets Fri 09:00". */
export function describeUsageHeadsUp(
  headsUp: UsageHeadsUp,
  options: CopyOptions,
): UsageHeadsUpCopy {
  const facts = describeFacts(headsUp, options);
  const timing = describeTiming(headsUp, options);
  return {
    message: timing ? options.t("sessionMove.headsUp.withTiming", { facts, timing }) : facts,
    moveLabel: describeMove(headsUp.best, options),
  };
}
