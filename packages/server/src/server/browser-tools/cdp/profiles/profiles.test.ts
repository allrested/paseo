import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { CdpConnection } from "../cdp-connection.js";
import { CdpEndpoint, CdpUnreachableError } from "../cdp-endpoint.js";
import {
  DEFAULT_CONTEXT,
  startFakeChromium,
  type FakeChromium,
} from "../test-utils/fake-chromium.js";
import { CookieFileError } from "./cookie-file.js";
import { CdpCookieVault } from "./cookie-vault.js";
import type { ProfileCookie } from "./profile-cookie.js";
import { CdpProfileError, CdpProfileStore } from "./profile-store.js";
import { CdpProfiles, IMPORT_SITES_SHOWN } from "./profiles.js";

const NOW = 1_800_000_000_000;
const LATER = NOW / 1000 + 3600;

let home = "";
let chromium: FakeChromium;
let browser: CdpConnection;
let clock = NOW;
let logs: string[] = [];
let stores: CdpProfileStore[] = [];
let nextId = 1;

const vaultFolder = () => join(home, "browser-tools", "cdp-profiles");
const vault = () => new CdpCookieVault(vaultFolder(), () => clock);

/** A daemon's profiles on this home; a second call is the daemon after a restart. */
async function daemon(): Promise<CdpProfiles> {
  const store = new CdpProfileStore(join(home, "browser-tools", "cdp-profiles.json"));
  stores.push(store);
  const profiles = new CdpProfiles({
    store,
    vault: vault(),
    logger: {
      debug: (_fields: unknown, message?: string) => void logs.push(`debug: ${message}`),
      warn: (_fields: unknown, message?: string) => void logs.push(`warn: ${message}`),
    },
    createId: () => `p${nextId++}`,
    now: () => clock,
  });
  await profiles.load();
  return profiles;
}

async function connected(): Promise<CdpProfiles> {
  const profiles = await daemon();
  await profiles.connected(browser);
  return profiles;
}

const cookie = (name: string, extra: Partial<ProfileCookie> = {}): ProfileCookie => ({
  name,
  value: `value-of-${name}`,
  domain: "shop.test",
  path: "/",
  secure: true,
  httpOnly: true,
  ...extra,
});

const commands = (method: string) =>
  chromium.commands.filter((command) => command.method === method);
const namesIn = (contextId: string) =>
  (chromium.cookies.get(contextId) ?? []).map((each) => String(each.name)).sort();

async function failure(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "cdp-profiles-"));
  chromium = await startFakeChromium();
  browser = await new CdpEndpoint({ url: chromium.url }).connectBrowser();
  clock = NOW;
  logs = [];
  stores = [];
  nextId = 1;
});

afterEach(async () => {
  await Promise.all(stores.map((store) => store.flush()));
  browser.close();
  await chromium.close();
  await rm(home, { recursive: true, force: true });
});

