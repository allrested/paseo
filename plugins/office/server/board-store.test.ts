import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Post } from "../shared/contracts.js";
import { EMPTY_BOARDS, createBoardStore, type BoardsFile } from "./board-store.js";

let directory = "";
let logs: string[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "office-store-"));
  logs = [];
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function store(file = join(directory, "office", "boards.json")) {
  return createBoardStore({ file, now: () => 1700000000000, log: (message) => logs.push(message) });
}

function note(seq: number): Post {
  return {
    id: `p${seq}`,
    seq,
    board: "lobby",
    kind: "note",
    text: `note ${seq}`,
    author: "user",
    createdAt: "2026-11-11T09:00:00.000Z",
    updatedAt: "2026-11-11T09:00:00.000Z",
  };
}

function data(seq: number): BoardsFile {
  return { version: 1, nextSeq: seq + 1, wakesPaused: false, posts: [note(seq)] };
}

test("a missing file is an empty store", async () => {
  expect(await store().load()).toEqual(EMPTY_BOARDS);
  expect(logs).toEqual([]);
});

test("what is saved loads back, and no temp file is left", async () => {
  const boards = store();
  await boards.save(data(1));
  expect(await store().load()).toEqual(data(1));
  expect(await readdir(join(directory, "office"))).toEqual(["boards.json"]);
});

test("concurrent saves run one at a time, in call order", async () => {
  const boards = store();
  await Promise.all([1, 2, 3, 4, 5].map((seq) => boards.save(data(seq))));
  expect(await store().load()).toEqual(data(5));
  expect(await readdir(join(directory, "office"))).toEqual(["boards.json"]);
});

test("a file that does not parse is moved aside and an empty store starts", async () => {
  const file = join(directory, "boards.json");
  await writeFile(file, "{ not json");
  expect(await store(file).load()).toEqual(EMPTY_BOARDS);
  expect((await readdir(directory)).sort()).toEqual(["boards.json.corrupt-1700000000000"]);
  expect(await readFile(join(directory, "boards.json.corrupt-1700000000000"), "utf8")).toBe(
    "{ not json",
  );
  expect(logs).toHaveLength(1);
});

test("a file with the wrong shape is moved aside too", async () => {
  const file = join(directory, "boards.json");
  await writeFile(file, JSON.stringify({ version: 2, posts: "none" }));
  expect(await store(file).load()).toEqual(EMPTY_BOARDS);
  expect(await readdir(directory)).toEqual(["boards.json.corrupt-1700000000000"]);
});

test("a failed save rejects and does not block the next one", async () => {
  const file = join(directory, "missing-parent-is-a-file", "boards.json");
  await writeFile(join(directory, "missing-parent-is-a-file"), "x");
  const blocked = store(file);
  await expect(blocked.save(data(1))).rejects.toThrow();
  await expect(blocked.save(data(2))).rejects.toThrow();
  const good = store();
  await good.save(data(3));
  expect(await good.load()).toEqual(data(3));
});
