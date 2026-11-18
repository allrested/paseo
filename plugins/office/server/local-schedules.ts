import { errorMessage } from "./errors.js";
import type { Clock } from "./timers.js";

/** When one of the office's schedules runs: at a wall-clock time on some weekdays, or at an interval. */
export type OfficeCadence =
  | { type: "cron"; expression: string; timezone: string }
  | { type: "every"; everyMs: number };

export interface OfficeScheduleInput {
  /** Picks the schedule among the office's own. */
  name: string;
  /** The `handle` name that answers the schedule when it is due. */
  handler: string;
  /** A label for the schedule. */
  prompt: string;
  cadence: OfficeCadence;
}

export interface OfficeScheduleEntry {
  id: string;
  name: string;
  handler: string;
  cadence: OfficeCadence;
  nextRunAt: string | null;
}

/** The office's schedules, as its followers use them. */
export interface OfficeSchedules {
  upsert(input: OfficeScheduleInput): Promise<{ id: string; nextRunAt: string | null }>;
  /** Resolves `false` when there is no schedule of that name. */
  remove(name: string): Promise<boolean>;
  list(): Promise<OfficeScheduleEntry[]>;
}

export interface LocalSchedules extends OfficeSchedules {
  /**
   * Answers a due schedule that names `handler`, given the instant it was due (a run can start
   * late). Returns a function that stops answering.
   */
  handle(handler: string, run: (dueAt: number) => Promise<void>): () => void;
  /** Cancels every timer. */
  stop(): void;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zoneFormat(timezone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
  } catch {
    throw new Error(`Unknown time zone: ${timezone}`);
  }
}

function wallClock(format: Intl.DateTimeFormat, at: number): WallClock {
  const parts = format.formatToParts(new Date(at));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

/** The instant a wall-clock time falls on in the zone. Two passes of correction, for a change of offset. */
function instantOf(format: Intl.DateTimeFormat, wall: WallClock): number {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  let guess = asUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = wallClock(format, guess);
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess += asUtc - seenAsUtc;
  }
  return guess;
}

function weekdaysOf(field: string, expression: string): ReadonlySet<number> {
  if (field === "*") return new Set([0, 1, 2, 3, 4, 5, 6]);
  const days = new Set<number>();
  for (const piece of field.split(",")) {
    const range = /^([0-6])(?:-([0-6]))?$/.exec(piece);
    if (!range) throw new Error(`Unsupported schedule expression: ${expression}`);
    const from = Number(range[1]);
    const to = range[2] === undefined ? from : Number(range[2]);
    if (to < from) throw new Error(`Unsupported schedule expression: ${expression}`);
    for (let day = from; day <= to; day += 1) days.add(day);
  }
  return days;
}

/**
 * The next run of `minute hour * * weekdays` in a time zone, after an instant. The office keeps
 * its own schedules (stock Paseo has none for plugins) and reads only this shape: a fixed minute
 * and hour, every month and day of the month, and weekdays as `*`, a day, a range or a list.
 */
export function nextCronRun(expression: string, timezone: string, after: number): number {
  const fields = expression.trim().split(/\s+/);
  const [minuteField, hourField, dayOfMonth, month, weekdayField] = fields;
  const fixed = /^\d{1,2}$/;
  if (
    fields.length !== 5 ||
    !fixed.test(minuteField ?? "") ||
    !fixed.test(hourField ?? "") ||
    dayOfMonth !== "*" ||
    month !== "*"
  ) {
    throw new Error(`Unsupported schedule expression: ${expression}`);
  }
  const minute = Number(minuteField);
  const hour = Number(hourField);
  if (minute > 59 || hour > 23) throw new Error(`Unsupported schedule expression: ${expression}`);
  const weekdays = weekdaysOf(weekdayField ?? "", expression);
  const format = zoneFormat(timezone);
  const today = wallClock(format, after);
  // Eight days cover a week of weekdays and the day the search starts on.
  for (let ahead = 0; ahead <= 8; ahead += 1) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + ahead));
    if (!weekdays.has(date.getUTCDay())) continue;
    const run = instantOf(format, {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour,
      minute,
    });
    if (run > after) return run;
  }
  throw new Error(`Unsupported schedule expression: ${expression}`);
}

