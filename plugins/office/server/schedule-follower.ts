import { isDeepStrictEqual } from "node:util";
import { errorMessage } from "./errors.js";
import type { OfficeCadence, OfficeSchedules } from "./local-schedules.js";

/** One of the office's schedules. */
export interface OfficeSchedule {
  /** Its name among the office's schedules, and the handler that answers it. */
  name: string;
  label: string;
  /** What a failure's log line calls it: `[office] <logName> schedule failed: …`. */
  logName: string;
}

/**
 * Brings the office's schedule in step with `cadence`: saves it, or removes it for null. A
 * schedule that is already so is left alone, since a save counts the next run again from now and
 * can move a run that is due.
 */
export async function syncSchedule(
  schedules: OfficeSchedules,
  schedule: OfficeSchedule,
  cadence: OfficeCadence | null,
): Promise<void> {
  if (cadence === null) {
    await schedules.remove(schedule.name);
    return;
  }
  // `list` leaves the label out; only this function saves the schedule, always with its label.
  const kept = (await schedules.list()).find((saved) => saved.name === schedule.name);
  if (kept?.handler === schedule.name && isDeepStrictEqual(kept.cadence, cadence)) return;
  await schedules.upsert({
    name: schedule.name,
    handler: schedule.name,
    prompt: schedule.label,
    cadence,
  });
}

export interface ScheduleFollowerPorts {
  schedules: OfficeSchedules;
  schedule: OfficeSchedule;
  log(message: string): void;
}

export interface ScheduleFollower {
  /**
   * Follows the cadence `cadence()` gives, worked out in turn, so it may throw like a refused
   * save. Never rejects: a failure is logged and kept for `error`.
   */
  sync(cadence: () => OfficeCadence | null): Promise<void>;
  /** Why the schedule could not follow; null once a later sync succeeds. */
  error(): string | null;
  /** Keeps a reason found outside a sync (settings that cannot be read) until a sync succeeds. */
  fail(message: string): void;
}

export function createScheduleFollower(ports: ScheduleFollowerPorts): ScheduleFollower {
  let scheduleError: string | null = null;
  // One at a time, in order: a slow save must not land after a later one.
  let queue: Promise<void> = Promise.resolve();
  async function follow(cadence: () => OfficeCadence | null): Promise<void> {
    try {
      await syncSchedule(ports.schedules, ports.schedule, cadence());
      scheduleError = null;
    } catch (error) {
      scheduleError = errorMessage(error);
      ports.log(`[office] ${ports.schedule.logName} schedule failed: ${scheduleError}`);
    }
  }
  return {
    sync(cadence) {
      queue = queue.then(() => follow(cadence));
      return queue;
    },
    error: () => scheduleError,
    fail(message) {
      scheduleError = message;
    },
  };
}
