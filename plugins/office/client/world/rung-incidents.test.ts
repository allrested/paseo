import { expect, test } from "vitest";
import type { Incident } from "../../shared/contracts.js";
import { markRung, toRing } from "./rung-incidents.js";

const NOW = Date.parse("2026-11-17T09:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function incident(key: string): Incident {
  return {
    id: `jira:${key}`,
    source: "jira",
    key,
    title: `${key} is broken`,
    url: `https://example.atlassian.net/browse/${key}`,
    createdAt: NOW - HOUR,
    foundAt: NOW,
  };
}

const first = incident("SHOP-12");
const second = incident("SHOP-13");

test("toRing gives ids not yet rung", () => {
  expect(toRing([first, second], {})).toEqual(["jira:SHOP-12", "jira:SHOP-13"]);
  expect(toRing([first, second], { "jira:SHOP-12": NOW - HOUR })).toEqual(["jira:SHOP-13"]);
  expect(toRing([first, second], { "jira:SHOP-12": NOW, "jira:SHOP-13": NOW })).toEqual([]);
  expect(toRing([], { "jira:SHOP-12": NOW })).toEqual([]);
});

test("markRung adds the ids and drops entries over 2 days old", () => {
  const rung = {
    "jira:OLD-1": NOW - 2 * DAY - 1,
    "jira:EDGE-1": NOW - 2 * DAY,
    "jira:RECENT-1": NOW - HOUR,
  };

  expect(markRung(rung, ["jira:SHOP-12"], NOW)).toEqual({
    "jira:EDGE-1": NOW - 2 * DAY,
    "jira:RECENT-1": NOW - HOUR,
    "jira:SHOP-12": NOW,
  });
  // Nothing new: only the drop.
  expect(markRung(rung, [], NOW)).toEqual({
    "jira:EDGE-1": NOW - 2 * DAY,
    "jira:RECENT-1": NOW - HOUR,
  });
  // The map given is not changed.
  expect(Object.keys(rung)).toEqual(["jira:OLD-1", "jira:EDGE-1", "jira:RECENT-1"]);
});

test("a second device with an empty rung map rings once; the first, reopened, rings none", () => {
  const open = [first, second];
  // The first device rang for both and saved its map.
  const firstDevice = markRung({}, toRing(open, {}), NOW);

  // A second device has rung for nothing: both ring there, once.
  const secondRings = toRing(open, {});
  const secondDevice = markRung({}, secondRings, NOW + HOUR);
  expect(secondRings).toEqual(["jira:SHOP-12", "jira:SHOP-13"]);
  expect(toRing(open, secondDevice)).toEqual([]);

  // The first device's office, opened again, reads its map: nothing rings.
  expect(toRing(open, firstDevice)).toEqual([]);
});
