import { usedPercent } from "./model";
import type { UsageTone, UsageWindow } from "./types";

/** The source's tone for a window, or one derived from how much of it is used. */
export function windowTone(window: UsageWindow): UsageTone {
  if (window.tone) return window.tone;
  const usedPct = usedPercent(window);
  if (usedPct == null) return "default";
  return usedPctTone(usedPct);
}

// Fork delta (session move): shared with the move dialog's usage badge.
export function usedPctTone(usedPct: number): UsageTone {
  if (usedPct > 90) return "danger";
  if (usedPct >= 70) return "warning";
  return "default";
}
