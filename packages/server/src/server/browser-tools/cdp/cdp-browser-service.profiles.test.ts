import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { BrowserToolsBroker } from "../broker.js";
import { CdpBrowserService, type CdpBrowserEvent } from "./cdp-browser-service.js";
import { CdpEndpoint } from "./cdp-endpoint.js";
import { CdpCookieVault } from "./profiles/cookie-vault.js";
import { CdpProfileStore } from "./profiles/profile-store.js";
import { CdpProfiles } from "./profiles/profiles.js";
import { CdpTabRegistry } from "./tab-registry.js";
import { startFakeChromium, type FakeChromium } from "./test-utils/fake-chromium.js";

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

async function until(condition: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("CdpBrowserService with browser profiles", () => {
  let chromium: FakeChromium;
  let dir: string;
  let broker: BrowserToolsBroker;
  let service: CdpBrowserService;
  let profiles: CdpProfiles;
  let events: CdpBrowserEvent[];
  let nextId: number;

  const folder = () => path.join(dir, "browser-tools");
  const vault = () => new CdpCookieVault(path.join(folder(), "cdp-profiles"));
  /** A daemon on this home; a second call is the daemon after a restart. */
  const build = (profileSaveIntervalMs = 60_000) => {
    profiles = new CdpProfiles({
      store: new CdpProfileStore(path.join(folder(), "cdp-profiles.json")),
      vault: vault(),
      logger,
      createId: () => `p${nextId++}`,
    });
    service = new CdpBrowserService({
      endpoint: new CdpEndpoint({ url: chromium.url, fetchTimeoutMs: 500, commandTimeoutMs: 300 }),
      registry: new CdpTabRegistry(path.join(folder(), "cdp-tabs.json")),
      broker,
      logger,
      reconnect: { minMs: 20, maxMs: 40 },
      profiles,
      profileSaveIntervalMs,
    });
    service.subscribe((event) => events.push(event));
  };
  const started = async () => {
    service.start();
    await until(() => service.connected, "the CDP host to connect");
  };
  /** A workspace on a new named profile. */
  const onProfile = (workspaceId: string, name: string) => {
    const profile = profiles.create(name);
    profiles.assign(workspaceId, profile.id);
    return profile;
  };
  const created = () =>
    chromium.commands
      .filter((command) => command.method === "Target.createTarget")
      .map((command) => command.params.browserContextId);
  const cookie = (name: string) => ({
    name,
    value: "v",
    domain: "shop.test",
    path: "/",
    secure: true,
    httpOnly: true,
  });
  const saved = async (profileId: string) =>
    (await vault().read(profileId)).map((each) => each.name);

  beforeEach(async () => {
    chromium = await startFakeChromium();
    dir = await mkdtemp(path.join(os.tmpdir(), "paseo-cdp-profiles-"));
    broker = new BrowserToolsBroker({});
    events = [];
    nextId = 1;
    build();
  });
  afterEach(async () => {
    await service.stop();
    await chromium.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("a workspace's tabs open in the profile it chose, an agent's too", async () => {
    await started();
    const work = onProfile("ws-a", "Work");

    const mine = await service.openTab({ workspaceId: "ws-a", url: "https://shop.test/" });
    const agents = await broker.execute({
      command: { command: "new_tab", args: { url: "https://shop.test/cart" } },
      workspaceId: "ws-a",
    });
    const other = await service.openTab({ workspaceId: "ws-b" });

    const contextId = await profiles.contextFor(work.id);
    expect(created()).toEqual([contextId, contextId, undefined]);
    expect(mine.profile).toEqual({ id: work.id, name: "Work" });
    expect(agents.ok).toBe(true);
    expect(service.listTabs().map((tab) => tab.profile?.name ?? null)).toEqual([
      "Work",
      "Work",
      null,
    ]);
    expect(other.profile).toBeNull();
  });

  test("a tab keeps the profile it opened in when its workspace picks another", async () => {
    await started();
    onProfile("ws-a", "Work");
    const first = await service.openTab({ workspaceId: "ws-a" });

    profiles.assign("ws-a", null);
    const second = await service.openTab({ workspaceId: "ws-a" });

    expect(service.listTabs().map((tab) => [tab.browserId, tab.profile?.name ?? null])).toEqual([
      [first.browserId, "Work"],
      [second.browserId, null],
    ]);
  });

  test("a popup is in its opener's profile", async () => {
    await started();
    const work = onProfile("ws-a", "Work");
    const opener = await service.openTab({ workspaceId: "ws-a" });
    const openerTarget = [...chromium.targets.values()][0];

    chromium.addTarget({
      openerId: openerTarget.id,
      browserContextId: openerTarget.browserContextId,
      url: "https://shop.test/pay",
    });
    await until(() => service.listTabs().length === 2, "the popup to be adopted");

    const popup = service.listTabs().find((tab) => tab.browserId !== opener.browserId);
    expect(popup?.profile).toEqual({ id: work.id, name: "Work" });
  });

  test("closing a tab writes its profile's cookies down first", async () => {
    await started();
    const work = onProfile("ws-a", "Work");
    const tab = await service.openTab({ workspaceId: "ws-a" });
    chromium.cookies.get(await profiles.contextFor(work.id))?.push(cookie("sid"));

    await service.closeTab(tab.browserId);

    expect(await saved(work.id)).toEqual(["sid"]);
    const methods = chromium.commands.map((command) => command.method);
    expect(methods.indexOf("Storage.getCookies")).toBeLessThan(
      methods.indexOf("Target.closeTarget"),
    );
  });

  test("a tab closed from elsewhere has its profile's cookies written down", async () => {
    await started();
    const work = onProfile("ws-a", "Work");
    await service.openTab({ workspaceId: "ws-a" });
    chromium.cookies.get(await profiles.contextFor(work.id))?.push(cookie("sid"));

    chromium.destroyTarget([...chromium.targets.keys()][0]);

    await until(async () => (await saved(work.id)).length === 1, "the cookies to be saved");
  });

  test("the cookies of a profile with an open tab are written down as time passes", async () => {
    await service.stop();
    build(20);
    await started();
    const work = onProfile("ws-a", "Work");
    const idle = profiles.create("Idle");
    await service.openTab({ workspaceId: "ws-a" });
    chromium.cookies.get(await profiles.contextFor(work.id))?.push(cookie("sid"));
    chromium.cookies.get(await profiles.contextFor(idle.id))?.push(cookie("unsaved"));

    await until(async () => (await saved(work.id)).length === 1, "the cookies to be saved");

    // A profile with no open tab cannot have changed since its last tab closed.
    expect(await saved(idle.id)).toEqual([]);
  });

  test("stopping the daemon writes the open profiles' cookies down", async () => {
    await started();
    const work = onProfile("ws-a", "Work");
    await service.openTab({ workspaceId: "ws-a" });
    chromium.cookies.get(await profiles.contextFor(work.id))?.push(cookie("sid"));

    await service.stop();

    expect(await saved(work.id)).toEqual(["sid"]);
  });

  test("after the daemon restarts, a tab is still in its profile and its context is used again", async () => {
    await started();
    const work = onProfile("ws-a", "Work");
    await service.openTab({ workspaceId: "ws-a" });
    await service.stop();

    build();
    await started();
    await service.openTab({ workspaceId: "ws-a" });

    expect(service.listTabs().map((tab) => tab.profile)).toEqual([
      { id: work.id, name: "Work" },
      { id: work.id, name: "Work" },
    ]);
    expect(created()[0]).toBe(created()[1]);
    expect(
      chromium.commands.filter((command) => command.method === "Target.createBrowserContext"),
    ).toHaveLength(1);
  });

  test("after Chromium restarts, the workspace's next tab has the saved cookies", async () => {
    await started();
    const work = onProfile("ws-a", "Work");
    await service.openTab({ workspaceId: "ws-a" });
    const before = await profiles.contextFor(work.id);
    chromium.cookies.get(before)?.push(cookie("sid"));
    await profiles.save(work.id);

    chromium.dropContext(before);
    await until(() => service.listTabs().length === 0, "the tabs to close");
    await service.openTab({ workspaceId: "ws-a" });

    const after = await profiles.contextFor(work.id);
    expect(after).not.toBe(before);
    expect(chromium.cookies.get(after)?.map((each) => each.name)).toEqual(["sid"]);
  });

  test("deleting a profile closes its tabs, and the workspace's next tab is in Shared", async () => {
    await started();
    const work = onProfile("ws-a", "Work");
    const tab = await service.openTab({ workspaceId: "ws-a", url: "https://shop.test/" });

    await profiles.delete(work.id);
    await until(() => service.listTabs().length === 0, "the tab to close");
    const next = await service.openTab({ workspaceId: "ws-a" });

    expect(events).toContainEqual({
      kind: "closed",
      browserId: tab.browserId,
      workspaceId: "ws-a",
      lastUrl: "https://shop.test/",
    });
    expect(next.profile).toBeNull();
    expect(created().at(-1)).toBeUndefined();
  });

  test("a tab is not opened when its profile's context cannot be made", async () => {
    await started();
    onProfile("ws-a", "Work");
    chromium.handle("Target.createBrowserContext", () => {
      throw new Error("no more contexts");
    });

    await expect(service.openTab({ workspaceId: "ws-a" })).rejects.toThrow("no more contexts");

    expect(created()).toEqual([]);
    expect(service.listTabs()).toEqual([]);
  });
});
