import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { FeedState } from "../shared/contracts.js";
import { EMPTY_FEED } from "../shared/feed.js";
import { createFeedStore } from "./feed-store.js";

let directory = "";
let logs: string[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "feed-store-"));
  logs = [];
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const fileIn = () => join(directory, "feed", "feed.json");
const store = (file = fileIn()) => createFeedStore({ file, log: (message) => logs.push(message) });

function feed(text: string): FeedState {
  return {
    entries: [
      {
        id: "e1",
        at: "2026-11-15T09:00:00.000Z",
        kind: "finished",
        agentId: "a1",
        title: null,
        folder: "/work/shop",
        text,
      },
    ],
    seenAt: "2026-11-15T08:00:00.000Z",
  };
}

test("a missing file is an empty feed, and nothing is logged", async () => {
  expect(await store().load()).toEqual(EMPTY_FEED);
  expect(logs).toEqual([]);
});

test("what is saved loads back, with its version, and no temp file is left", async () => {
  await store().save(feed("Done"));

  expect(await store().load()).toEqual(feed("Done"));
  expect(JSON.parse(await readFile(fileIn(), "utf8"))).toMatchObject({ version: 1 });
  expect(await readdir(join(directory, "feed"))).toEqual(["feed.json"]);
});

test("saves run one at a time, in call order", async () => {
  const feeds = store();
  // The first save is far larger, so writes that ran together would let it land last.
  await Promise.all(
    [feed("x".repeat(2_000_000)), feed("second"), feed("last")].map((each) => feeds.save(each)),
  );

  expect(await store().load()).toEqual(feed("last"));
  expect(await readdir(join(directory, "feed"))).toEqual(["feed.json"]);
});

test("a file that is not a feed is logged, and the feed starts empty", async () => {
  await mkdir(join(directory, "feed"));
  await writeFile(fileIn(), "{ not json");
  expect(await store().load()).toEqual(EMPTY_FEED);

  await writeFile(fileIn(), JSON.stringify({ version: 2, entries: [], seenAt: null }));
  expect(await store().load()).toEqual(EMPTY_FEED);
  expect(logs).toHaveLength(2);
  expect(logs[0]).toContain("is unreadable");
});

test("a save that cannot write rejects and leaves no temp file", async () => {
  await writeFile(join(directory, "feed"), "a file where the folder should be");

  await expect(store().save(feed("Done"))).rejects.toThrow();
  expect(await readdir(directory)).toEqual(["feed"]);
});
