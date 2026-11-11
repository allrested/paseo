import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { BrowserToolsBroker } from "../broker.js";
import {
  AGENT_ACTIVITY_MS,
  CdpBrowserService,
  MAX_DAEMON_TABS,
  cdpErrorCode,
  clampViewport,
  isOpenableUrl,
  type CdpBrowserEvent,
} from "./cdp-browser-service.js";
import { CdpClosedError, CdpTimeoutError } from "./cdp-connection.js";
import { CdpEndpoint, CdpUnreachableError } from "./cdp-endpoint.js";
import { CdpTabRegistry } from "./tab-registry.js";
import { startFakeChromium, type FakeChromium } from "./test-utils/fake-chromium.js";

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

async function until(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("CdpBrowserService", () => {
  let chromium: FakeChromium;
  let dir: string;
  let file: string;
  let broker: BrowserToolsBroker;
  let service: CdpBrowserService;
  let events: CdpBrowserEvent[];
  let reachable: boolean;
  let now: number;

  const build = (log = logger) => {
    service = new CdpBrowserService({
      endpoint: new CdpEndpoint({
        url: `http://chromium-host:${chromium.port}`,
        fetchTimeoutMs: 500,
        // Far below the broker's timeout, so a stalled command fails in the host first.
        commandTimeoutMs: 300,
        lookup: async () => {
          if (!reachable) throw new Error("ENOTFOUND chromium-host");
          return "127.0.0.1";
        },
      }),
      registry: new CdpTabRegistry(file),
      broker,
      logger: log,
      now: () => now,
      reconnect: { minMs: 20, maxMs: 40 },
    });
    service.subscribe((event) => events.push(event));
  };
  const started = async () => {
    service.start();
    await until(() => service.connected, "the CDP host to connect");
  };
  const newTab = async (workspaceId = "ws-a", url = "https://example.com/") => {
    const payload = await broker.execute({
      command: { command: "new_tab", args: { url } },
      workspaceId,
    });
    if (!payload.ok || payload.result.command !== "new_tab")
      throw new Error(JSON.stringify(payload));
    return payload.result;
  };

  beforeEach(async () => {
    chromium = await startFakeChromium();
    dir = await mkdtemp(path.join(os.tmpdir(), "paseo-cdp-service-"));
    file = path.join(dir, "browser-tools", "cdp-tabs.json");
    broker = new BrowserToolsBroker({});
    events = [];
    reachable = true;
    now = 1_000;
    build();
  });
  afterEach(async () => {
    await service.stop();
    await chromium.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("registers with the broker once CDP answers", async () => {
    expect(broker.getRegisteredClientCount()).toBe(0);
    await started();
    expect(broker.getRegisteredClientCount()).toBe(1);
    expect(events).toContainEqual({ kind: "host", connected: true });
  });

  test("new_tab opens a background window and registers the tab", async () => {
    await started();
    const result = await newTab();
    expect(result).toMatchObject({ workspaceId: "ws-a", url: "https://example.com/" });
    expect(
      chromium.commands.find((command) => command.method === "Target.createTarget")?.params,
    ).toEqual({
      url: "https://example.com/",
      newWindow: true,
      background: true,
    });
    expect(service.listTabs().map((tab) => tab.browserId)).toEqual([result.browserId]);
    expect(events.filter((event) => event.kind === "opened")).toHaveLength(1);
  });

  test("openTab refuses a URL that is not http, https or about:blank", async () => {
    await started();
    // The broker's schema already rejects file: URLs, so the service's own guard is tested directly.
    await expect(
      service.openTab({ workspaceId: "ws-a", url: "file:///etc/passwd" }),
    ).rejects.toThrow("Only http and https URLs can be opened.");
    expect(chromium.commands.some((command) => command.method === "Target.createTarget")).toBe(
      false,
    );
    expect(service.listTabs()).toEqual([]);
  });

  test("openTab refuses a tab past the cap and asks for one to be closed first", async () => {
    await started();
    for (let index = 0; index < MAX_DAEMON_TABS; index += 1) await newTab();
    const payload = await broker.execute({
      command: { command: "new_tab", args: { url: "https://example.com/" } },
      workspaceId: "ws-a",
    });
    expect(payload).toMatchObject({
      ok: false,
      error: { code: "browser_unknown_error", message: expect.stringContaining("Close a tab") },
    });
    expect(
      chromium.commands.filter((command) => command.method === "Target.createTarget"),
    ).toHaveLength(MAX_DAEMON_TABS);
    expect(service.listTabs()).toHaveLength(MAX_DAEMON_TABS);
  });

  test("the Docker host refuses upload: Chromium's container does not have the daemon's files", async () => {
    await started();
    const tab = await newTab();
    const payload = await broker.execute({
      command: {
        command: "upload",
        args: { browserId: tab.browserId, ref: "@e1", filePaths: ["uploads/a.txt"] },
      },
      workspaceId: "ws-a",
    });
    expect(payload).toMatchObject({ ok: false, error: { code: "browser_unsupported" } });
    expect(chromium.commands.some((command) => command.method === "DOM.setFileInputFiles")).toBe(
      false,
    );
  });

  test("list_tabs shows only the daemon's own tabs", async () => {
    chromium.addTarget({ id: "USER-TAB", url: "https://mail.example.com/" });
    await started();
    const mine = await newTab();
    const payload = await broker.execute({
      command: { command: "list_tabs" },
      workspaceId: "ws-a",
    });
    if (!payload.ok || payload.result.command !== "list_tabs")
      throw new Error(JSON.stringify(payload));
    expect(payload.result.tabs.map((tab) => tab.browserId)).toEqual([mine.browserId]);
  });

  test("close_tab closes only the registered target", async () => {
    const foreign = chromium.addTarget({ id: "USER-TAB" });
    await started();
    const mine = await newTab();
    const payload = await broker.execute({
      command: { command: "close_tab", args: { browserId: mine.browserId } },
      workspaceId: "ws-a",
    });
    expect(payload).toMatchObject({
      ok: true,
      result: { command: "close_tab", browserId: mine.browserId },
    });
    expect(chromium.targets.has(foreign.id)).toBe(true);
    expect(chromium.targets.size).toBe(1);
    expect(service.listTabs()).toEqual([]);
    expect(events.filter((event) => event.kind === "closed")).toEqual([
      {
        kind: "closed",
        browserId: mine.browserId,
        workspaceId: "ws-a",
        lastUrl: "https://example.com/",
      },
    ]);
  });

  test("close_tab keeps the tab when Chromium fails to close it, and forgets one already gone", async () => {
    await started();
    const tab = await newTab();
    chromium.handle("Target.closeTarget", () => {
      throw new Error("Internal error");
    });
    const payload = await broker.execute({
      command: { command: "close_tab", args: { browserId: tab.browserId } },
      workspaceId: "ws-a",
    });
    expect(payload).toMatchObject({ ok: false });
    expect(service.listTabs().map((entry) => entry.browserId)).toEqual([tab.browserId]);
    expect(events.some((event) => event.kind === "closed")).toBe(false);
    chromium.handle("Target.closeTarget", () => {
      throw new Error("No target with given id found");
    });
    await expect(service.closeTab(tab.browserId)).resolves.toBe(true);
    expect(service.listTabs()).toEqual([]);
  });

  test("a target destroyed elsewhere drops from the registry; a stranger's is ignored", async () => {
    const foreign = chromium.addTarget({ id: "USER-TAB" });
    await started();
    const mine = await newTab();
    chromium.destroyTarget(foreign.id);
    const targetId = [...chromium.targets.keys()][0];
    chromium.destroyTarget(targetId);
    await until(() => service.listTabs().length === 0, "the tab to drop");
    expect(
      events
        .filter((event) => event.kind === "closed")
        .map((event) => event.kind === "closed" && event.browserId),
    ).toEqual([mine.browserId]);
  });

  test("a popup of a registered tab joins its workspace", async () => {
    await started();
    const opener = await newTab("ws-b");
    const openerTarget = [...chromium.targets.keys()][0];
    chromium.addTarget({ url: "https://example.com/popup", openerId: openerTarget });
    chromium.addTarget({ url: "https://other.example/", openerId: "UNKNOWN" });
    await until(() => service.listTabs().length === 2, "the popup to be adopted");
    const popup = service.listTabs().find((tab) => tab.browserId !== opener.browserId);
    expect(popup).toMatchObject({ workspaceId: "ws-b", url: "https://example.com/popup" });
  });

  test("an agent command marks the tab active for 3 seconds", async () => {
    await started();
    const tab = await newTab();
    now = 5_000;
    events.length = 0;
    await broker.execute({
      command: { command: "resize", args: { browserId: tab.browserId, width: 800, height: 600 } },
      workspaceId: "ws-a",
    });
    expect(service.listTabs()[0].agentActiveUntil).toBe(5_000 + AGENT_ACTIVITY_MS);
    expect(
      events.some((event) => event.kind === "state" && event.tab.agentActiveUntil === 8_000),
    ).toBe(true);
  });

  test("a command that times out answers with a retryable timeout", async () => {
    await started();
    const tab = await newTab();
    chromium.stall("Runtime.evaluate");
    const payload = await broker.execute({
      command: { command: "evaluate", args: { browserId: tab.browserId, function: "() => 1" } },
      workspaceId: "ws-a",
      timeoutMs: 10_000,
    });
    expect(payload).toMatchObject({
      ok: false,
      error: { code: "browser_timeout", retryable: true },
    });
  });

  test("stays unregistered while CDP is unreachable and connects when it comes back", async () => {
    reachable = false;
    service.start();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(service.connected).toBe(false);
    const payload = await broker.execute({
      command: { command: "new_tab", args: {} },
      workspaceId: "ws-a",
    });
    expect(payload).toMatchObject({ ok: false, error: { code: "browser_no_host" } });
    reachable = true;
    await until(() => service.connected, "the reconnect");
    expect(broker.getRegisteredClientCount()).toBe(1);
  });

  test("at start it drops entries whose target is gone", async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        tabs: [
          {
            browserId: "22222222-2222-4222-8222-222222222222",
            targetId: "GONE",
            workspaceId: "ws-a",
            lastUrl: "https://example.com/old",
            createdAt: 1,
          },
        ],
      }),
    );
    await started();
    expect(service.listTabs()).toEqual([]);
    expect(events).toContainEqual({
      kind: "closed",
      browserId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "ws-a",
      lastUrl: "https://example.com/old",
    });
  });

  test("an unreachable Chromium is logged once at warn, and its return at info", async () => {
    const lines: string[] = [];
    const record = (level: string) => (context: unknown, message?: string) =>
      void lines.push(`${level} ${message ?? String(context)}`);
    build({ debug: () => {}, info: record("info"), warn: record("warn"), error: record("error") });
    reachable = false;
    service.start();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(lines).toEqual(["warn Docker browser CDP is unreachable"]);
    reachable = true;
    await until(() => service.connected, "the reconnect");
    expect(lines).toEqual([
      "warn Docker browser CDP is unreachable",
      "info Docker browser CDP is reachable again",
    ]);
  });

  test("a disconnect unregisters the host and reports it", async () => {
    await started();
    await chromium.close();
    await until(() => !service.connected, "the disconnect");
    expect(broker.getRegisteredClientCount()).toBe(0);
    expect(events).toContainEqual({ kind: "host", connected: false });
  });

  test("the last interacting owner sets the viewport", async () => {
    await started();
    const tab = await newTab();
    await service.setViewport(
      tab.browserId,
      { width: 390, height: 700, deviceScaleFactor: 3 },
      "viewer-1",
    );
    expect(service.viewportOwner(tab.browserId)).toBe("viewer-1");
    expect(
      chromium.commands.findLast(
        (command) => command.method === "Emulation.setDeviceMetricsOverride",
      )?.params,
    ).toEqual({
      width: 390,
      height: 700,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await broker.execute({
      command: { command: "resize", args: { browserId: tab.browserId, width: 1280, height: 800 } },
      workspaceId: "ws-a",
    });
    expect(service.viewportOwner(tab.browserId)).toBe("agent");
  });

  test("an agent resize answers with the size it applied", async () => {
    await started();
    const tab = await newTab();
    const payload = await broker.execute({
      command: { command: "resize", args: { browserId: tab.browserId, width: 5000, height: 10 } },
      workspaceId: "ws-a",
    });
    expect(payload).toMatchObject({
      ok: true,
      result: { command: "resize", browserId: tab.browserId, width: 1920, height: 240 },
    });
    expect(
      chromium.commands.findLast(
        (command) => command.method === "Emulation.setDeviceMetricsOverride",
      )?.params,
    ).toEqual({ width: 1920, height: 240, deviceScaleFactor: 1, mobile: false });
  });

  test("a viewer's frames come from the tab's socket and stop when the tab closes", async () => {
    await started();
    const tab = await newTab();
    const targetId = [...chromium.targets.keys()][0];
    const frames: number[] = [];
    await service.screencast.watch(tab.browserId, {
      id: "v",
      deliver: async (frame) => void frames.push(frame.sequence),
    });
    expect(chromium.commands.some((command) => command.method === "Page.startScreencast")).toBe(
      true,
    );
    chromium.emit(targetId, "Page.screencastFrame", {
      data: Buffer.from([0xff, 0xd8]).toString("base64"),
      sessionId: 1,
      metadata: {
        deviceWidth: 800,
        deviceHeight: 600,
        pageScaleFactor: 1,
        scrollOffsetX: 0,
        scrollOffsetY: 0,
      },
    });
    await until(() => frames.length > 0, "a frame");
    await service.closeTab(tab.browserId);
    expect(service.screencast.viewerCount(tab.browserId)).toBe(0);
  });

  test("a watched tab re-attaches after a timed-out command and its viewer keeps getting frames", async () => {
    await started();
    const tab = await newTab();
    const targetId = [...chromium.targets.keys()][0];
    const frames: number[] = [];
    await service.screencast.watch(tab.browserId, {
      id: "v",
      deliver: async (frame) => void frames.push(frame.sequence),
    });
    const starts = () =>
      chromium.commands.filter((command) => command.method === "Page.startScreencast").length;
    expect(starts()).toBe(1);
    chromium.stall("Runtime.evaluate");
    const payload = await broker.execute({
      command: { command: "evaluate", args: { browserId: tab.browserId, function: "() => 1" } },
      workspaceId: "ws-a",
      timeoutMs: 10_000,
    });
    expect(payload).toMatchObject({ ok: false, error: { code: "browser_timeout" } });
    // No input, agent command or new subscribe follows: the service re-attaches on its own.
    await until(() => starts() === 2, "the screencast to restart on the new socket");
    await until(() => chromium.socketCount(targetId) === 1, "the old socket to close");
    chromium.emit(targetId, "Page.screencastFrame", {
      data: Buffer.from([0xff, 0xd8]).toString("base64"),
      sessionId: 2,
      metadata: { deviceWidth: 800, deviceHeight: 600, pageScaleFactor: 1 },
    });
    await until(() => frames.length > 0, "a frame from the new socket");
    expect(service.screencast.viewerCount(tab.browserId)).toBe(1);
  });

  test("clampViewport holds the limits", () => {
    expect(clampViewport({ width: 5000, height: 10, deviceScaleFactor: 0.5 })).toEqual({
      width: 1920,
      height: 240,
      deviceScaleFactor: 1,
    });
  });

  test("isOpenableUrl allows http, https and about:blank only", () => {
    expect(
      ["https://a.example/", "http://a.example/", "about:blank", "file:///etc/passwd", "nope"].map(
        isOpenableUrl,
      ),
    ).toEqual([true, true, true, false, false]);
  });

  test("cdpErrorCode maps CDP failures to broker error codes", () => {
    expect(
      [
        new CdpTimeoutError("Runtime.evaluate", 10),
        new CdpUnreachableError("down"),
        new CdpClosedError(),
        // The screencast hub's watch rejects with this when the tab has no socket.
        new Error("browser_tab_not_found"),
        new Error("other"),
      ].map(cdpErrorCode),
    ).toEqual([
      "browser_timeout",
      "browser_no_host",
      "browser_no_host",
      "browser_tab_not_found",
      "browser_unknown_error",
    ]);
  });
});
