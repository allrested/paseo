import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { CdpCookieVault } from "./cookie-vault.js";
import type { ProfileCookie } from "./profile-cookie.js";

let home = "";
const folder = () => join(home, "cdp-profiles");
const vault = () => new CdpCookieVault(folder(), () => 1_800_000_000_000);

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "cookie-vault-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const cookie = (name: string, extra: Partial<ProfileCookie> = {}): ProfileCookie => ({
  name,
  value: "s3cret",
  domain: ".shop.test",
  path: "/",
  secure: true,
  httpOnly: true,
  ...extra,
});

test("a profile with no file has no cookies", async () => {
  expect(await vault().read("p1")).toEqual([]);
});

test("what is written reads back, in a file and a folder only the owner can open", async () => {
  const cookies = [cookie("sid", { sameSite: "Lax", expires: 1_800_003_600 }), cookie("theme")];

  await vault().write("p1", cookies);

  expect(await vault().read("p1")).toEqual(cookies);
  expect((await stat(join(folder(), "p1.json"))).mode & 0o777).toBe(0o600);
  expect((await stat(folder())).mode & 0o777).toBe(0o700);
  expect(await readdir(folder())).toEqual(["p1.json"]);
  expect(JSON.parse(await readFile(join(folder(), "p1.json"), "utf8"))).toMatchObject({
    version: 1,
    savedAt: 1_800_000_000_000,
  });
});

test("a second write replaces the first, and each profile has its own file", async () => {
  await vault().write("p1", [cookie("old")]);
  await vault().write("p1", [cookie("new")]);
  await vault().write("p2", []);

  expect((await vault().read("p1")).map((each) => each.name)).toEqual(["new"]);
  expect(await vault().read("p2")).toEqual([]);
  expect((await readdir(folder())).sort()).toEqual(["p1.json", "p2.json"]);
});

test("a removed profile has no file, and removing it twice is fine", async () => {
  await vault().write("p1", [cookie("sid")]);

  await vault().remove("p1");
  await vault().remove("p1");

  expect(await readdir(folder())).toEqual([]);
  expect(await vault().read("p1")).toEqual([]);
});

test("a file that is not a vault rejects, without quoting the file", async () => {
  await vault().write("p1", [cookie("sid")]);
  await writeFile(join(folder(), "p1.json"), '{"version": 1, "cookies": [{"value": "s3cret"');

  const failure = await vault()
    .read("p1")
    .then(
      () => null,
      (error: unknown) => error,
    );

  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).not.toContain("s3cret");

  await writeFile(join(folder(), "p1.json"), JSON.stringify({ version: 2, cookies: [] }));
  await expect(vault().read("p1")).rejects.toThrow("not readable");
});

test.each(["../escape", "a/b", "", "a.b"])("the id %j is not used as a file name", async (id) => {
  await expect(vault().write(id, [])).rejects.toThrow("not a file name");
  await expect(vault().read(id)).rejects.toThrow("not a file name");
  await expect(vault().remove(id)).rejects.toThrow("not a file name");
});
