import { describe, expect, test } from "vitest";
import type {
  CdpBrowserCookieImportResult,
  CdpBrowserCookieSource,
  CdpBrowserProfile,
} from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import {
  createProfileManager,
  fileSizeLabel,
  profileErrorKey,
  sitesIn,
  type ProfileApi,
  type ProfileManagerState,
} from "./profile-manager";

const WORK: CdpBrowserProfile = { id: "p1", name: "Work", createdAt: 1 };
const TEST: CdpBrowserProfile = { id: "p2", name: "Test", createdAt: 2 };
const RESULT: CdpBrowserCookieImportResult = {
  imported: 3,
  skipped: 1,
  sites: ["github.com"],
  siteCount: 1,
};

/** A host with these profiles. Each call is recorded; `fail` makes the next call reject. */
function host(profiles: CdpBrowserProfile[] = [WORK], chosen: string | null = null) {
  const calls: unknown[][] = [];
  let failure: string | null = null;
  const answer = async <T>(call: unknown[], value: T): Promise<T> => {
    calls.push(call);
    if (failure !== null) {
      const code = failure;
      failure = null;
      throw new Error(code);
    }
    return value;
  };
  const api: ProfileApi = {
    list: () => answer(["list"], { profiles, workspaceProfileId: chosen }),
    create: (name) => answer(["create", name], { id: "new", name: name.trim(), createdAt: 9 }),
    remove: (profileId) => answer(["remove", profileId], undefined),
    assign: (profileId) => answer(["assign", profileId], undefined),
    importCookies: (profileId, source) => answer(["import", profileId, source], RESULT),
  };
  const states: ProfileManagerState[] = [];
  const manager = createProfileManager({ api, onState: (state) => states.push(state) });
  return { manager, calls, states, fail: (code: string) => (failure = code) };
}

async function ready(...args: Parameters<typeof host>) {
  const made = host(...args);
  await made.manager.load();
  return made;
}

describe("the list", () => {
  test("it starts loading, then holds the profiles and the workspace's choice", async () => {
    const { manager, states } = host([WORK, TEST], "p2");

    expect(manager.getState()).toMatchObject({ status: "loading", profiles: [] });
    await manager.load();

    expect(manager.getState()).toEqual({
      status: "ready",
      profiles: [WORK, TEST],
      chosenId: "p2",
      busy: null,
      error: null,
      imported: null,
    });
    expect(states.map((state) => state.status)).toEqual(["loading", "ready"]);
  });

  test("a list that cannot be read fails with the daemon's code, and loads on a retry", async () => {
    const { manager, fail } = host();
    fail("browser_unsupported");

    await manager.load();
    expect(manager.getState()).toMatchObject({ status: "failed", error: "browser_unsupported" });

    await manager.load();
    expect(manager.getState()).toMatchObject({ status: "ready", error: null });
  });

  test("no command runs before the list is there", async () => {
    const { manager, calls } = host();

    expect(await manager.add("Work")).toBe(false);
    await manager.choose("p1");

    expect(calls).toEqual([]);
  });
});

describe("the workspace's profile", () => {
  test("a choice shows at once and is sent to the host", async () => {
    const { manager, calls, states } = await ready();

    const choosing = manager.choose("p1");
    expect(manager.getState()).toMatchObject({ chosenId: "p1", busy: "choose" });
    await choosing;

    expect(manager.getState()).toMatchObject({ chosenId: "p1", busy: null, error: null });
    expect(calls.at(-1)).toEqual(["assign", "p1"]);
    expect(states.at(-1)).toBe(manager.getState());
  });

  test("a choice the host refuses goes back, with why", async () => {
    const { manager, fail } = await ready([WORK], "p1");
    fail("browser_profile_not_found");

    await manager.choose(null);

    expect(manager.getState()).toMatchObject({
      chosenId: "p1",
      busy: null,
      error: "browser_profile_not_found",
    });
  });

  test("choosing what is chosen sends nothing", async () => {
    const { manager, calls } = await ready([WORK], "p1");

    await manager.choose("p1");

    expect(calls).toEqual([["list"]]);
  });
});

