import { expect, test } from "vitest";
import type { DayCount } from "./aggregate.js";
import {
  axisDays,
  countLine,
  dayLabel,
  dayReadout,
  duration,
  emptyLabel,
  headline,
  sinceNote,
  rangeLabel,
  shortDay,
  tickLabel,
  turnsLabel,
  weekday,
  workspaceLabel,
} from "./format.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

test("a length of time reads to the minute", () => {
  expect(duration(0)).toBe("0 min");
  expect(duration(20_000)).toBe("under 1 min");
  expect(duration(42 * MINUTE + 10_000)).toBe("42 min");
  expect(duration(2 * HOUR)).toBe("2 h");
  expect(duration(3 * HOUR + 12 * MINUTE)).toBe("3 h 12 min");
  expect(duration(1_250 * HOUR + 5 * MINUTE)).toBe("1,250 h 5 min");
  // Half a minute short of the hour is the hour.
  expect(duration(HOUR - 20_000)).toBe("1 h");
});

test("a headline drops the minutes once they stop mattering", () => {
  expect(headline(4 * HOUR + 12 * MINUTE)).toBe("4 h 12 min");
  expect(headline(9 * HOUR + 59 * MINUTE)).toBe("9 h 59 min");
  expect(headline(10 * HOUR + 29 * MINUTE)).toBe("10 h");
  expect(headline(465 * HOUR + 40 * MINUTE)).toBe("466 h");
  expect(headline(1_250 * HOUR)).toBe("1,250 h");
});

test("the scale's lines are short", () => {
  expect([tickLabel(0), tickLabel(30 * MINUTE), tickLabel(2 * HOUR)]).toEqual([
    "0",
    "30 min",
    "2 h",
  ]);
});

test("turns are counted in words", () => {
  expect(turnsLabel(1)).toBe("1 turn");
  expect(turnsLabel(1204)).toBe("1,204 turns");
  expect(rangeLabel(30)).toBe("30 days");
  expect(emptyLabel(30)).toBe("No turns in the last 30 days.");
  expect(sinceNote("2026-11-15")).toBe("Counting since Nov 15. Turns before that are not known.");
});

test("a day is named by its date, whatever the device's zone", () => {
  expect(dayLabel("2026-11-15")).toBe("Sun, Nov 15");
  expect(shortDay("2026-11-01")).toBe("Nov 1");
  expect(weekday("2026-11-09")).toBe("Mon");
});

test("what a day did is one line, with the failed turns only when there are some", () => {
  const day: DayCount = { day: "2026-11-11", turns: 41, failed: 2, workMs: 3 * HOUR + 12 * MINUTE };
  expect(countLine(day)).toBe("3 h 12 min · 41 turns · 2 failed");
  expect(dayReadout(day)).toBe("Wed, Nov 11 · 3 h 12 min · 41 turns · 2 failed");
  expect(dayReadout({ ...day, failed: 0, turns: 1 })).toBe("Wed, Nov 11 · 3 h 12 min · 1 turn");
});

test("a workspace's row says what a press does, when there is something to open", () => {
  const workspace = { id: "w1", name: "Checkout", open: true, turns: 2, failed: 0, workMs: HOUR };
  expect(workspaceLabel(workspace, true)).toBe("Checkout: 1 h · 2 turns. Open the workspace");
  expect(workspaceLabel(workspace, false)).toBe("Checkout: 1 h · 2 turns");
});

const days = (count: number): DayCount[] =>
  Array.from({ length: count }, (_, index) => ({
    day: new Date(Date.UTC(2026, 9, 17 + index)).toISOString().slice(0, 10),
    turns: 0,
    failed: 0,
    workMs: 0,
  }));

test("a week names each day under the chart; a longer range names five dates", () => {
  expect(axisDays(days(7))).toEqual(["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"]);
  expect(axisDays(days(30))).toEqual(["Oct 17", "Oct 24", "Nov 1", "Nov 8", "Nov 15"]);
  expect(axisDays(days(90))).toHaveLength(5);
});
