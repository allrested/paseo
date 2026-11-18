import type {
  OfficeScheduleEntry,
  OfficeScheduleInput,
  OfficeSchedules,
} from "./local-schedules.js";

// Test helper, as fake-clock.ts is: nothing imports it from index.server.ts, so it is not in the
// bundle.
export interface FakeSchedules extends OfficeSchedules {
  upserted: OfficeScheduleInput[];
  removed: string[];
  /** Makes each later upsert reject with this error; null lets them through again. */
  upsertRejects(error: Error | null): void;
  /** Holds the next upsert until the returned function is called. */
  holdNextUpsert(): () => void;
}

/** The daemon's store of the office's schedules, by name. */
export function fakeSchedules(kept: OfficeScheduleEntry[] = []): FakeSchedules {
  const stored = new Map(kept.map((schedule) => [schedule.name, schedule]));
  const upserted: OfficeScheduleInput[] = [];
  const removed: string[] = [];
  let refusal: Error | null = null;
  let gate: Promise<void> | null = null;
  return {
    upserted,
    removed,
    upsertRejects(error) {
      refusal = error;
    },
    holdNextUpsert() {
      let release: () => void = () => undefined;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    async upsert(input) {
      const held = gate;
      gate = null;
      if (held) await held;
      if (refusal) throw refusal;
      upserted.push(input);
      stored.set(input.name, {
        id: `id-${input.name}`,
        name: input.name,
        handler: input.handler,
        cadence: input.cadence,
        nextRunAt: "2026-11-18T05:00:00.000Z",
      });
      return { id: `id-${input.name}`, nextRunAt: "2026-11-18T05:00:00.000Z" };
    },
    async remove(name) {
      removed.push(name);
      return stored.delete(name);
    },
    async list() {
      return [...stored.values()];
    },
  };
}
