import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  CdpProfileError,
  CdpProfileStore,
  PROFILE_LIMIT,
  PROFILE_NAME_MAX,
  profileName,
} from "./profile-store.js";

let home = "";
let errors: unknown[] = [];
let opened: CdpProfileStore[] = [];
const file = () => join(home, "browser-tools", "cdp-profiles.json");

async function open(): Promise<CdpProfileStore> {
  const store = new CdpProfileStore(file(), (error) => errors.push(error));
  await store.load();
  opened.push(store);
  return store;
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "profile-store-"));
  errors = [];
});

afterEach(async () => {
  // A write still under way would land in a folder that is being removed.
  await Promise.all(opened.map((store) => store.flush()));
  opened = [];
  await rm(home, { recursive: true, force: true });
});

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof CdpProfileError) return error.code;
    throw error;
  }
  return "no error";
}

test("a new home has no profiles, and every workspace is on Shared", async () => {
  const store = await open();

  expect(store.list()).toEqual([]);
  expect(store.profileOf("w1")).toBeNull();
  expect(errors).toEqual([]);
});

test("profiles, a workspace's choice and a context come back after a restart", async () => {
  const store = await open();
  const work = store.create({ id: "p1", name: "  Work   account ", now: 10 });
  store.create({ id: "p2", name: "Test user", now: 20 });
  store.assign("w1", "p2");
  store.setContext("p1", "CTX1");
  await store.flush();

  const again = await open();

  expect(work).toEqual({ id: "p1", name: "Work account", createdAt: 10 });
  expect(again.list()).toEqual([
    { id: "p1", name: "Work account", createdAt: 10, contextId: "CTX1" },
    { id: "p2", name: "Test user", createdAt: 20 },
  ]);
  expect(again.profileOf("w1")?.id).toBe("p2");
  expect(again.profileOf("w2")).toBeNull();
  expect(JSON.parse(await readFile(file(), "utf8"))).toMatchObject({ version: 1 });
});

test("a name is taken without regard to case, and Shared is the built-in's", async () => {
  const store = await open();
  store.create({ id: "p1", name: "Work", now: 1 });

  expect(codeOf(() => store.create({ id: "p2", name: "work", now: 2 }))).toBe(
    "browser_profile_name_taken",
  );
  expect(codeOf(() => store.create({ id: "p2", name: " SHARED ", now: 2 }))).toBe(
    "browser_profile_name_taken",
  );
  expect(store.list()).toHaveLength(1);
});

test.each([
  ["empty", ""],
  ["only spaces", "   "],
  ["too long", "x".repeat(PROFILE_NAME_MAX + 1)],
  ["a control character", "Work\u0007"],
])("a name that is %s is invalid", (_label, name) => {
  expect(codeOf(() => profileName(name))).toBe("browser_profile_name_invalid");
});

test("a name of the longest length is kept, counted in characters and not in bytes", () => {
  expect(profileName("é".repeat(PROFILE_NAME_MAX))).toHaveLength(PROFILE_NAME_MAX);
  expect([...profileName("🦊".repeat(PROFILE_NAME_MAX))]).toHaveLength(PROFILE_NAME_MAX);
});

test("there is a limit to how many profiles there are", async () => {
  const store = await open();
  for (let index = 0; index < PROFILE_LIMIT; index += 1) {
    store.create({ id: `p${index}`, name: `Profile ${index}`, now: index });
  }

  expect(codeOf(() => store.create({ id: "more", name: "One more", now: 99 }))).toBe(
    "browser_profile_limit",
  );
});

test("a removed profile is gone, and its workspaces go back to Shared", async () => {
  const store = await open();
  store.create({ id: "p1", name: "Work", now: 1 });
  store.create({ id: "p2", name: "Test", now: 2 });
  store.assign("w1", "p1");
  store.assign("w2", "p2");

  expect(store.remove("p1")?.name).toBe("Work");
  expect(store.remove("p1")).toBeNull();
  await store.flush();
  const again = await open();

  expect(again.list().map((profile) => profile.id)).toEqual(["p2"]);
  expect(again.profileOf("w1")).toBeNull();
  expect(again.profileOf("w2")?.id).toBe("p2");
  // The name is free again.
  expect(again.create({ id: "p3", name: "work", now: 3 }).name).toBe("work");
});

test("a workspace goes back to Shared, and cannot take a profile that is not there", async () => {
  const store = await open();
  store.create({ id: "p1", name: "Work", now: 1 });
  store.assign("w1", "p1");

  store.assign("w1", null);

  expect(store.profileOf("w1")).toBeNull();
  expect(codeOf(() => store.assign("w1", "gone"))).toBe("browser_profile_not_found");
});

test("a context is recorded and cleared, and an unknown profile is left alone", async () => {
  const store = await open();
  store.create({ id: "p1", name: "Work", now: 1 });

  store.setContext("p1", "CTX1");
  store.setContext("gone", "CTX2");
  expect(store.get("p1")?.contextId).toBe("CTX1");

  store.setContext("p1", null);
  expect(store.get("p1")).toEqual({ id: "p1", name: "Work", createdAt: 1 });
});

test("a file that is not a profile file is reported, and the store starts empty", async () => {
  const store = await open();
  store.create({ id: "p1", name: "Work", now: 1 });
  await store.flush();
  await writeFile(file(), "{ not json");

  const again = await open();

  expect(again.list()).toEqual([]);
  expect(errors).toHaveLength(1);
});

test("a workspace whose profile is missing from the file is on Shared", async () => {
  const store = await open();
  await store.flush();
  await writeFile(file(), JSON.stringify({ version: 1, profiles: [], workspaces: { w1: "gone" } }));

  expect((await open()).profileOf("w1")).toBeNull();
});