describe("making and deleting", () => {
  test("a new profile joins the end of the list", async () => {
    const { manager, calls } = await ready();

    expect(await manager.add("  Staging ")).toBe(true);

    expect(manager.getState().profiles.map((profile) => profile.name)).toEqual(["Work", "Staging"]);
    expect(calls.at(-1)).toEqual(["create", "  Staging "]);
  });

  test("a name the host refuses leaves the list as it was, with why", async () => {
    const { manager, fail } = await ready();
    fail("browser_profile_name_taken");

    expect(await manager.add("work")).toBe(false);

    expect(manager.getState()).toMatchObject({
      profiles: [WORK],
      error: "browser_profile_name_taken",
    });
  });

  test("a deleted profile leaves the list, and a workspace that used it is on Shared", async () => {
    const { manager } = await ready([WORK, TEST], "p1");

    await manager.remove("p1");

    expect(manager.getState()).toMatchObject({ profiles: [TEST], chosenId: null });
  });

  test("deleting another profile keeps the workspace's choice", async () => {
    const { manager } = await ready([WORK, TEST], "p1");

    await manager.remove("p2");

    expect(manager.getState()).toMatchObject({ profiles: [WORK], chosenId: "p1" });
  });

  test("a profile the host cannot delete stays", async () => {
    const { manager, fail } = await ready();
    fail("browser_no_host");

    await manager.remove("p1");

    expect(manager.getState()).toMatchObject({ profiles: [WORK], error: "browser_no_host" });
  });
});

describe("importing cookies", () => {
  test("the result is kept until it is cleared", async () => {
    const { manager, calls } = await ready();
    const source: CdpBrowserCookieSource = { kind: "shared", sites: ["github.com"] };

    const importing = manager.importCookies("p1", source);
    expect(manager.getState().busy).toBe("import");
    await importing;

    expect(manager.getState()).toMatchObject({ imported: RESULT, busy: null });
    expect(calls.at(-1)).toEqual(["import", "p1", source]);

    manager.clearResult();
    expect(manager.getState()).toMatchObject({ imported: null, error: null });
  });

  test("an import that fails says why, and the next one clears it", async () => {
    const { manager, fail } = await ready();
    fail("browser_cookies_unreadable");

    await manager.importCookies("p1", { kind: "text", text: "my cookies" });
    expect(manager.getState()).toMatchObject({
      imported: null,
      error: "browser_cookies_unreadable",
    });

    await manager.importCookies("p1", { kind: "text", text: "[]" });
    expect(manager.getState()).toMatchObject({ imported: RESULT, error: null });
  });

  test("a second command does not start while one runs", async () => {
    const { manager, calls } = await ready();

    const importing = manager.importCookies("p1", { kind: "text", text: "[]" });
    expect(await manager.add("Staging")).toBe(false);
    await importing;

    expect(calls.map((call) => call[0])).toEqual(["list", "import"]);
  });
});

test("after stop, a late answer changes nothing", async () => {
  const { manager, states } = await ready();
  const before = states.length;

  const adding = manager.add("Staging");
  manager.stop();
  await adding;

  expect(states).toHaveLength(before + 1);
  expect(manager.getState().profiles).toEqual([WORK]);
});

test.each([
  ["github.com", ["github.com"]],
  ["github.com, gitlab.com", ["github.com", "gitlab.com"]],
  ["  github.com\n gitlab.com ,, ", ["github.com", "gitlab.com"]],
  ["", []],
  [" , ", []],
])("the sites in %j are %j", (text, sites) => {
  expect(sitesIn(text)).toEqual(sites);
});

test("a daemon code has its own message, and any other code the general one", () => {
  expect(profileErrorKey("browser_profile_name_taken")).toBe(
    "cdpBrowser.profiles.errors.nameTaken",
  );
  expect(profileErrorKey("browser_cookies_too_large")).toBe(
    "cdpBrowser.profiles.errors.cookiesTooLarge",
  );
  expect(profileErrorKey("browser_timeout")).toBe("cdpBrowser.profiles.errors.unknown");
  expect(profileErrorKey("toString")).toBe("cdpBrowser.profiles.errors.unknown");
});

test.each([
  [512, "512 B"],
  [12_300, "12 KB"],
  [1024 * 1024 * 2.5, "2.5 MB"],
])("a file of %d bytes reads %s", (bytes, label) => {
  expect(fileSizeLabel(bytes)).toBe(label);
});
