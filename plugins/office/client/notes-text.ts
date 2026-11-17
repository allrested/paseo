import type { NotesState } from "../shared/contracts.js";

/** A stopped writer's line starts so; a reason that already says it is shown on its own. */
const STOPPED = "The writer stopped";

/** The calendar day of `at` in the zone, in a form only compared. */
function dayIn(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** 24-hour "HH:MM" of `at` in the zone; h23 so midnight is 00, not 24. */
function timeIn(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

/**
 * The Stand-up card's line; null with no folder. A writer at work comes first, then one that
 * stopped or could not start (a kept reason is always newer than the last write), then today's
 * entry. "Today" is `now`'s day in `timeZone`.
 */
export function notesLine(
  state: NotesState | undefined,
  now: number,
  timeZone: string,
): string | null {
  if (state === undefined || !state.folderSet) return null;
  if (state.writing) return "Writing today's entry…";
  const { failedAgentId, problem, writtenAt } = state;
  if (failedAgentId !== null) {
    if (problem === null) return STOPPED;
    return problem.startsWith(STOPPED) ? problem : `${STOPPED}: ${problem}`;
  }
  // No writer of the office stopped: the folder, the settings or the start itself was refused.
  if (problem !== null) return `The writer could not start: ${problem}`;
  if (writtenAt !== null && dayIn(writtenAt, timeZone) === dayIn(now, timeZone)) {
    return `Today's entry written at ${timeIn(writtenAt, timeZone)}`;
  }
  return "No entry today yet";
}

/** Splits a month's text before its newest entry: the last "## " header at the start of a line. */
export function splitNewest(text: string): { before: string; newest: string } {
  // The Contents list is a "## " header too, but it comes first.
  let start = 0;
  for (const header of text.matchAll(/^## /gm)) start = header.index;
  return { before: text.slice(0, start), newest: text.slice(start) };
}

/** "202611" -> "November 2026". */
export function monthTitle(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(4, 6)) - 1;
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(Date.UTC(year, index, 1));
}

/**
 * The zone the line's "today" is judged in: the notes time zone when the setting names one, else
 * this device's. The settings keep a zone the 8:00 schedule refused, which counts as none here.
 */
export function todayZone(setting: string): string {
  const zone = setting.trim();
  if (zone !== "") {
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: zone }).resolvedOptions().timeZone;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