describe("a profile's context", () => {
  test("the first use makes it, and later uses find it", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");

    const first = await profiles.contextFor(work.id);
    const second = await profiles.contextFor(work.id);

    expect(second).toBe(first);
    expect(chromium.cookies.has(first)).toBe(true);
    expect(commands("Target.createBrowserContext")).toHaveLength(1);
    expect(profiles.get(work.id)?.contextId).toBe(first);
  });

  test("two uses at once make one context", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");

    const [first, second] = await Promise.all([
      profiles.contextFor(work.id),
      profiles.contextFor(work.id),
    ]);

    expect(second).toBe(first);
    expect(commands("Target.createBrowserContext")).toHaveLength(1);
  });

  test("it gets the cookies the vault holds, without the expired ones", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");
    await vault().write(work.id, [
      cookie("sid", { expires: LATER }),
      cookie("session"),
      cookie("old", { expires: NOW / 1000 - 1 }),
    ]);

    const contextId = await profiles.contextFor(work.id);

    expect(namesIn(contextId)).toEqual(["session", "sid"]);
  });

  test("after Chromium restarts, a new context gets the saved cookies back", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");
    const before = await profiles.contextFor(work.id);
    chromium.cookies.get(before)?.push(cookie("sid", { expires: LATER }));
    await profiles.save(work.id);

    chromium.dropContext(before);
    const after = await profiles.contextFor(work.id);

    expect(after).not.toBe(before);
    expect(namesIn(after)).toEqual(["sid"]);
    expect(profiles.get(work.id)?.contextId).toBe(after);
  });

  test("a daemon that restarts finds the context Chromium still has", async () => {
    const before = await connected();
    const work = before.create("Work");
    const contextId = await before.contextFor(work.id);
    chromium.cookies.get(contextId)?.push(cookie("unsaved"));
    await before.flush();

    const after = await connected();

    expect(await after.contextFor(work.id)).toBe(contextId);
    expect(commands("Target.createBrowserContext")).toHaveLength(1);
    // The context was not made again, so what was in it is still there.
    expect(namesIn(contextId)).toEqual(["unsaved"]);
  });

  test("a context from before that Chromium no longer has is forgotten at connect", async () => {
    const before = await connected();
    const work = before.create("Work");
    const contextId = await before.contextFor(work.id);
    await before.flush();
    chromium.dropContext(contextId);

    const after = await connected();

    expect(after.get(work.id)).not.toHaveProperty("contextId");
    expect(await after.contextFor(work.id)).not.toBe(contextId);
  });

  test("a vault file that cannot be read is logged, and the profile starts without cookies", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");
    await vault().write(work.id, [cookie("sid")]);
    await writeFile(join(vaultFolder(), `${work.id}.json`), "{ not json");

    const contextId = await profiles.contextFor(work.id);

    expect(namesIn(contextId)).toEqual([]);
    expect(logs).toEqual(["warn: A browser profile's stored cookies are lost"]);
  });

  test("a profile deleted while its context is made gets none", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const makeLate = async () => {
      await gate;
      chromium.cookies.set("LATE", []);
      return { browserContextId: "LATE" };
    };
    chromium.handle("Target.createBrowserContext", makeLate);

    const making = failure(profiles.contextFor(work.id));
    const deleting = profiles.delete(work.id);
    release();

    expect(await making).toBeInstanceOf(CdpProfileError);
    await deleting;
    expect([...chromium.cookies.keys()]).toEqual([DEFAULT_CONTEXT]);
    expect(profiles.list()).toEqual([]);
  });

  test("an unknown profile has none", async () => {
    const profiles = await connected();

    const error = await failure(profiles.contextFor("gone"));

    expect((error as CdpProfileError).code).toBe("browser_profile_not_found");
  });
});

describe("saving a profile's cookies", () => {
  test("they are written when they changed, and not again when they did not", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");
    const contextId = await profiles.contextFor(work.id);
    const file = join(vaultFolder(), `${work.id}.json`);
    const savedAt = async () => JSON.parse(await readFile(file, "utf8")).savedAt as number;

    chromium.cookies.get(contextId)?.push(cookie("sid", { expires: LATER }));
    await profiles.save(work.id);
    clock = NOW + 30_000;
    await profiles.save(work.id);

    expect(await savedAt()).toBe(NOW);
    expect(await vault().read(work.id)).toEqual([cookie("sid", { expires: LATER })]);

    chromium.cookies.get(contextId)?.push(cookie("theme"));
    await profiles.save(work.id);

    expect(await savedAt()).toBe(NOW + 30_000);
    expect((await vault().read(work.id)).map((each) => each.name)).toEqual(["sid", "theme"]);
  });

  test("a profile whose context Chromium dropped keeps what the vault holds", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");
    const contextId = await profiles.contextFor(work.id);
    chromium.cookies.get(contextId)?.push(cookie("sid"));
    await profiles.save(work.id);

    chromium.dropContext(contextId);
    await profiles.save(work.id);

    expect((await vault().read(work.id)).map((each) => each.name)).toEqual(["sid"]);
    expect(profiles.get(work.id)).not.toHaveProperty("contextId");
  });

  test("a profile that was never opened has nothing to save", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");

    await profiles.saveAll([work.id, "gone"]);

    expect(commands("Storage.getCookies")).toEqual([]);
    expect(await readdir(home)).toEqual(["browser-tools"]);
  });

  test("one profile that cannot be saved does not stop the others", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");
    const staging = profiles.create("Staging");
    const workContext = await profiles.contextFor(work.id);
    const stagingContext = await profiles.contextFor(staging.id);
    chromium.cookies.get(workContext)?.push(cookie("a"));
    chromium.cookies.get(stagingContext)?.push(cookie("b"));
    // The vault cannot write where a folder has the file's name.
    await mkdir(join(vaultFolder(), `${work.id}.json`), { recursive: true });

    await profiles.saveAll([work.id, staging.id]);

    expect((await vault().read(staging.id)).map((each) => each.name)).toEqual(["b"]);
    expect(logs).toEqual(["debug: Saving a browser profile's cookies failed"]);
  });
});

