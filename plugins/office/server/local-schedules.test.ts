import { expect, test } from "vitest";
import { createFakeClock, settle } from "./fake-clock.js";
import { createLocalSchedules, nextCronRun } from "./local-schedules.js";

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();
const NOTES = "0 8 * * 0-4";

test("8:00 in Riyadh is 05:00 UTC, the same day when it is still ahead", () => {
  // Wednesday 18 November 2026, 07:59 in Riyadh.
  expect(iso(nextCronRun(NOTES, "Asia/Riyadh", at("2026-11-18T04:59:00Z")))).toBe(
    "2026-11-18T05:00:00.000Z",
  );
});

test("at 8:00 exactly the next run is the next working day's", () => {
  expect(iso(nextCronRun(NOTES, "Asia/Riyadh", at("2026-11-18T05:00:00Z")))).toBe(
    "2026-11-19T05:00:00.000Z",
  );
});

test("Friday and Saturday are skipped: Thursday's run is followed by Sunday's", () => {
  expect(iso(nextCronRun(NOTES, "Asia/Riyadh", at("2026-11-19T05:00:00Z")))).toBe(
    "2026-11-22T05:00:00.000Z",
  );
});

test("the hour is the zone's wall clock across a daylight-saving change", () => {
  // New York springs forward on Sunday 8 March 2026: 8:00 EDT is 12:00 UTC.
  expect(iso(nextCronRun("0 8 * * *", "America/New_York", at("2026-03-07T14:00:00Z")))).toBe(
    "2026-03-08T12:00:00.000Z",
  );
});

test("a zone the host does not know, and an expression the office does not read, are refused", () => {
  expect(() => nextCronRun(NOTES, "Mars/Olympus", 0)).toThrow(/time zone/i);
  expect(() => nextCronRun("*/5 * * * *", "UTC", 0)).toThrow(/expression/i);
  expect(() => nextCronRun("0 8 1 * *", "UTC", 0)).toThrow(/expression/i);
});

function engine() {
  const clock = createFakeClock(at("2026-11-18T04:00:00Z"));
  const logged: string[] = [];
  const schedules = createLocalSchedules({ clock, log: (line) => logged.push(line) });
  return { clock, logged, schedules };
}

const NOTES_INPUT = {
  name: "standup-notes",
  handler: "standup-notes",
  prompt: "Stand-up notes",
  cadence: { type: "cron" as const, expression: NOTES, timezone: "Asia/Riyadh" },
};

test("a saved schedule says when it runs next, and is listed", async () => {
  const { schedules } = engine();
  const saved = await schedules.upsert(NOTES_INPUT);

  expect(saved.nextRunAt).toBe("2026-11-18T05:00:00.000Z");
  expect(await schedules.list()).toEqual([
    {
      id: "standup-notes",
      name: "standup-notes",
      handler: "standup-notes",
      cadence: NOTES_INPUT.cadence,
      nextRunAt: "2026-11-18T05:00:00.000Z",
    },
  ]);
});

test("a due schedule runs its handler and is set for the run after", async () => {
  const { clock, schedules } = engine();
  let runs = 0;
  schedules.handle("standup-notes", async () => {
    runs += 1;
  });
  await schedules.upsert(NOTES_INPUT);

  clock.advance(60 * 60 * 1000);
  await settle();
  expect(runs).toBe(1);
  expect((await schedules.list())[0]?.nextRunAt).toBe("2026-11-19T05:00:00.000Z");

  clock.advance(24 * 60 * 60 * 1000);
  await settle();
  expect(runs).toBe(2);
});

test("an interval runs every time it passes", async () => {
  const { clock, schedules } = engine();
  let runs = 0;
  schedules.handle("incidents", async () => {
    runs += 1;
  });
  await schedules.upsert({
    name: "incidents",
    handler: "incidents",
    prompt: "Incidents",
    cadence: { type: "every", everyMs: 5 * 60 * 1000 },
  });

  // A step at a time: a run that has not ended when the next falls due is skipped.
  for (let step = 0; step < 3; step += 1) {
    clock.advance(5 * 60 * 1000);
    await settle();
  }
  expect(runs).toBe(3);
});

test("a handler that fails is logged and the schedule keeps running", async () => {
  const { clock, logged, schedules } = engine();
  let runs = 0;
  schedules.handle("standup-notes", async () => {
    runs += 1;
    throw new Error("no writer");
  });
  await schedules.upsert(NOTES_INPUT);

  // The failed run has ended before the next falls due.
  clock.advance(60 * 60 * 1000);
  await settle();
  clock.advance(24 * 60 * 60 * 1000);
  await settle();
  expect(runs).toBe(2);
  expect(logged.some((line) => line.includes("standup-notes") && line.includes("no writer"))).toBe(
    true,
  );
});

