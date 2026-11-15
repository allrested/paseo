import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createTokenStore } from "./token-store.js";

let dir: string;
let file: string;
let logs: string[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tasks-tokens-"));
  file = join(dir, "tasks", "tokens.json");
  logs = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const store = () => createTokenStore({ file, log: (message) => logs.push(message) });

test("no file is no tokens, and nothing is logged", async () => {
  expect(await store().read()).toEqual({});
  expect(logs).toEqual([]);
});

test("a saved token is read back by a new store, and both trackers keep theirs", async () => {
  const first = store();
  await first.write("jira", "jira-token");
  await first.write("gitlab", "gitlab-token");
  expect(await store().read()).toEqual({ jira: "jira-token", gitlab: "gitlab-token" });
});

test("the file and its folder are readable by the daemon's user only", async () => {
  await store().write("jira", "jira-token");
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect((await stat(join(dir, "tasks"))).mode & 0o777).toBe(0o700);
  expect(await readdir(join(dir, "tasks"))).toEqual(["tokens.json"]);
});

test("null removes one tracker's token and keeps the other", async () => {
  const tokens = store();
  await tokens.write("jira", "jira-token");
  await tokens.write("gitlab", "gitlab-token");
  await tokens.write("jira", null);
  expect(await tokens.read()).toEqual({ gitlab: "gitlab-token" });
});

test("saves started together all land", async () => {
  const tokens = store();
  await Promise.all([tokens.write("jira", "a"), tokens.write("gitlab", "b")]);
  expect(await tokens.read()).toEqual({ jira: "a", gitlab: "b" });
});

test("a broken file is no tokens, logged without its contents, and the next save replaces it", async () => {
  await mkdir(join(dir, "tasks"), { recursive: true });
  await writeFile(file, '{"version":1,"tokens":{"jira":"leaked-token"', "utf8");
  const tokens = store();
  expect(await tokens.read()).toEqual({});
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("is unreadable");
  expect(logs[0]).not.toContain("leaked-token");
  await tokens.write("gitlab", "new-token");
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
    version: 1,
    tokens: { gitlab: "new-token" },
  });
});

test("a temp file left by a daemon that died does not block the next save", async () => {
  await mkdir(join(dir, "tasks"), { recursive: true });
  await writeFile(`${file}.tmp-1`, "half", "utf8");
  await store().write("jira", "jira-token");
  expect(await store().read()).toEqual({ jira: "jira-token" });
  expect(await readdir(join(dir, "tasks"))).toEqual(["tokens.json"]);
});

test("a save that cannot be written rejects in words", async () => {
  // The folder's place is taken by a file.
  await writeFile(join(dir, "tasks"), "not a folder", "utf8");
  await expect(store().write("jira", "jira-token")).rejects.toThrow(
    /^The token could not be saved: /,
  );
});