describe("importing a cookie file", () => {
  const exported = (entries: Array<Record<string, unknown>>) => JSON.stringify(entries);
  const entry = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    value: `value-of-${name}`,
    domain: "shop.test",
    path: "/",
    ...extra,
  });

  test("the cookies go into the profile and its vault, and the answer has counts and sites", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");

    const result = await profiles.importText(
      work.id,
      exported([
        entry("sid", { domain: ".shop.test", expirationDate: LATER }),
        entry("api", { domain: "api.shop.test" }),
        entry("other", { domain: "bank.test" }),
        entry("old", { expirationDate: 5 }),
      ]),
    );

    const contextId = await profiles.contextFor(work.id);
    expect(result).toEqual({
      imported: 3,
      skipped: 1,
      sites: ["api.shop.test", "bank.test", "shop.test"],
      siteCount: 3,
    });
    expect(namesIn(contextId)).toEqual(["api", "other", "sid"]);
    expect((await vault().read(work.id)).map((each) => each.name).sort()).toEqual([
      "api",
      "other",
      "sid",
    ]);
    expect(JSON.stringify(result)).not.toContain("value-of");
  });

  test("a cookie Chromium refuses fails its batch, and the others still go in", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");
    chromium.refusedCookieNames.add("refused");
    chromium.droppedCookieNames.add("dropped");

    const result = await profiles.importText(
      work.id,
      exported([entry("a"), entry("refused"), entry("dropped"), entry("b")]),
    );

    expect(result).toMatchObject({ imported: 2, skipped: 2 });
    expect(namesIn(await profiles.contextFor(work.id))).toEqual(["a", "b"]);
    // One call for the batch, then one for each cookie.
    expect(commands("Storage.setCookies")).toHaveLength(5);
  });

  test("an import keeps the cookies the profile already had", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");
    const contextId = await profiles.contextFor(work.id);
    chromium.cookies.get(contextId)?.push(cookie("kept"));

    await profiles.importText(work.id, exported([entry("new")]));

    expect(namesIn(contextId)).toEqual(["kept", "new"]);
  });

  test("the first sites are named, and the count says how many there are", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");
    const many = Array.from({ length: IMPORT_SITES_SHOWN + 3 }, (_unused, index) =>
      entry("sid", { domain: `site${String(index).padStart(2, "0")}.test` }),
    );

    const result = await profiles.importText(work.id, exported(many));

    expect(result.sites).toHaveLength(IMPORT_SITES_SHOWN);
    expect(result.sites[0]).toBe("site00.test");
    expect(result.siteCount).toBe(IMPORT_SITES_SHOWN + 3);
  });

  test("a file Chromium keeps nothing of has no cookies", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");
    chromium.droppedCookieNames.add("dropped");

    const error = await failure(profiles.importText(work.id, exported([entry("dropped")])));

    expect((error as CookieFileError).code).toBe("browser_cookies_none");
  });

  test("text that is not a cookie file is refused before Chromium is asked", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");

    const error = await failure(profiles.importText(work.id, "my cookies"));

    expect((error as CookieFileError).code).toBe("browser_cookies_unreadable");
    expect(commands("Target.createBrowserContext")).toEqual([]);
  });

  test("an unknown profile takes no import", async () => {
    const profiles = await connected();

    const error = await failure(profiles.importText("gone", exported([entry("a")])));

    expect((error as CdpProfileError).code).toBe("browser_profile_not_found");
  });
});

