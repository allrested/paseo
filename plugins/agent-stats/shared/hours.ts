// Time cut into hours of the clock, UTC. The host counts by the hour and a client adds the hours
// up into its own days, so a day is the reader's day wherever the host runs.
import { KEEP_DAYS } from "./contracts.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The hour a moment is in: "2026-11-15T11". */
export function hourOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 13);
}

/** When an hour begins. */
export function hourStart(hour: string): number {
  return Date.parse(`${hour}:00:00.000Z`);
}

/** A stretch of time as its share of each hour it touches, in order. */
export function spread(startMs: number, endMs: number): Array<{ hour: string; ms: number }> {
  const parts: Array<{ hour: string; ms: number }> = [];
  let from = startMs;
  while (from < endMs) {
    const next = Math.min(endMs, Math.floor(from / HOUR_MS) * HOUR_MS + HOUR_MS);
    parts.push({ hour: hourOf(from), ms: next - from });
    from = next;
  }
  return parts;
}

/** The oldest hour kept at `nowMs`. */
export function oldestKept(nowMs: number): string {
  return hourOf(nowMs - KEEP_DAYS * DAY_MS);
}
