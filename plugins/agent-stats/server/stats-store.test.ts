import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createStatsStore, type StoredStats } from "./stats-store.js";

let directory: string;
let logs: string[];

const fileIn = () => join(directory, "stats", "stats.json");
const store = () => createStatsStore({ file: fileIn(), log: (line) => logs.push(line) });

const stats = (turns: number): StoredStats => ({
  countingSince: "2026-11-01T08:00:00.000Z",
  hours: [{ hour: "2026-11-15T10", workspaceId: "w1", turns, failed: 0, workMs: 1000 }],
  folders: { w1: "/work/shop" },
});

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "agent-stats-"));
  logs = [];
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("a host that never counted has no file, and says nothing", async () => {
  expect(await store().load()).toBeNull();
  expect(logs).toEqual([]);
});

test("what is saved loads back, with its version, and no temp file is left", async () => {
  await store().save(stats(3));

  expect(await store().load()).toEqual(stats(3));
  expect(JSON.parse(await readFile(fileIn(), "utf8"))).toMatchObject({ version: 1 });
  expect(await readdir(join(directory, "stats"))).toEqual(["stats.json"]);
});

test("saves run one at a time, in call order", async () => {
  const counts = store();

  await Promise.all([1, 2, 3].map((turns) => counts.save(stats(turns))));

  expect((await counts.load())?.hours[0].turns).toBe(3);
});

test("a file that is not a tally is logged, and the count starts over", async () => {
  await mkdir(join(directory, "stats"), { recursive: true });
  await writeFile(fileIn(), '{"version":1,"hours":"none"}', "utf8");

  expect(await store().load()).toBeNull();
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("is unreadable");
  expect(logs[0]).toContain("counting from now");
});

test("a save that cannot write rejects and leaves no temp file", async () => {
  // A file where the folder should be.
  await writeFile(join(directory, "stats"), "in the way", "utf8");

  await expect(store().save(stats(1))).rejects.toThrow();
  expect(await readdir(directory)).toEqual(["stats"]);
});
