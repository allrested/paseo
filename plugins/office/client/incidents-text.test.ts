import { expect, test } from "vitest";
import type { Incident, IncidentsState } from "../shared/contracts.js";
import { incidentProblems, incidentRows, incidentsEntry, newestFirst } from "./incidents-text.js";

const NOW = Date.parse("2026-11-17T09:00:00Z");
const quiet: IncidentsState = {
  open: [],
  problems: {},
  jiraReady: true,
  sentryReady: true,
  scheduleError: null,
};
const bug: Incident = {
  id: "jira:SHOP-12",
  source: "jira",
  key: "SHOP-12",
  title: "Checkout fails on Safari",
  url: "https://example.atlassian.net/browse/SHOP-12",
  createdAt: NOW - 60_000,
  foundAt: NOW,
};
const open = () => undefined;

test("no state and no problem: no entry", () => {
  expect(incidentsEntry(undefined, open)).toBeNull();
  expect(incidentsEntry(quiet, open)).toBeNull();
});

test("one open: entry 'Incidents' with 1", () => {
  expect(incidentsEntry({ ...quiet, open: [bug] }, open)).toEqual({
    title: "Incidents",
    note: { text: "1 open", tone: "danger" },
    onOpen: open,
  });
});

test("a problem only: an entry with 0", () => {
  expect(incidentsEntry({ ...quiet, problems: { jira: "401 Unauthorized" } }, open)).toEqual({
    title: "Incidents",
    note: { text: "0 open · a check failed", tone: "danger" },
    onOpen: open,
  });
});

const issue: Incident = {
  id: "sentry:API-7",
  source: "sentry",
  key: "API-7",
  title: "TypeError in /orders",
  url: "https://sentry.io/organizations/acme/issues/7/",
  createdAt: NOW - 4 * 3_600_000,
  foundAt: NOW - 12 * 60_000,
};
const old: Incident = {
  ...bug,
  id: "jira:SHOP-3",
  key: "SHOP-3",
  title: "Refund email is empty",
  url: "https://example.atlassian.net/browse/SHOP-3",
  foundAt: NOW - 3 * 3_600_000 - 59 * 60_000,
};

test("rows newest first with ages at 0 s, 12 min and 3 h", () => {
  expect(incidentRows({ ...quiet, open: [old, bug, issue] }, NOW)).toEqual([
    {
      id: "jira:SHOP-12",
      sourceLabel: "Jira",
      key: "SHOP-12",
      title: "Checkout fails on Safari",
      url: "https://example.atlassian.net/browse/SHOP-12",
      age: "just now",
    },
    {
      id: "sentry:API-7",
      sourceLabel: "Sentry",
      key: "API-7",
      title: "TypeError in /orders",
      url: "https://sentry.io/organizations/acme/issues/7/",
      age: "12 min ago",
    },
    {
      id: "jira:SHOP-3",
      sourceLabel: "Jira",
      key: "SHOP-3",
      title: "Refund email is empty",
      url: "https://example.atlassian.net/browse/SHOP-3",
      age: "3 h ago",
    },
  ]);
  expect(incidentRows(undefined, NOW)).toEqual([]);
});

test("an age stops at the minute and the hour below it", () => {
  const at = (ms: number) => incidentRows({ ...quiet, open: [{ ...bug, foundAt: NOW - ms }] }, NOW);
  expect(at(59_999)[0]?.age).toBe("just now");
  expect(at(60_000)[0]?.age).toBe("1 min ago");
  expect(at(3_599_999)[0]?.age).toBe("59 min ago");
  expect(at(3_600_000)[0]?.age).toBe("1 h ago");
  // A host clock ahead of this device's still reads as just now.
  expect(at(-30_000)[0]?.age).toBe("just now");
});

test("found at the same moment: the later created first, then in key order", () => {
  const a = { ...bug, id: "jira:A-1", key: "A-1", createdAt: NOW - 2000 };
  const b = { ...bug, id: "jira:B-1", key: "B-1", createdAt: NOW - 1000 };
  const c = { ...bug, id: "jira:C-1", key: "C-1", createdAt: NOW - 1000 };
  const found = [a, c, b];
  expect(newestFirst(found).map((incident) => incident.key)).toEqual(["B-1", "C-1", "A-1"]);
  // A sorted copy: the state's list stays as it came.
  expect(found.map((incident) => incident.key)).toEqual(["A-1", "C-1", "B-1"]);
});

test("each tracker's problem is a line of its own", () => {
  expect(incidentProblems(undefined)).toEqual([]);
  expect(incidentProblems(quiet)).toEqual([]);
  expect(
    incidentProblems({ ...quiet, problems: { jira: "401 Unauthorized", sentry: "Timed out" } }),
  ).toEqual(["Jira: 401 Unauthorized", "Sentry: Timed out"]);
});
