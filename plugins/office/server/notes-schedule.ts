import { isAbsolute } from "node:path";
import type { OfficeCadence, OfficeSchedules } from "./local-schedules.js";
import { createScheduleFollower, type OfficeSchedule, syncSchedule } from "./schedule-follower.js";

/** The daily schedule's name among the office's schedules, and the handler that answers it. */
export const NOTES_SCHEDULE = "standup-notes";
const NOTES: OfficeSchedule = { name: NOTES_SCHEDULE, label: "Stand-up notes", logName: "notes" };
/** 8:00, Sunday to Thursday: the KSA work week. */
const NOTES_CRON = "0 8 * * 0-4";

export interface NotesSettings {
  notesFolder: string;
  notesTimeZone: string;
}

/**
 * The notes folder: null while none is set, and a folder of only spaces counts as none. A folder
 * that is not an absolute path throws, since the writer starts in it.
 */
export function notesFolder(values: NotesSettings): string | null {
  const folder = values.notesFolder.trim();
  if (folder === "") return null;
  if (!isAbsolute(folder)) throw new Error(`The notes folder must be an absolute path: ${folder}`);
  return folder;
}

/** The zone of the 8:00 run and of the entry's day: the settings', or the host's when empty. */
export function notesTimeZone(values: NotesSettings, hostTimeZone: string): string {
  return values.notesTimeZone.trim() || hostTimeZone;
}

/** An instant's date in a zone, as YYYY-MM-DD. */
function zoneDate(at: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: string) => parts.find((piece) => piece.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * The two days when a notes run due at `dueAt` could only start on a later day in the notes'
 * zone; null when it starts on the day it was due. The writer writes the day it starts on, so a
 * late run would write the wrong day's entry.
 */
export function lateNotesRun(
  dueAt: number,
  startAt: number,
  timeZone: string,
): { dueDay: string; startDay: string } | null {
  const dueDay = zoneDate(dueAt, timeZone);
  const startDay = zoneDate(startAt, timeZone);
  return dueDay === startDay ? null : { dueDay, startDay };
}

/** When the stand-up notes are written: null while no folder is set. */
export function notesCadence(values: NotesSettings, hostTimeZone: string): OfficeCadence | null {
  if (notesFolder(values) === null) return null;
  return { type: "cron", expression: NOTES_CRON, timezone: notesTimeZone(values, hostTimeZone) };
}

/**
 * Brings the office's schedule in step with `cadence`, as `syncSchedule` does. A time zone the
 * office refuses rejects, and leaves the schedule as it was.
 */
export function syncNotesSchedule(
  schedules: OfficeSchedules,
  cadence: OfficeCadence | null,
): Promise<void> {
  return syncSchedule(schedules, NOTES, cadence);
}

export interface NotesSchedulePorts {
  schedules: OfficeSchedules;
  hostTimeZone: string;
  log(message: string): void;
}

export interface NotesSchedule {
  /** Follows these settings. Never rejects: a failure is logged and kept for `error`. */
  sync(values: NotesSettings): Promise<void>;
  /** Why the schedule could not follow the settings; null once a later sync succeeds. */
  error(): string | null;
  /** Keeps a reason found outside a sync until a sync succeeds. */
  fail(message: string): void;
}

export function createNotesSchedule(ports: NotesSchedulePorts): NotesSchedule {
  const follower = createScheduleFollower({
    schedules: ports.schedules,
    schedule: NOTES,
    log: ports.log,
  });
  return {
    // A folder that is not an absolute path fails in turn, as a refused save does.
    sync: (values) => follower.sync(() => notesCadence(values, ports.hostTimeZone)),
    error: follower.error,
    fail: follower.fail,
  };
}
