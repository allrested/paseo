import type { PluginSchedule, PluginScheduleInput, PluginSchedules } from "@getpaseo/plugin/server";
import { expect, test } from "vitest";
import {
  createNotesSchedule,
  NOTES_SCHEDULE,
  notesCadence,
  syncNotesSchedule,
} from "./notes-schedule.js";

interface FakeSchedules extends PluginSchedules {
  upserted: PluginScheduleInput[];
  removed: string[];
  /** Makes each later upsert reject with this error; null lets them through again. */
  upsertRejects(error: Error | null): void;
  /** Holds the next upsert until the returned function is called. */
  holdNextUpsert(): () => void;
}

/** The daemon's store of the office's schedules, by name. */
function fakeSchedules(kept: PluginSchedule[] = []): FakeSchedules {
  const stored = new Map(kept.map((schedule) => [schedule.name, schedule]));
  const upserted: PluginScheduleInput[] = [];
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

const RIYADH_EIGHT = { type: "cron", expression: "0 8 * * 0-4", timezone: "Asia/Riyadh" } as const;

test("no folder, no schedule", () => {
  expect(notesCadence({ notesFolder: "", notesTimeZone: "" }, "Asia/Riyadh")).toBeNull();
});

test("8:00 Sunday to Thursday in the chosen zone, else the host's", () => {
  expect(notesCadence({ notesFolder: "/n", notesTimeZone: "" }, "Asia/Riyadh")).toEqual({
    type: "cron",
    expression: "0 8 * * 0-4",
    timezone: "Asia/Riyadh",
  });
  expect(
    notesCadence({ notesFolder: "/n", notesTimeZone: "Europe/Berlin" }, "Asia/Riyadh"),
  ).toMatchObject({ timezone: "Europe/Berlin" });
});

test("a folder of spaces is no folder, and a zone of spaces is the host's", () => {
  expect(notesCadence({ notesFolder: "  ", notesTimeZone: "" }, "Asia/Riyadh")).toBeNull();
  expect(notesCadence({ notesFolder: " /n ", notesTimeZone: " " }, "Asia/Riyadh")).toEqual(
    RIYADH_EIGHT,
  );
  expect(
    notesCadence({ notesFolder: "/n", notesTimeZone: " Europe/Berlin " }, "Asia/Riyadh"),
  ).toMatchObject({ timezone: "Europe/Berlin" });
});

test("a folder that is not an absolute path is refused", () => {
  expect(() => notesCadence({ notesFolder: "docs", notesTimeZone: "" }, "Asia/Riyadh")).toThrow(
    "The notes folder must be an absolute path: docs",
  );
});

test("a set folder saves the schedule under its name, with its handler and label", async () => {
  const fake = fakeSchedules();
  await syncNotesSchedule(fake, RIYADH_EIGHT);
  expect(fake.upserted).toEqual([
    {
      name: NOTES_SCHEDULE,
      handler: NOTES_SCHEDULE,
      prompt: "Stand-up notes",
      cadence: RIYADH_EIGHT,
    },
  ]);
  expect(NOTES_SCHEDULE).toBe("standup-notes");
});

test("a schedule that is already so is not saved again, so its next run does not move", async () => {
  const fake = fakeSchedules([
    {
      id: "s1",
      name: NOTES_SCHEDULE,
      handler: NOTES_SCHEDULE,
      cadence: { ...RIYADH_EIGHT },
      nextRunAt: "2026-11-18T05:00:00.000Z",
    },
  ]);
  await syncNotesSchedule(fake, RIYADH_EIGHT);
  expect(fake.upserted).toEqual([]);

  const berlin = { ...RIYADH_EIGHT, timezone: "Europe/Berlin" };
  await syncNotesSchedule(fake, berlin);
  expect(fake.upserted.map((input) => input.cadence)).toEqual([berlin]);
});

test("a cleared folder removes the schedule", async () => {
  const fake = fakeSchedules();
  await syncNotesSchedule(fake, null);
  expect(fake.removed).toEqual(["standup-notes"]);
});

test("an invalid time zone is an error from the save", async () => {
  const fake = fakeSchedules();
  fake.upsertRejects(new Error("Invalid time zone: Mars/Base"));
  await expect(
    syncNotesSchedule(fake, notesCadence({ notesFolder: "/n", notesTimeZone: "Mars/Base" }, "UTC")),
  ).rejects.toThrow("Invalid time zone");
});

test("a failed save is logged and kept until a later save succeeds", async () => {
  const fake = fakeSchedules();
  const logs: string[] = [];
  const notes = createNotesSchedule({
    schedules: fake,
    hostTimeZone: "Asia/Riyadh",
    log: (message) => logs.push(message),
  });
  fake.upsertRejects(new Error("Invalid cron time zone: Mars/Base"));
  await notes.sync({ notesFolder: "/n", notesTimeZone: "Mars/Base" });
  expect(notes.error()).toBe("Invalid cron time zone: Mars/Base");
  expect(logs).toEqual(["[office] notes schedule failed: Invalid cron time zone: Mars/Base"]);

  // A relative folder fails before the daemon is asked, and the schedule stays as it was.
  fake.upsertRejects(null);
  await notes.sync({ notesFolder: "docs", notesTimeZone: "" });
  expect(notes.error()).toBe("The notes folder must be an absolute path: docs");
  expect(fake.upserted).toEqual([]);
  expect(fake.removed).toEqual([]);

  await notes.sync({ notesFolder: "/n", notesTimeZone: "Europe/Berlin" });
  expect(notes.error()).toBeNull();
  expect(fake.upserted.map((input) => input.cadence)).toEqual([
    { ...RIYADH_EIGHT, timezone: "Europe/Berlin" },
  ]);
});

test("changes are synced one at a time, so a slow save cannot land after a later one", async () => {
  const fake = fakeSchedules();
  const notes = createNotesSchedule({
    schedules: fake,
    hostTimeZone: "Asia/Riyadh",
    log: () => {},
  });
  const release = fake.holdNextUpsert();
  const first = notes.sync({ notesFolder: "/n", notesTimeZone: "" });
  const second = notes.sync({ notesFolder: "/n", notesTimeZone: "Europe/Berlin" });
  release();
  await Promise.all([first, second]);
  expect(
    fake.upserted.map((input) => input.cadence.type === "cron" && input.cadence.timezone),
  ).toEqual(["Asia/Riyadh", "Europe/Berlin"]);
  expect((await fake.list()).map((schedule) => schedule.cadence)).toEqual([
    { ...RIYADH_EIGHT, timezone: "Europe/Berlin" },
  ]);
});
