import { expect, test } from "vitest";
import { fakeSchedules } from "./fake-schedules.js";
import {
  createNotesSchedule,
  lateNotesRun,
  NOTES_SCHEDULE,
  notesCadence,
  syncNotesSchedule,
} from "./notes-schedule.js";

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

const at = (iso: string) => Date.parse(iso);

test("a notes run that starts on the day it was due is not late", () => {
  expect(
    lateNotesRun(at("2026-11-19T05:00:00Z"), at("2026-11-19T09:30:00Z"), "Asia/Riyadh"),
  ).toBeNull();
});

test("a notes run that could only start the next day is late, with both days", () => {
  expect(
    lateNotesRun(at("2026-11-19T05:00:00Z"), at("2026-11-20T06:00:00Z"), "Asia/Riyadh"),
  ).toEqual({ dueDay: "2026-11-19", startDay: "2026-11-20" });
});

test("the days are the zone's: midnight east of UTC is passed while the UTC day is the same", () => {
  // 23:59 and 00:01 in Riyadh (UTC+3), both on 18 November in UTC.
  expect(
    lateNotesRun(at("2026-11-18T20:59:00Z"), at("2026-11-18T21:01:00Z"), "Asia/Riyadh"),
  ).toEqual({ dueDay: "2026-11-18", startDay: "2026-11-19" });
});

test("the days are the zone's: midnight west of UTC is passed while the UTC day is the same", () => {
  // 23:59 and 00:01 in New York (UTC-5), both on 19 November in UTC.
  expect(
    lateNotesRun(at("2026-11-19T04:59:00Z"), at("2026-11-19T05:01:00Z"), "America/New_York"),
  ).toEqual({ dueDay: "2026-11-18", startDay: "2026-11-19" });
  // 18:00 and 20:00 in New York, across UTC midnight: the same day there.
  expect(
    lateNotesRun(at("2026-11-18T23:00:00Z"), at("2026-11-19T01:00:00Z"), "America/New_York"),
  ).toBeNull();
});
