// The Stats screen's words.
import type { Count, DayCount, WorkspaceCount } from "./aggregate.js";

const MINUTE = 60_000;
const NUMBER = new Intl.NumberFormat("en-US");

/** "1,204": a count with its thousands apart. */
export function counted(value: number): string {
  return NUMBER.format(value);
}

/** "3 h 12 min": a length of time to the minute. */
export function duration(ms: number): string {
  const minutes = Math.round(ms / MINUTE);
  if (minutes === 0) return ms > 0 ? "under 1 min" : "0 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${counted(hours)} h` : `${counted(hours)} h ${rest} min`;
}

/** A length of time as a headline: to the minute under ten hours, to the hour from there. */
export function headline(ms: number): string {
  const hours = ms / (60 * MINUTE);
  return hours < 10 ? duration(ms) : `${counted(Math.round(hours))} h`;
}

/** A line of the time scale: "0", "30 min", "2 h". */
export function tickLabel(ms: number): string {
  return ms === 0 ? "0" : duration(ms);
}

export function turnsLabel(turns: number): string {
  return `${counted(turns)} ${turns === 1 ? "turn" : "turns"}`;
}

// A day is a date without a time, so it is formatted as the UTC day of the same name.
const dayDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const LONG = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

/** "Sun, Nov 15". */
export function dayLabel(day: string): string {
  return LONG.format(dayDate(day));
}

/** "Nov 15". */
export function shortDay(day: string): string {
  return SHORT.format(dayDate(day));
}

/** "Sun". */
export function weekday(day: string): string {
  return WEEKDAY.format(dayDate(day));
}

/** "3 h 12 min · 41 turns · 2 failed": what a day or a workspace did. */
export function countLine(count: Count): string {
  const failed = count.failed === 0 ? "" : ` · ${counted(count.failed)} failed`;
  return `${duration(count.workMs)} · ${turnsLabel(count.turns)}${failed}`;
}

/** A day's numbers in one line, as the chart reads them out. */
export function dayReadout(day: DayCount): string {
  return `${dayLabel(day.day)} · ${countLine(day)}`;
}

/** A workspace's row read aloud; `opens` when a press opens the workspace. */
export function workspaceLabel(workspace: WorkspaceCount, opens: boolean): string {
  const line = `${workspace.name}: ${countLine(workspace)}`;
  return opens ? `${line}. Open the workspace` : line;
}

/** "7 days". */
export function rangeLabel(days: number): string {
  return `${days} days`;
}

/** What the screen says when a range holds nothing. */
export function emptyLabel(days: number): string {
  return `No turns in the last ${days} days.`;
}

/** Said when the host began to count inside the range: the range's first days are not zeros. */
export function sinceNote(day: string): string {
  return `Counting since ${shortDay(day)}. Turns before that are not known.`;
}

/** The days under the chart that carry a label: all of a week, else five spread evenly. */
export function axisDays(days: readonly DayCount[]): string[] {
  if (days.length <= 7) return days.map((day) => weekday(day.day));
  const last = days.length - 1;
  return [0, 1, 2, 3, 4].map((step) => shortDay(days[Math.round((step * last) / 4)].day));
}