function nextRun(cadence: OfficeCadence, after: number): number {
  if (cadence.type === "every") return after + cadence.everyMs;
  return nextCronRun(cadence.expression, cadence.timezone, after);
}

interface Kept {
  input: OfficeScheduleInput;
  nextRunAt: number;
  cancel(): void;
}

/**
 * The office's schedules, kept by the office: a timer per schedule, set again after each run.
 * Nothing is stored: the office saves its schedules again from its settings each time it starts,
 * and a run that fell due while the daemon was down is not made up.
 */
export function createLocalSchedules(ports: {
  clock: Clock;
  log(message: string): void;
}): LocalSchedules {
  const kept = new Map<string, Kept>();
  const handlers = new Map<string, (dueAt: number) => Promise<void>>();
  const running = new Set<string>();
  // The schedules whose run in flight has had a skip logged: one line per stuck run.
  const skipLogged = new Set<string>();
  let stopped = false;

  function arm(input: OfficeScheduleInput, at: number): Kept {
    const delay = Math.max(0, at - ports.clock.now());
    const entry: Kept = {
      input,
      nextRunAt: at,
      cancel: ports.clock.setTimeout(() => void due(input.name), delay),
    };
    kept.set(input.name, entry);
    return entry;
  }

  async function due(name: string): Promise<void> {
    const entry = kept.get(name);
    if (!entry) return;
    const dueAt = entry.nextRunAt;
    // Set for the run after first, so a slow or failing handler never stops the schedule. A timer
    // can fire a little before its time, so the run after counts from the time it was set for.
    try {
      arm(entry.input, nextRun(entry.input.cadence, Math.max(ports.clock.now(), entry.nextRunAt)));
    } catch (error) {
      kept.delete(name);
      ports.log(`[office] ${name} schedule stopped: ${errorMessage(error)}`);
    }
    const run = handlers.get(entry.input.handler);
    if (!run) return;
    // One run of a schedule at a time: a slow one is not joined by the next, or by a queue of them.
    if (running.has(name)) {
      if (!skipLogged.has(name)) {
        skipLogged.add(name);
        ports.log(`[office] ${name} run skipped: the last one has not ended`);
      }
      return;
    }
    running.add(name);
    skipLogged.delete(name);
    try {
      await run(dueAt);
    } catch (error) {
      ports.log(`[office] ${name} run failed: ${errorMessage(error)}`);
    } finally {
      running.delete(name);
    }
  }

  return {
    async upsert(input) {
      if (stopped) throw new Error("The office's schedules have stopped");
      const { cadence } = input;
      if (
        cadence.type === "every" &&
        !(Number.isFinite(cadence.everyMs) && cadence.everyMs >= 1000)
      ) {
        throw new Error(`An interval must be at least 1000 ms: ${cadence.everyMs}`);
      }
      // Worked out before anything changes: a refused cadence leaves the kept schedule as it was.
      const at = nextRun(input.cadence, ports.clock.now());
      kept.get(input.name)?.cancel();
      arm(input, at);
      return { id: input.name, nextRunAt: new Date(at).toISOString() };
    },
    async remove(name) {
      const entry = kept.get(name);
      if (!entry) return false;
      entry.cancel();
      kept.delete(name);
      return true;
    },
    async list() {
      return [...kept.values()].map((entry) => ({
        id: entry.input.name,
        name: entry.input.name,
        handler: entry.input.handler,
        cadence: entry.input.cadence,
        nextRunAt: new Date(entry.nextRunAt).toISOString(),
      }));
    },
    handle(handler, run) {
      handlers.set(handler, run);
      return () => {
        if (handlers.get(handler) === run) handlers.delete(handler);
      };
    },
    stop() {
      stopped = true;
      for (const entry of kept.values()) entry.cancel();
      kept.clear();
    },
  };
}
