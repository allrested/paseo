import { expect, test } from "vitest";
import { hourOf, hourStart, oldestKept, spread } from "./hours.js";

const at = (iso: string) => Date.parse(iso);

test("a moment is in the hour of the clock, UTC", () => {
  expect(hourOf(at("2026-11-15T11:59:59.999Z"))).toBe("2026-11-15T11");
  expect(hourOf(at("2026-11-15T23:00:00+07:00"))).toBe("2026-11-15T16");
  expect(hourStart("2026-11-15T11")).toBe(at("2026-11-15T11:00:00Z"));
});

test("a stretch inside one hour is that hour's", () => {
  expect(spread(at("2026-11-15T11:10:00Z"), at("2026-11-15T11:25:30Z"))).toEqual([
    { hour: "2026-11-15T11", ms: 930_000 },
  ]);
});

test("a stretch over several hours gives each its share, across midnight too", () => {
  expect(spread(at("2026-11-15T22:45:00Z"), at("2026-11-16T01:05:00Z"))).toEqual([
    { hour: "2026-11-15T22", ms: 900_000 },
    { hour: "2026-11-15T23", ms: 3_600_000 },
    { hour: "2026-11-16T00", ms: 3_600_000 },
    { hour: "2026-11-16T01", ms: 300_000 },
  ]);
});

test("a stretch that ends on the hour does not touch the next, and an empty one touches none", () => {
  expect(spread(at("2026-11-15T10:30:00Z"), at("2026-11-15T11:00:00Z"))).toEqual([
    { hour: "2026-11-15T10", ms: 1_800_000 },
  ]);
  expect(spread(at("2026-11-15T10:30:00Z"), at("2026-11-15T10:30:00Z"))).toEqual([]);
  // A clock set back in the middle of a turn.
  expect(spread(at("2026-11-15T10:30:00Z"), at("2026-11-15T10:00:00Z"))).toEqual([]);
});

test("120 days of hours are kept", () => {
  expect(oldestKept(at("2026-11-15T11:20:00Z"))).toBe("2026-07-18T11");
});
