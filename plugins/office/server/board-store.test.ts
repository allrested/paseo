import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
  // The first save is far larger, so unserialized writes would let it land last.
  const large: BoardsFile = { ...data(1), posts: [{ ...note(1), text: "x".repeat(30_000_000) }] };
  await Promise.all([large, data(2), data(3), data(4), data(5)].map((next) => boards.save(next)));
  expect(await store().load()).toEqual(data(5));
  expect(await readdir(join(directory, "office"))).toEqual(["boards.json"]);
});

test("a load queued before a save finishes first, so it never moves the new file aside", async () => {
  const file = join(directory, "boards.json");
  // Broken, and large enough that reading it outlasts a small save: a load outside the queue
  // would find it broken after the save landed, and move the saved file aside.
  await writeFile(file, `{ not json ${"x".repeat(30_000_000)}`);
  const boards = store(file);
  const [loaded] = await Promise.all([boards.load(), boards.save(data(1))]);
  expect(loaded).toEqual(EMPTY_BOARDS);
  expect((await readdir(directory)).sort()).toEqual([
    "boards.json",
    "boards.json.corrupt-1700000000000",
  ]);
  expect(await boards.load()).toEqual(data(1));
});

test("a file that cannot be read is moved aside, so a later save never overwrites it", async () => {
  const file = join(directory, "boards.json");
  await mkdir(file);
  expect(await store(file).load()).toEqual(EMPTY_BOARDS);
  expect(await readdir(directory)).toEqual(["boards.json.corrupt-1700000000000"]);
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("moved to");
});

test("a file that cannot be moved aside says the next save will replace it", async () => {
  const file = join(directory, "boards.json");
  await mkdir(file);
  await writeFile(`${file}.corrupt-1700000000000`, "taken");
  // Renaming a directory over an existing file fails.
  expect(await store(file).load()).toEqual(EMPTY_BOARDS);
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("could not be moved aside");
  expect(logs[0]).toContain("the next save will replace the file");
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

test("a failed save rejects and does not block the next one on the same store", async () => {
  const obstacle = join(directory, "missing-parent-is-a-file");
  await writeFile(obstacle, "x");
  const boards = store(join(obstacle, "boards.json"));
  await expect(boards.save(data(1))).rejects.toThrow();
  await expect(boards.save(data(2))).rejects.toThrow();
  await rm(obstacle);
  await boards.save(data(3));
  expect(await boards.load()).toEqual(data(3));
});

test("a failed rename removes its temp file and rejects", async () => {
  const file = join(directory, "boards.json");
  await mkdir(file);
  await expect(store(file).save(data(1))).rejects.toThrow();
  expect(await readdir(directory)).toEqual(["boards.json"]);
});
