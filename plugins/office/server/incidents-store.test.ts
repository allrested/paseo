import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Incident } from "../shared/contracts.js";
import { EMPTY_INCIDENTS, createIncidentsStore, type IncidentsData } from "./incidents-store.js";

let directory = "";
let logs: string[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "office-incidents-"));
  logs = [];
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

// The office folder does not exist yet, as on a host that never saved an incident.
function store(file = join(directory, "office", "incidents.json")) {
  return createIncidentsStore({ file, log: (message) => logs.push(message) });
}

function incident(key: string, title = `Bug ${key}`): Incident {
  return {
    id: `jira:${key}`,
    source: "jira",
    key,
    title,
    url: `https://example.atlassian.net/browse/${key}`,
    createdAt: 1763370000000,
    foundAt: 1763370300000,
  };
}

function data(key: string, title?: string): IncidentsData {
  return {
    version: 1,
    trackers: {
      jira: { checkedAt: 1763370300000, seen: { [key]: 1763370300000 } },
      sentry: { checkedAt: 1763370000000, seen: {} },
    },
    open: [incident(key, title)],
  };
}

test("a missing file loads as empty", async () => {
  expect(await store().load()).toEqual(EMPTY_INCIDENTS);
  expect(logs).toEqual([]);
});

test("a broken file loads as empty and logs its kind, not its text", async () => {
  const file = join(directory, "incidents.json");
  await writeFile(file, "{not json SECRET");
  expect(await store(file).load()).toEqual(EMPTY_INCIDENTS);
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("SyntaxError");
  expect(logs[0]).not.toContain("SECRET");
});

test("a file of the wrong shape loads as empty and logs it as invalid, not its text", async () => {
  const file = join(directory, "incidents.json");
  await writeFile(file, JSON.stringify({ version: 1, trackers: {}, open: [{ title: "SECRET" }] }));
  expect(await store(file).load()).toEqual(EMPTY_INCIDENTS);
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("invalid");
  expect(logs[0]).not.toContain("SECRET");
});

test("a file that cannot be read loads as empty and logs its code", async () => {
  const file = join(directory, "incidents.json");
  await mkdir(file);
  expect(await store(file).load()).toEqual(EMPTY_INCIDENTS);
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("EISDIR");
});

test("an empty load is the caller's to change", async () => {
  const incidents = store();
  const first = await incidents.load();
  first.open.push(incident("BUG-1"));
  first.trackers.jira = { checkedAt: 1, seen: { "BUG-1": 1 } };
  expect(await incidents.load()).toEqual({ version: 1, trackers: {}, open: [] });
  expect(EMPTY_INCIDENTS).toEqual({ version: 1, trackers: {}, open: [] });
});

test("save then load gives the same data", async () => {
  await store().save(data("BUG-1"));
  expect(await store().load()).toEqual(data("BUG-1"));
  expect(await readdir(join(directory, "office"))).toEqual(["incidents.json"]);
});

test("two saves in a row land in order", async () => {
  const incidents = store();
  // The first save is far larger, so unordered writes would let it land last.
  const large = data("BUG-1", "x".repeat(30_000_000));
  await Promise.all([incidents.save(large), incidents.save(data("BUG-2"))]);
  expect(await store().load()).toEqual(data("BUG-2"));
  expect(await readdir(join(directory, "office"))).toEqual(["incidents.json"]);
});

test("the file is mode 600", async () => {
  const file = join(directory, "office", "incidents.json");
  await store(file).save(data("BUG-1"));
  expect((await stat(file)).mode & 0o777).toBe(0o600);
});