test("a removed schedule does not run, and removing it twice answers false", async () => {
  const { clock, schedules } = engine();
  let runs = 0;
  schedules.handle("standup-notes", async () => {
    runs += 1;
  });
  await schedules.upsert(NOTES_INPUT);

  expect(await schedules.remove("standup-notes")).toBe(true);
  expect(await schedules.remove("standup-notes")).toBe(false);
  clock.advance(48 * 60 * 60 * 1000);
  await settle();
  expect(runs).toBe(0);
  expect(await schedules.list()).toEqual([]);
});

test("a save with a zone the host refuses rejects and leaves the kept schedule as it was", async () => {
  const { schedules } = engine();
  await schedules.upsert(NOTES_INPUT);

  await expect(
    schedules.upsert({
      ...NOTES_INPUT,
      cadence: { ...NOTES_INPUT.cadence, timezone: "Mars/Olympus" },
    }),
  ).rejects.toThrow(/time zone/i);
  expect((await schedules.list())[0]?.cadence).toEqual(NOTES_INPUT.cadence);
});

test("stop cancels what is set", async () => {
  const { clock, schedules } = engine();
  let runs = 0;
  schedules.handle("standup-notes", async () => {
    runs += 1;
  });
  await schedules.upsert(NOTES_INPUT);
  schedules.stop();

  clock.advance(48 * 60 * 60 * 1000);
  await settle();
  expect(runs).toBe(0);
});

test("the hour that happens twice is run once: the first 01:00, then the next day's", () => {
  // New York goes back on Sunday 1 November 2026: 01:00 happens as EDT and again as EST.
  const first = nextCronRun("0 1 * * *", "America/New_York", at("2026-10-31T06:00:00Z"));
  expect(iso(first)).toBe("2026-11-01T05:00:00.000Z");
  expect(iso(nextCronRun("0 1 * * *", "America/New_York", first))).toBe("2026-11-02T06:00:00.000Z");
});

test("a timer that fires a millisecond early runs the handler once", async () => {
  let now = at("2026-11-18T04:00:00Z");
  const timers: (() => void)[] = [];
  const clock = {
    now: () => now,
    setTimeout: (run: () => void) => {
      timers.push(run);
      return () => undefined;
    },
  };
  const schedules = createLocalSchedules({ clock, log: () => undefined });
  let runs = 0;
  schedules.handle("standup-notes", async () => {
    runs += 1;
  });
  await schedules.upsert(NOTES_INPUT);

  now = at("2026-11-18T04:59:59.999Z");
  timers[0]?.();
  await settle();
  expect(runs).toBe(1);
  expect((await schedules.list())[0]?.nextRunAt).toBe("2026-11-19T05:00:00.000Z");
});

const EVERY_INCIDENTS = {
  name: "incidents",
  handler: "incidents",
  prompt: "Incidents",
  cadence: { type: "every" as const, everyMs: 5 * 60 * 1000 },
};

test("a run is skipped, and logged, while the last one has not ended", async () => {
  const { clock, logged, schedules } = engine();
  let runs = 0;
  schedules.handle("incidents", () => {
    runs += 1;
    return new Promise<void>(() => undefined);
  });
  await schedules.upsert(EVERY_INCIDENTS);

  clock.advance(16 * 60 * 1000);
  await settle();
  expect(runs).toBe(1);
  expect(
    logged.filter((line) => line === "[office] incidents run skipped: the last one has not ended"),
  ).toHaveLength(2);
});

test("a run that ended lets the next one start", async () => {
  const { clock, schedules } = engine();
  let runs = 0;
  let end: () => void = () => undefined;
  schedules.handle("incidents", () => {
    runs += 1;
    return new Promise<void>((resolve) => {
      end = resolve;
    });
  });
  await schedules.upsert(EVERY_INCIDENTS);

  clock.advance(5 * 60 * 1000);
  await settle();
  end();
  await settle();
  clock.advance(5 * 60 * 1000);
  await settle();
  expect(runs).toBe(2);
});

test("an interval under a second is refused, naming the value", async () => {
  const { schedules } = engine();
  await expect(
    schedules.upsert({ ...EVERY_INCIDENTS, cadence: { type: "every", everyMs: 10 } }),
  ).rejects.toThrow(/10/);
  await expect(
    schedules.upsert({ ...EVERY_INCIDENTS, cadence: { type: "every", everyMs: Number.NaN } }),
  ).rejects.toThrow(/NaN/);
  expect(await schedules.list()).toEqual([]);
});

test("after stop a save is refused and sets no timer", async () => {
  const { clock, schedules } = engine();
  schedules.stop();
  await expect(schedules.upsert(NOTES_INPUT)).rejects.toThrow(/have stopped/);
  expect(clock.pending()).toBe(0);
});
