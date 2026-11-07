import type { ProviderUsageWindow } from "@getpaseo/protocol/messages";
import { windowUsedPct } from "@getpaseo/protocol/usage-heads-up";

/** Samples older than this are dropped, and a window idle this long is forgotten. */
export const PACE_SAMPLE_MS = 2 * 60 * 60_000;
/** The oldest and newest sample must be this far apart before they give a rate. */
export const PACE_MIN_SPAN_MS = 10 * 60_000;

interface PaceSample {
  at: number;
  usedPct: number;
}

export interface UsagePaceTracker {
  /**
   * Records the window's usage as fetched at `at`. Returns the window with `runsOutAt` and
   * `shortfallPct` filled in when the source left `runsOutAt` empty and the pace runs the window
   * out before it resets; otherwise returns it unchanged.
   */
  project(input: { key: string; window: ProviderUsageWindow; at: number }): ProviderUsageWindow;
  /** Drops the samples of every key that starts with `prefix`. */
  forget(prefix: string): void;
}

function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Fork delta (usage heads-up): projects when a window runs out from how fast its usage rose over
 * the last two hours. A drop in usage means the window reset, so its samples start over.
 */
// ponytail: one map entry per account window; an entry idle for PACE_SAMPLE_MS is pruned.
export function createUsagePace(): UsagePaceTracker {
  const samples = new Map<string, PaceSample[]>();

  function prune(at: number): void {
    for (const [key, kept] of samples) {
      const newest = kept[kept.length - 1];
      if (!newest || at - newest.at > PACE_SAMPLE_MS) samples.delete(key);
    }
  }

  /** The window's samples with this one added, or null when a newer sample is already in. */
  function record(key: string, sample: PaceSample): PaceSample[] | null {
    const kept = (samples.get(key) ?? []).filter((old) => sample.at - old.at <= PACE_SAMPLE_MS);
    const newest = kept[kept.length - 1];
    if (newest && sample.at <= newest.at) return null;
    const next = newest && sample.usedPct < newest.usedPct ? [sample] : [...kept, sample];
    samples.set(key, next);
    return next;
  }

  return {
    project({ key, window, at }) {
      prune(at);
      const usedPct = windowUsedPct(window);
      if (usedPct === null) return window;
      const kept = record(key, { at, usedPct });
      if (kept === null || window.runsOutAt != null) return window;
      const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
      if (!Number.isFinite(resetsAt) || usedPct >= 100) return window;
      const oldest = kept[0];
      const newest = kept[kept.length - 1];
      if (!oldest || !newest || newest.at - oldest.at < PACE_MIN_SPAN_MS) return window;
      const ratePerMs = (newest.usedPct - oldest.usedPct) / (newest.at - oldest.at);
      if (ratePerMs <= 0) return window;
      // Usage is reported to the minute at best, so the run-out is kept to the second.
      const runsOut = Math.round((at + (100 - usedPct) / ratePerMs) / 1000) * 1000;
      if (runsOut >= resetsAt) return window;
      return {
        ...window,
        runsOutAt: new Date(runsOut).toISOString(),
        shortfallPct: window.shortfallPct ?? roundPct(usedPct + ratePerMs * (resetsAt - at) - 100),
      };
    },
    forget(prefix) {
      for (const key of samples.keys()) if (key.startsWith(prefix)) samples.delete(key);
    },
  };
}
