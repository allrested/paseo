import { expect, test } from "vitest";
import type { Hour, StatsWorkspace } from "../shared/contracts.js";
import { LOCAL, scaleFor, sinceHour, summarize, type Zone } from "./aggregate.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A place a fixed number of hours ahead of UTC. */
function ahead(hours: number): Zone {
  const shift = hours * HOUR;
  const dayOf = (ms: number) => new Date(ms + shift).toISOString().slice(0, 10);
  return {
    dayOf,
    dayStart: (ms, back) => Date.parse(`${dayOf(ms)}T00:00:00.000Z`) - shift - back * DAY,
  };
}

const JAKARTA = ahead(7);
// Sunday 15 November 2026, 18:20 in Jakarta.
const NOW = Date.parse("2026-11-15T11:20:00Z");

const hour = (at: string, extra: Partial<Hour> = {}): Hour => ({
  hour: at,
  workspaceId: "w1",
  turns: 1,
  failed: 0,
  workMs: 10 * MINUTE,
  ...extra,
});

const WORKSPACES: StatsWorkspace[] = [
  { id: "w1", name: "Checkout", open: true },
  { id: "w2", name: "old-api", open: false },
  { id: "", name: "No workspace", open: false },
];

test("the host is asked from the reader's midnight, as an hour of UTC", () => {
  // Seven days that end today begin on Monday the 9th, 00:00 in Jakarta.
  expect(sinceHour(7, NOW, JAKARTA)).toBe("2026-11-08T17");
  expect(sinceHour(1, NOW, JAKARTA)).toBe("2026-11-14T17");
  expect(sinceHour(1, NOW, ahead(0))).toBe("2026-11-15T00");
});

test("a range has every one of its days, oldest first, the empty ones too", () => {
  const { days } = summarize({ hours: [], workspaces: [] }, 7, NOW, JAKARTA);

  expect(days.map((day) => day.day)).toEqual([
    "2026-11-09",
    "2026-11-10",
    "2026-11-11",
    "2026-11-12",
    "2026-11-13",
    "2026-11-14",
    "2026-11-15",
  ]);
  expect(days.every((day) => day.turns === 0 && day.workMs === 0)).toBe(true);
});

test("an hour is counted in the reader's day, not the host's", () => {
  const { days } = summarize(
    {
      hours: [
        // 23:00 on the 14th in UTC is 06:00 on the 15th in Jakarta.
        hour("2026-11-14T23"),
        // 16:00 on the 14th in UTC is 23:00 on the 14th in Jakarta.
        hour("2026-11-14T16", { turns: 3, failed: 1, workMs: HOUR }),
        hour("2026-11-15T10", { workspaceId: "w2" }),
      ],
      workspaces: WORKSPACES,
    },
    7,
    NOW,
    JAKARTA,
  );

  expect(days.slice(-2)).toEqual([
    { day: "2026-11-14", turns: 3, failed: 1, workMs: HOUR },
    { day: "2026-11-15", turns: 2, failed: 0, workMs: 20 * MINUTE },
  ]);
});

test("hours outside the range are left out of every sum", () => {
  const summary = summarize(
    {
      hours: [
        // Sunday the 8th, 23:00 in Jakarta: the day before the range.
        hour("2026-11-08T16", { turns: 9 }),
        hour("2026-11-08T17"),
      ],
      workspaces: WORKSPACES,
    },
    7,
    NOW,
    JAKARTA,
  );

  expect(summary.total).toEqual({ turns: 1, failed: 0, workMs: 10 * MINUTE });
  expect(summary.days[0]).toMatchObject({ day: "2026-11-09", turns: 1 });
  expect(summary.workspaces.map((workspace) => workspace.turns)).toEqual([1]);
});

