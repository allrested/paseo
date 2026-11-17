import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createChatStore, emptyChat, type ChatData } from "./chat-store.js";

let directory = "";
let logs: string[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "office-chat-"));
  logs = [];
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function store(file = join(directory, "office", "chat.json")) {
  return createChatStore({ file, now: () => 1700000000000, log: (message) => logs.push(message) });
}

function data(n: number): ChatData {
  return {
    v: 1,
    msgs: [
      {
        id: `m${n}`,
        at: 1_763_359_200_000 + n,
        kind: "text",
        from: "me",
        name: "Boss",
        text: `hello ${n}`,
        reacts: { "👍": ["a1"] },
      },
    ],
    pinned: null,
    days: { standup: "Tue Nov 17 2026" },
    keys: [`k${n}`],
  };
}

test("a missing file is an empty chat", async () => {
  expect(await store().load()).toEqual(emptyChat());
  expect(logs).toEqual([]);
});

test("what is saved loads back, with no temp file left, and the file is private", async () => {
  await store().save(data(1));
  expect(await store().load()).toEqual(data(1));
  expect(await readdir(join(directory, "office"))).toEqual(["chat.json"]);
  expect((await stat(join(directory, "office", "chat.json"))).mode & 0o777).toBe(0o600);
});

test("a file that is not JSON is moved aside and the chat starts empty", async () => {
  await mkdir(join(directory, "office"));
  await writeFile(join(directory, "office", "chat.json"), "{nope");
  expect(await store().load()).toEqual(emptyChat());
  expect(await readdir(join(directory, "office"))).toEqual(["chat.json.corrupt-1700000000000"]);
  expect(logs.join("\n")).toContain("moved to");
});

test("a file of another shape is moved aside too", async () => {
  await mkdir(join(directory, "office"));
  await writeFile(join(directory, "office", "chat.json"), JSON.stringify({ v: 2 }));
  expect(await store().load()).toEqual(emptyChat());
  expect(await readdir(join(directory, "office"))).toEqual(["chat.json.corrupt-1700000000000"]);
  expect(logs.join("\n")).toContain("unexpected shape");
});

test("a photo in the file does not come back: its picture is dropped, the message stays", async () => {
  const photo = {
    id: "m9",
    at: 1_763_359_200_009,
    kind: "photo",
    from: "me",
    name: "Boss",
    text: "",
    photo: "data:image/png;base64,iVBORw0KGgo=",
    reacts: {},
  };
  await mkdir(join(directory, "office"));
  await writeFile(
    join(directory, "office", "chat.json"),
    JSON.stringify({ ...data(1), msgs: [...data(1).msgs, photo] }),
  );
  const loaded = await store().load();
  expect(loaded.msgs.map((message) => message.id)).toEqual(["m1", "m9"]);
  expect(loaded.msgs[1]).not.toHaveProperty("photo");
  const { photo: _picture, ...rest } = photo;
  expect(loaded.msgs[1]).toEqual(rest);
});

test("a load after a save reads what the save wrote", async () => {
  const chat = store();
  const saves = [chat.save(data(1)), chat.save(data(2))];
  const loaded = chat.load();
  await Promise.all(saves);
  expect(await loaded).toEqual(data(2));
  expect(await readdir(join(directory, "office"))).toEqual(["chat.json"]);
});

test("a save that fails rejects and the next one still works", async () => {
  // The office folder is a file, so the write cannot make it.
  await writeFile(join(directory, "office"), "x");
  const chat = store();
  await expect(chat.save(data(1))).rejects.toThrow();
  await rm(join(directory, "office"));
  await chat.save(data(2));
  expect(await chat.load()).toEqual(data(2));
});