describe("importing from the Shared profile", () => {
  beforeEach(() => {
    chromium.cookies
      .get(DEFAULT_CONTEXT)
      ?.push(
        cookie("gh", { domain: ".github.com" }),
        cookie("gh-api", { domain: "api.github.com" }),
        cookie("gh-old", { domain: "github.com", expires: NOW / 1000 - 1 }),
        cookie("lookalike", { domain: "notgithub.com" }),
        cookie("bank", { domain: "bank.test" }),
      );
  });

  test("the cookies of the sites named are copied, with the hosts under them", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");

    const result = await profiles.importShared(work.id, ["https://GitHub.com/login"]);

    expect(result).toEqual({
      imported: 2,
      skipped: 0,
      sites: ["api.github.com", "github.com"],
      siteCount: 2,
    });
    expect(namesIn(await profiles.contextFor(work.id))).toEqual(["gh", "gh-api"]);
    // The Shared profile is read and never written.
    expect(namesIn(DEFAULT_CONTEXT)).toEqual(["bank", "gh", "gh-api", "gh-old", "lookalike"]);
  });

  test("sites with no cookie in Shared have none to copy", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");

    const error = await failure(profiles.importShared(work.id, ["gitlab.com"]));

    expect((error as CookieFileError).code).toBe("browser_cookies_none");
    expect(commands("Target.createBrowserContext")).toEqual([]);
  });

  test.each([[[]], [["github.com", "not a site"]], [Array.from({ length: 21 }, () => "a.test")]])(
    "the sites %j are not a list of sites",
    async (sites) => {
      const profiles = await connected();
      const work = profiles.create("Work");

      const error = await failure(profiles.importShared(work.id, sites));

      expect((error as CookieFileError).code).toBe("browser_cookies_unreadable");
      expect(commands("Storage.getCookies")).toEqual([]);
    },
  );
});

describe("deleting a profile", () => {
  test("its context closes with its tabs, and its cookies and its workspaces' choice go", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");
    const staging = profiles.create("Staging");
    profiles.assign("w1", work.id);
    const contextId = await profiles.contextFor(work.id);
    const tab = chromium.addTarget({ browserContextId: contextId });
    chromium.cookies.get(contextId)?.push(cookie("sid"));
    await profiles.save(work.id);

    await profiles.delete(work.id);

    expect(chromium.cookies.has(contextId)).toBe(false);
    expect(chromium.targets.has(tab.id)).toBe(false);
    expect(await readdir(vaultFolder())).toEqual([]);
    expect(profiles.list().map((profile) => profile.id)).toEqual([staging.id]);
    expect(profiles.profileOf("w1")).toBeNull();
  });

  test("a profile that was never opened is deleted without a word to Chromium", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");

    await profiles.delete(work.id);

    expect(commands("Target.disposeBrowserContext")).toEqual([]);
    expect(profiles.list()).toEqual([]);
  });

  test("an unknown profile cannot be deleted", async () => {
    const profiles = await connected();

    const error = await failure(profiles.delete("gone"));

    expect((error as CdpProfileError).code).toBe("browser_profile_not_found");
  });
});

describe("while Chromium is unreachable", () => {
  test("profiles are listed, made and chosen, and nothing that needs Chromium runs", async () => {
    const profiles = await daemon();
    const work = profiles.create("Work");
    profiles.assign("w1", work.id);

    expect(profiles.list().map((profile) => profile.name)).toEqual(["Work"]);
    expect(profiles.profileOf("w1")?.id).toBe(work.id);
    expect(await failure(profiles.contextFor(work.id))).toBeInstanceOf(CdpUnreachableError);
    expect(await failure(profiles.importText(work.id, "[]"))).toBeInstanceOf(CookieFileError);
    expect(await failure(profiles.importShared(work.id, ["a.test"]))).toBeInstanceOf(
      CdpUnreachableError,
    );
    expect(await failure(profiles.delete(work.id))).toBeInstanceOf(CdpUnreachableError);
    expect(profiles.list()).toHaveLength(1);
    await profiles.save(work.id);
  });

  test("after it goes away, a context from before is not used", async () => {
    const profiles = await connected();
    const work = profiles.create("Work");
    await profiles.contextFor(work.id);

    profiles.disconnected();

    expect(await failure(profiles.contextFor(work.id))).toBeInstanceOf(CdpUnreachableError);
  });
});
