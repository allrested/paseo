/**
 * Fork delta (usage heads-up): the thresholds the daemon's usage notifications step on.
 */

/** From this much usage of a window, the daemon notifies once. */
export const USAGE_HEADS_UP_PCT = 80;
/** From this much usage, the daemon notifies again. */
export const USAGE_DANGER_PCT = 95;

/** 0 below the heads-up, 1 from 80%, 2 from 95%. Notifications step on these. */
export type UsageLevel = 0 | 1 | 2;

/** The percentages a usage window may report. */
export interface UsageWindowPct {
  usedPct?: number | null;
  remainingPct?: number | null;
}

/** A window's used percent, derived from its remaining percent when that is all it reports. */
export function windowUsedPct(window: UsageWindowPct): number | null {
  if (typeof window.usedPct === "number") return window.usedPct;
  return typeof window.remainingPct === "number" ? 100 - window.remainingPct : null;
}

export function usageLevel(usedPct: number | null): UsageLevel {
  if (usedPct === null) return 0;
  if (usedPct >= USAGE_DANGER_PCT) return 2;
  if (usedPct >= USAGE_HEADS_UP_PCT) return 1;
  return 0;
}
