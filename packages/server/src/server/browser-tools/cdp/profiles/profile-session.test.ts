import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { SessionInboundMessage, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { BrowserToolsBroker } from "../../broker.js";
import { CdpBrowserService } from "../cdp-browser-service.js";
import { CdpEndpoint } from "../cdp-endpoint.js";
import { CdpTabRegistry } from "../tab-registry.js";
import {
  DEFAULT_CONTEXT,
  startFakeChromium,
  type FakeChromium,
} from "../test-utils/fake-chromium.js";
import { CdpCookieVault } from "./cookie-vault.js";
import { CdpProfileSession } from "./profile-session.js";
import { CdpProfileStore } from "./profile-store.js";
import { CdpProfiles } from "./profiles.js";

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

type Request = Extract<SessionInboundMessage, { type: `browser.cdp.profile.${string}` }>;
type Payload<T extends SessionOutboundMessage["type"]> = Extract<
  SessionOutboundMessage,
  { type: T }
>["payload"];

async function until(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("CdpProfileSession", () => {
  let chromium: FakeChromium;
  let dir: string;
  let service: CdpBrowserService | null;
  let session: CdpProfileSession;
  let sent: SessionOutboundMessage[];
  let nextId: number;

  const build = (withProfiles = true) => {
    const profiles = new CdpProfiles({
      store: new CdpProfileStore(path.join(dir, "cdp-profiles.json")),
      vault: new CdpCookieVault(path.join(dir, "cdp-profiles")),
      logger,
      createId: () => `p${nextId++}`,
    });
    service = new CdpBrowserService({
      endpoint: new CdpEndpoint({ url: chromium.url, fetchTimeoutMs: 500, commandTimeoutMs: 300 }),
      registry: new CdpTabRegistry(path.join(dir, "cdp-tabs.json")),
      broker: new BrowserToolsBroker({}),
      logger,
      reconnect: { minMs: 20, maxMs: 40 },
      ...(withProfiles ? { profiles } : {}),
    });
  };
  const connect = async () => {
    service?.start();
    await until(() => service?.connected === true, "the CDP host");
  };
  /** Sends one request and returns the payload of its answer. */
  async function ask<T extends SessionOutboundMessage["type"]>(
    request: Request,
    answer: T,
  ): Promise<Payload<T>> {
    const emit = (message: SessionOutboundMessage) => void sent.push(message);
    switch (request.type) {
      case "browser.cdp.profile.list.request":
        await session.list(request, emit);
        break;
      case "browser.cdp.profile.create.request":
        await session.create(request, emit);
        break;
      case "browser.cdp.profile.delete.request":
        await session.delete(request, emit);
        break;
      case "browser.cdp.profile.assign.request":
        await session.assign(request, emit);
        break;
      case "browser.cdp.profile.import.request":
        await session.importCookies(request, emit);
        break;
    }
    const reply = sent.at(-1);
    if (!reply || reply.type !== answer) throw new Error(`No ${answer} came back`);
    return (reply as Extract<SessionOutboundMessage, { type: T }>).payload;
  }
  const create = (name: string) =>
    ask(
      { type: "browser.cdp.profile.create.request", requestId: "c", name },
      "browser.cdp.profile.create.response",
    );
  const list = (workspaceId?: string) =>
    ask(
      { type: "browser.cdp.profile.list.request", requestId: "l", workspaceId },
      "browser.cdp.profile.list.response",
    );
  const assign = (workspaceId: string, profileId: string | null) =>
    ask(
      { type: "browser.cdp.profile.assign.request", requestId: "a", workspaceId, profileId },
      "browser.cdp.profile.assign.response",
    );
  const importText = (profileId: string, text: string) =>
    ask(
      {
        type: "browser.cdp.profile.import.request",
        requestId: "i",
        profileId,
        source: { kind: "text", text },
      },
      "browser.cdp.profile.import.response",
    );
  const remove = (profileId: string) =>
    ask(
      { type: "browser.cdp.profile.delete.request", requestId: "d", profileId },
      "browser.cdp.profile.delete.response",
    );
  const exported = JSON.stringify([
    { name: "sid", value: "s3cret", domain: ".shop.test", path: "/", secure: true },
    { name: "old", value: "s3cret", domain: "shop.test", expirationDate: 5 },
  ]);

  beforeEach(async () => {
    chromium = await startFakeChromium();
    dir = await mkdtemp(path.join(os.tmpdir(), "paseo-cdp-profile-session-"));
    sent = [];
    nextId = 1;
    build();
    session = new CdpProfileSession(() => service, logger);
  });
  afterEach(async () => {
    await service?.stop();
    await chromium.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("a daemon with no Docker browser answers every request as unsupported", async () => {
    await service?.stop();
    service = null;

    expect(await list("ws-a")).toEqual({
      requestId: "l",
      profiles: [],
      workspaceProfileId: null,
      error: "browser_unsupported",
    });
    expect((await create("Work")).error).toBe("browser_unsupported");
    expect((await assign("ws-a", null)).error).toBe("browser_unsupported");
    expect((await importText("p1", exported)).error).toBe("browser_unsupported");
    expect((await remove("p1")).error).toBe("browser_unsupported");
  });

  test("a Docker browser built without profiles is unsupported too", async () => {
    build(false);

    expect((await list()).error).toBe("browser_unsupported");
  });

  test("profiles are made, listed and chosen before Chromium ever answered", async () => {
    const made = await create("  Work  ");
    await create("Test user");
    const chosen = await assign("ws-a", "p2");

    expect(made).toEqual({
      requestId: "c",
      profile: { id: "p1", name: "Work", createdAt: expect.any(Number) },
      error: null,
    });
    expect(chosen).toEqual({ requestId: "a", error: null });
    expect(await list("ws-a")).toEqual({
      requestId: "l",
      profiles: [
        { id: "p1", name: "Work", createdAt: expect.any(Number) },
        { id: "p2", name: "Test user", createdAt: expect.any(Number) },
      ],
      workspaceProfileId: "p2",
      error: null,
    });
    expect((await list("ws-b")).workspaceProfileId).toBeNull();
    expect((await list()).workspaceProfileId).toBeNull();
  });

  test("a workspace goes back to Shared", async () => {
    await create("Work");
    await assign("ws-a", "p1");

    await assign("ws-a", null);

    expect((await list("ws-a")).workspaceProfileId).toBeNull();
  });

  test("a name that is taken or cannot be a name is refused with its code", async () => {
    await create("Work");

    expect(await create("WORK")).toEqual({
      requestId: "c",
      profile: null,
      error: "browser_profile_name_taken",
    });
    expect((await create("shared")).error).toBe("browser_profile_name_taken");
    expect((await create("   ")).error).toBe("browser_profile_name_invalid");
    expect((await assign("ws-a", "gone")).error).toBe("browser_profile_not_found");
  });

  test("a profile on the wire does not name its Chromium context", async () => {
    await connect();
    await create("Work");
    await importText("p1", exported);

    const [profile] = (await list()).profiles;

    expect(Object.keys(profile).sort()).toEqual(["createdAt", "id", "name"]);
  });

  test("an import answers with counts and sites, and never with a value", async () => {
    await connect();
    await create("Work");

    const answer = await importText("p1", exported);

    expect(answer).toEqual({
      requestId: "i",
      result: { imported: 1, skipped: 1, sites: ["shop.test"], siteCount: 1 },
      error: null,
    });
    expect(JSON.stringify(sent)).not.toContain("s3cret");
  });

  test("an import that cannot be done answers with why", async () => {
    await create("Work");

    // Chromium has not answered yet.
    expect(await importText("p1", exported)).toEqual({
      requestId: "i",
      result: null,
      error: "browser_no_host",
    });
    await connect();
    expect((await importText("p1", "my cookies")).error).toBe("browser_cookies_unreadable");
    expect((await importText("p1", "[]")).error).toBe("browser_cookies_none");
    expect((await importText("gone", exported)).error).toBe("browser_profile_not_found");
  });

  test("cookies are copied from the Shared profile for the sites named", async () => {
    await connect();
    await create("Work");
    const shared = { value: "s3cret", path: "/", secure: true, httpOnly: true };
    chromium.cookies
      .get(DEFAULT_CONTEXT)
      ?.push(
        { ...shared, name: "gh", domain: ".github.com" },
        { ...shared, name: "bank", domain: "bank.test" },
      );
    const request = (sites: string[]) =>
      ask(
        {
          type: "browser.cdp.profile.import.request",
          requestId: "i",
          profileId: "p1",
          source: { kind: "shared", sites },
        },
        "browser.cdp.profile.import.response",
      );

    expect((await request(["github.com"])).result).toEqual({
      imported: 1,
      skipped: 0,
      sites: ["github.com"],
      siteCount: 1,
    });
    expect((await request(["gitlab.com"])).error).toBe("browser_cookies_none");
    expect((await request([])).error).toBe("browser_cookies_unreadable");
    expect(JSON.stringify(sent)).not.toContain("s3cret");
  });

  test("deleting a profile closes its tabs and frees its workspace", async () => {
    await connect();
    await create("Work");
    await assign("ws-a", "p1");
    await service?.openTab({ workspaceId: "ws-a" });

    const answer = await remove("p1");
    await until(() => service?.listTabs().length === 0, "the tab to close");

    expect(answer).toEqual({ requestId: "d", error: null });
    expect(await list("ws-a")).toMatchObject({ profiles: [], workspaceProfileId: null });
    expect((await remove("p1")).error).toBe("browser_profile_not_found");
  });

  test("a profile cannot be deleted while Chromium does not answer", async () => {
    await create("Work");

    expect((await remove("p1")).error).toBe("browser_no_host");
    expect((await list()).profiles).toHaveLength(1);
  });
});
