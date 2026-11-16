import { isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { PluginServerContext, ScheduleCadence } from "@getpaseo/plugin/server";
import { errorMessage } from "./errors.js";

/** The daily schedule's name among the office's schedules, and the handler that answers it. */
export const NOTES_SCHEDULE = "standup-notes";
const NOTES_LABEL = "Stand-up notes";
/** 8:00, Sunday to Thursday: the KSA work week. */
const NOTES_CRON = "0 8 * * 0-4";

type Schedules = PluginServerContext["schedules"];

export interface NotesSettings {
  notesFolder: string;
  notesTimeZone: string;
}

/**
 * When the stand-up notes are written: null while no folder is set. A folder or a time zone of
 * only spaces counts as empty, and an empty time zone is the host's. A folder that is not an
 * absolute path throws, since the writer starts in it.
 */
export function notesCadence(values: NotesSettings, hostTimeZone: string): ScheduleCadence | null {
  const folder = values.notesFolder.trim();
  if (folder === "") return null;
  if (!isAbsolute(folder)) throw new Error(`The notes folder must be an absolute path: ${folder}`);
  const timezone = values.notesTimeZone.trim() || hostTimeZone;
  return { type: "cron", expression: NOTES_CRON, timezone };
}

/**
 * Brings the daemon's schedule in step with `cadence`: saves it, or removes it for null. A
 * schedule that is already so is left alone, since a save counts the next run again from now and
 * can move a run that is due. A time zone the daemon refuses rejects, and leaves the schedule as
 * it was.
 */
export async function syncNotesSchedule(
  schedules: Schedules,
  cadence: ScheduleCadence | null,
): Promise<void> {
  if (cadence === null) {
    await schedules.remove(NOTES_SCHEDULE);
    return;
  }
  // `list` leaves the label out; only this function saves the schedule, always with NOTES_LABEL.
  const kept = (await schedules.list()).find((schedule) => schedule.name === NOTES_SCHEDULE);
  if (kept?.handler === NOTES_SCHEDULE && isDeepStrictEqual(kept.cadence, cadence)) return;
  await schedules.upsert({
    name: NOTES_SCHEDULE,
    handler: NOTES_SCHEDULE,
    prompt: NOTES_LABEL,
    cadence,
  });
}

export interface NotesSchedulePorts {
  schedules: Schedules;
  hostTimeZone: string;
  log(message: string): void;
}

export interface NotesSchedule {
  /** Follows these settings. Never rejects: a failure is logged and kept for `error`. */
  sync(values: NotesSettings): Promise<void>;
  /** Why the schedule could not follow the settings; null once a later sync succeeds. */
  error(): string | null;
}

export function createNotesSchedule(ports: NotesSchedulePorts): NotesSchedule {
  let scheduleError: string | null = null;
  // One at a time, in order: a slow save must not land after a later one.
  let queue: Promise<void> = Promise.resolve();
  async function follow(values: NotesSettings): Promise<void> {
    try {
      await syncNotesSchedule(ports.schedules, notesCadence(values, ports.hostTimeZone));
      scheduleError = null;
    } catch (error) {
      scheduleError = errorMessage(error);
      ports.log(`[office] notes schedule failed: ${scheduleError}`);
    }
  }
  return {
    sync(values) {
      queue = queue.then(() => follow(values));
      return queue;
    },
    error: () => scheduleError,
  };
}