test("the workspaces are summed and ranked by time, then turns, then name", () => {
  const { workspaces, total } = summarize(
    {
      hours: [
        hour("2026-11-15T08", { workspaceId: "w2", workMs: 5 * MINUTE, turns: 4, failed: 2 }),
        hour("2026-11-15T09", { workMs: 30 * MINUTE }),
        hour("2026-11-14T09", { workMs: 45 * MINUTE }),
        hour("2026-11-15T10", { workspaceId: null, workMs: 5 * MINUTE, turns: 4 }),
        hour("2026-11-15T10", { workspaceId: "unknown", workMs: 0, turns: 1 }),
      ],
      workspaces: WORKSPACES,
    },
    7,
    NOW,
    JAKARTA,
  );

  expect(workspaces).toEqual([
    { id: "w1", name: "Checkout", open: true, turns: 2, failed: 0, workMs: 75 * MINUTE },
    { id: "", name: "No workspace", open: false, turns: 4, failed: 0, workMs: 5 * MINUTE },
    { id: "w2", name: "old-api", open: false, turns: 4, failed: 2, workMs: 5 * MINUTE },
    // A workspace the host did not name is shown by its id, and cannot be opened.
    { id: "unknown", name: "unknown", open: false, turns: 1, failed: 0, workMs: 0 },
  ]);
  expect(total).toEqual({ turns: 11, failed: 2, workMs: 85 * MINUTE });
});

test("the summary is made on Hermes, which has no Array.prototype.toSorted", () => {
  // The app runs plugin code on Hermes (React Native 0.86 pins hermes-v0.17.0 and
  // hermes-v250829098.0.17): it has toReversed, toSpliced and findLast, not toSorted.
  const prototype = Array.prototype as { toSorted?: unknown };
  const toSorted = prototype.toSorted;
  delete prototype.toSorted;
  try {
    const { workspaces } = summarize(
      {
        hours: [
          hour("2026-11-15T08", { workspaceId: "w2", workMs: 5 * MINUTE }),
          hour("2026-11-15T09", { workMs: 30 * MINUTE }),
        ],
        workspaces: WORKSPACES,
      },
      7,
      NOW,
      JAKARTA,
    );
    expect(workspaces.map((workspace) => workspace.id)).toEqual(["w1", "w2"]);
  } finally {
    prototype.toSorted = toSorted;
  }
});

test("the device's own zone puts a moment in a day and finds the day's start", () => {
  const start = LOCAL.dayStart(NOW, 0);
  expect(LOCAL.dayOf(start)).toBe(LOCAL.dayOf(NOW));
  expect(LOCAL.dayOf(start - 1)).not.toBe(LOCAL.dayOf(NOW));
  expect(LOCAL.dayOf(NOW)).toMatch(/^2026-11-1[56]$/);
  expect(LOCAL.dayStart(NOW, 1)).toBeLessThan(start);
});

test("a scale ends on the first round time that holds the largest value", () => {
  expect(scaleFor(47 * MINUTE)).toEqual({
    top: 60 * MINUTE,
    ticks: [0, 15 * MINUTE, 30 * MINUTE, 45 * MINUTE, 60 * MINUTE],
  });
  expect(scaleFor(3 * HOUR + 12 * MINUTE)).toEqual({
    top: 4 * HOUR,
    ticks: [0, HOUR, 2 * HOUR, 3 * HOUR, 4 * HOUR],
  });
  expect(scaleFor(9 * HOUR)).toEqual({ top: 9 * HOUR, ticks: [0, 3 * HOUR, 6 * HOUR, 9 * HOUR] });
  expect(scaleFor(30_000).top).toBe(MINUTE);
});

test("a scale past four days counts in whole days", () => {
  const { top, ticks } = scaleFor(9 * DAY + HOUR);
  expect(ticks).toEqual([0, 3 * DAY, 6 * DAY, 9 * DAY, 12 * DAY]);
  expect(top).toBe(12 * DAY);
});

test("a scale for nothing still has a line above zero", () => {
  expect(scaleFor(0)).toEqual({ top: MINUTE, ticks: [0, MINUTE] });
});
