/**
 * Fork delta (usage heads-up): the thresholds and rules that the daemon's usage notifications and
 * the app's heads-up notice share, so both step at the same levels.
 */

/** From this much usage of a window, the agent screen warns and the daemon notifies once. */
export const USAGE_HEADS_UP_PCT = 80;
/** From this much usage, the warning turns to danger and the daemon notifies again. */
export const USAGE_DANGER_PCT = 95;
/** An account at or past this much usage cannot take another turn. */
export const USAGE_FULL_PCT = 100;
/** A projected run-out this close warns, at any usage. */
export const RUN_OUT_HEADS_UP_MS = 3 * 60 * 60_000;
/** A projected run-out this close is danger, at any usage. */
export const RUN_OUT_DANGER_MS = 30 * 60_000;

/** 0 below the heads-up, 1 from 80%, 2 from 95%. Notifications and dismissals step on these. */
export type UsageLevel = 0 | 1 | 2;

export type UsageHeadsUpTone = "none" | "warning" | "danger";

/** What the rules read from one usage window. */
export interface UsagePace {
  usedPct: number | null;
  resetsAt: string | null;
  runsOutAt: string | null;
}

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

/**
 * Milliseconds until the window runs out at its current pace: null without a run-out or when the
 * run-out comes at or after the reset, and 0 once it has passed.
 */
export function msUntilRunOut(pace: UsagePace, now: number): number | null {
  if (pace.runsOutAt === null) return null;
  const runsOut = Date.parse(pace.runsOutAt);
  if (!Number.isFinite(runsOut)) return null;
  if (pace.resetsAt !== null) {
    const resets = Date.parse(pace.resetsAt);
    if (Number.isFinite(resets) && runsOut >= resets) return null;
  }
  return Math.max(0, runsOut - now);
}

/** Warning from 80% or a run-out within 3 hours; danger from 95% or a run-out within 30 minutes. */
export function usageHeadsUpTone(pace: UsagePace, now: number): UsageHeadsUpTone {
  const level = usageLevel(pace.usedPct);
  const runOutMs = msUntilRunOut(pace, now);
  if (level === 2 || (runOutMs !== null && runOutMs <= RUN_OUT_DANGER_MS)) return "danger";
  if (level === 1 || (runOutMs !== null && runOutMs <= RUN_OUT_HEADS_UP_MS)) return "warning";
  return "none";
}

/** What the tightest-window choice reads from a window: `UsagePace` as a source reports it. */
export interface UsageWindowPace extends UsageWindowPct {
  resetsAt?: string | null;
  runsOutAt?: string | null;
}

/** The tightest window and the values the choice judged it by. */
export interface TightestWindow<W extends UsageWindowPace> {
  window: W;
  usedPct: number;
  resetsAt: string | null;
  /** The window's run-out, kept only while it comes before the reset. */
  runsOutAt: string | null;
  tone: UsageHeadsUpTone;
}

const TONE_RANK: Record<UsageHeadsUpTone, number> = { none: 0, warning: 1, danger: 2 };

/**
 * The window closest to running out at `now`: the nearer heads-up first, then the fuller window,
 * then the sooner run-out, and the first of a full tie. Below any heads-up this is the fullest
 * window. Windows without a used share are skipped; null when none has one.
 */
export function chooseTightestWindow<W extends UsageWindowPace>(
  windows: readonly W[],
  now: number,
): TightestWindow<W> | null {
  let tightest: TightestWindow<W> | null = null;
  for (const window of windows) {
    const judged = judgeWindow(window, now);
    if (judged !== null && (tightest === null || isTighter(judged, tightest))) tightest = judged;
  }
  return tightest;
}

function judgeWindow<W extends UsageWindowPace>(window: W, now: number): TightestWindow<W> | null {
  const usedPct = windowUsedPct(window);
  if (usedPct === null) return null;
  const pace: UsagePace = {
    usedPct,
    resetsAt: window.resetsAt ?? null,
    runsOutAt: window.runsOutAt ?? null,
  };
  return {
    window,
    usedPct,
    resetsAt: pace.resetsAt,
    runsOutAt: msUntilRunOut(pace, now) === null ? null : pace.runsOutAt,
    tone: usageHeadsUpTone(pace, now),
  };
}

function runOutTime(window: TightestWindow<UsageWindowPace>): number {
  return window.runsOutAt === null ? Number.POSITIVE_INFINITY : Date.parse(window.runsOutAt);
}

function isTighter(
  candidate: TightestWindow<UsageWindowPace>,
  tightest: TightestWindow<UsageWindowPace>,
): boolean {
  if (candidate.tone !== tightest.tone) return TONE_RANK[candidate.tone] > TONE_RANK[tightest.tone];
  if (candidate.usedPct !== tightest.usedPct) return candidate.usedPct > tightest.usedPct;
  return runOutTime(candidate) < runOutTime(tightest);
}

/** What the best-target choice reads from a move target. */
export interface MoveTargetUsage {
  provider: string;
  family: string;
  available: boolean;
  current: boolean;
  usedPct: number | null;
  /** When the tightest window runs out at its pace, kept only while that comes before its reset. */
  runsOutAt?: string | null;
}

/**
 * Where a one-click move goes: the available target with the lowest usage, ties going to the
 * current account's family because that move is native. A target on pace to run out before its
 * reset comes after every one that is not, and a target with unknown usage after every known one.
 * A target has room below the current account's usage; an account on pace to run out also has room
 * on any target that is not and is below the heads-up level. Null when no target has room.
 */
export function chooseBestMoveTarget<T extends MoveTargetUsage>(targets: readonly T[]): T | null {
  const current = targets.find((target) => target.current) ?? null;
  let best: T | null = null;
  for (const candidate of targets) {
    if (!hasRoom({ candidate, current })) continue;
    if (best === null || ranksBefore({ candidate, best, family: current?.family ?? null })) {
      best = candidate;
    }
  }
  return best;
}

/** Whether the target's tightest window is on pace to run out before it resets. */
function isOnPace(target: MoveTargetUsage): boolean {
  return (target.runsOutAt ?? null) !== null;
}

function hasRoom(input: { candidate: MoveTargetUsage; current: MoveTargetUsage | null }): boolean {
  const { candidate, current } = input;
  if (!candidate.available || candidate.current) return false;
  if (candidate.usedPct === null) return true;
  if (candidate.usedPct >= USAGE_FULL_PCT) return false;
  if (current === null || current.usedPct === null) return true;
  // An account on pace to run out gains from a steady target below the heads-up level.
  if (isOnPace(current) && !isOnPace(candidate) && candidate.usedPct < USAGE_HEADS_UP_PCT) {
    return true;
  }
  // Otherwise a move to an account at least as used as the current one gains nothing.
  return candidate.usedPct < current.usedPct;
}

function ranksBefore(input: {
  candidate: MoveTargetUsage;
  best: MoveTargetUsage;
  family: string | null;
}): boolean {
  const { candidate, best, family } = input;
  // Known usage before unknown; between known ones, steady before on pace, then lower usage.
  if ((candidate.usedPct === null) !== (best.usedPct === null)) return best.usedPct === null;
  if (candidate.usedPct !== null && best.usedPct !== null) {
    if (isOnPace(candidate) !== isOnPace(best)) return isOnPace(best);
    if (candidate.usedPct !== best.usedPct) return candidate.usedPct < best.usedPct;
  }
  return family !== null && candidate.family === family && best.family !== family;
}
