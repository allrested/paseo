// The host's hours added up into what the screen shows: the reader's days, the workspaces, and
// the totals of a range.
import type { Stats } from "../shared/contracts.js";
import { hourOf, hourStart } from "../shared/hours.js";

/** How moments fall into days where the reader is. */
export interface Zone {
  /** The day a moment is in: "2026-11-15". */
  dayOf(ms: number): string;
  /** When the day `back` days before the day of `ms` begins. */
  dayStart(ms: number, back: number): number;
}

const two = (value: number) => String(value).padStart(2, "0");

/** The device's own time zone, daylight saving included. */
export const LOCAL: Zone = {
  dayOf(ms) {
    const date = new Date(ms);
    return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  },
  dayStart(ms, back) {
    const date = new Date(ms);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - back).getTime();
  },
};

export interface Count {
  turns: number;
  failed: number;
  workMs: number;
}

export interface DayCount extends Count {
  /** "2026-11-15". */
  day: string;
}

export interface WorkspaceCount extends Count {
  id: string;
  name: string;
  /** False for a workspace that is gone: there is nothing to open. */
  open: boolean;
}

export interface Summary {
  /** Every day of the range, oldest first, the days nothing happened too. */
  days: DayCount[];
  /** The workspaces with a turn or time in the range, the most time first. */
  workspaces: WorkspaceCount[];
  total: Count;
}

/** The hour to ask the host from, for a range of `days` that ends today. */
export function sinceHour(days: number, nowMs: number, zone: Zone = LOCAL): string {
  return hourOf(zone.dayStart(nowMs, days - 1));
}

const NO_COUNT: Count = { turns: 0, failed: 0, workMs: 0 };

function add(into: Count, from: Count): void {
  into.turns += from.turns;
  into.failed += from.failed;
  into.workMs += from.workMs;
}

/** What happened in the `range` days that end today. */
export function summarize(
  stats: Pick<Stats, "hours" | "workspaces">,
  range: number,
  nowMs: number,
  zone: Zone = LOCAL,
): Summary {
  const days = new Map<string, DayCount>();
  for (let back = range - 1; back >= 0; back -= 1) {
    const day = zone.dayOf(zone.dayStart(nowMs, back));
    days.set(day, { day, ...NO_COUNT });
  }
  const names = new Map(stats.workspaces.map((workspace) => [workspace.id, workspace]));
  const workspaces = new Map<string, WorkspaceCount>();
  const total: Count = { ...NO_COUNT };
  for (const hour of stats.hours) {
    // An hour is in the day it begins in.
    const day = days.get(zone.dayOf(hourStart(hour.hour)));
    if (!day) continue;
    add(day, hour);
    add(total, hour);
    const id = hour.workspaceId ?? "";
    let workspace = workspaces.get(id);
    if (!workspace) {
      const known = names.get(id);
      workspace = { id, name: known?.name ?? id, open: known?.open ?? false, ...NO_COUNT };
      workspaces.set(id, workspace);
    }
    add(workspace, hour);
  }
  return {
    days: [...days.values()],
    workspaces: [...workspaces.values()].toSorted(
      (a, b) => b.workMs - a.workMs || b.turns - a.turns || a.name.localeCompare(b.name),
    ),
    total,
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Round steps for a scale of time, the smallest first. */
const STEPS = [
  MINUTE,
  2 * MINUTE,
  5 * MINUTE,
  10 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  4 * HOUR,
  6 * HOUR,
  12 * HOUR,
  24 * HOUR,
];
/** A scale has this many steps at most above zero. */
const MOST_STEPS = 4;

export interface Scale {
  /** The top of the scale: the first round step at or above the largest value. */
  top: number;
  /** The lines of the scale, from zero to the top. */
  ticks: number[];
}

/** A scale of round times that holds `largest`. */
export function scaleFor(largest: number): Scale {
  const fits = (step: number) => largest <= step * MOST_STEPS;
  // Past the list, whole days: as many as it takes.
  const step = STEPS.find(fits) ?? 24 * HOUR * Math.ceil(largest / (MOST_STEPS * 24 * HOUR));
  const count = Math.max(1, Math.ceil(largest / step));
  return {
    top: count * step,
    ticks: Array.from({ length: count + 1 }, (_, index) => index * step),
  };
}
