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
  correctFrameSize,
  isOpenableUrl,
  type CdpBrowserEvent,
} from "./cdp-browser-service.js";
import { CdpClosedError, CdpTimeoutError } from "./cdp-connection.js";
import { CdpEndpoint, CdpUnreachableError } from "./cdp-endpoint.js";
import { CdpTabRegistry } from "./tab-registry.js";
import { startFakeChromium, type FakeChromium } from "./test-utils/fake-chromium.js";

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** A JPEG start and frame header of this pixel size; enough for the daemon to read the size. */
function jpegOfSize(width: number, height: number): string {
  const header = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff];
  return Buffer.from([...header, width >> 8, width & 0xff, 0x03, ...Array(9).fill(0)]).toString(
    "base64",
  );
}

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

  const build = (log = logger, frameWaitMs?: number) => {
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
      frameWaitMs,
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

  describe("frames of another size than the one set", () => {
    const frameOfSize = (deviceWidth: number, deviceHeight: number) => ({
      data: Buffer.from([0xff, 0xd8]).toString("base64"),
      sessionId: 1,
      metadata: { deviceWidth, deviceHeight, pageScaleFactor: 1 },
    });
    /** A watched tab whose viewport the daemon set to 800x600, and a frame sender. */
    const watchedAt800 = async () => {
      await started();
      const tab = await newTab();
      // The agent's new_tab showed the badge; the checks below run with no agent on the tab.
      now += AGENT_ACTIVITY_MS;
      const targetId = [...chromium.targets.keys()][0];
      let delivered = 0;
      let lastSize: [number, number] | null = null;
      const sizes: string[] = [];
      const unwatch = await service.screencast.watch(tab.browserId, {
        id: "v",
        deliver: async (sent) => {
          delivered += 1;
          lastSize = [sent.deviceWidth, sent.deviceHeight];
          sizes.push(`${sent.deviceWidth}x${sent.deviceHeight}`);
        },
      });
      await service.setViewport(
        tab.browserId,
        { width: 800, height: 600, deviceScaleFactor: 1 },
        "viewer-1",
      );
      const overrides = () =>
        chromium.commands
          .filter((command) => command.method === "Emulation.setDeviceMetricsOverride")
          .map((command) => command.params);
      const frame = async (width: number, height: number) => {
        const before = delivered;
        chromium.emit(targetId, "Page.screencastFrame", frameOfSize(width, height));
        await until(() => delivered > before, "the frame");
        // A re-apply would go out right after the frame; give it the time to.
        await new Promise((resolve) => setTimeout(resolve, 30));
      };
      return {
        tab,
        overrides,
        frame,
        setCount: overrides().length,
        viewerSize: () => lastSize,
        viewerSizes: () => sizes,
        unwatch,
      };
    };
    const SET = { width: 800, height: 600, deviceScaleFactor: 1, mobile: false };

    test("re-applies the size set, at most once a second", async () => {
      const { overrides, frame, setCount } = await watchedAt800();
      now += 1_000;
      // The tab's Chromium window was resized: frames report the window's view size.
      await frame(1368, 934);
      expect(overrides().slice(setCount)).toEqual([SET]);
      await frame(1368, 934);
      now += 999;
      await frame(1368, 934);
      expect(overrides().slice(setCount)).toEqual([SET]);
      now += 1;
      await frame(1368, 934);
      expect(overrides().slice(setCount)).toEqual([SET, SET]);
    });

    test("leaves the frames of a resize that is still settling alone", async () => {
      const { tab, overrides, frame } = await watchedAt800();
      now += 1_000;
      await service.setViewport(
        tab.browserId,
        { width: 390, height: 700, deviceScaleFactor: 1 },
        "viewer-2",
      );
      const setCount = overrides().length;
      // Frames of the old size still come while Chromium applies the new one.
      now += 500;
      await frame(800, 600);
      expect(overrides().length).toBe(setCount);
      // A frame of the new size ends the settling: a later mismatch is the window's.
      await frame(390, 700);
      await frame(800, 600);
      expect(overrides().slice(setCount)).toEqual([
        { width: 390, height: 700, deviceScaleFactor: 1, mobile: false },
      ]);
    });

    const answersAtOnce = () => ({ result: { type: "undefined" } });
    const paintsTallWhileRunning = (_params: Record<string, unknown>, target: string) => {
      now += AGENT_ACTIVITY_MS + 1_000;
      chromium.emit(target, "Page.screencastFrame", frameOfSize(800, 4000));
      return answersAtOnce();
    };

    test("leaves frames alone while an agent command runs on the tab and while its badge shows", async () => {
      const { tab, overrides, frame, setCount } = await watchedAt800();
      // A full-page screenshot changes the emulated size while it captures; a frame may come out
      // then. The command outlasts the badge, which counts from its start.
      chromium.handle("Runtime.evaluate", paintsTallWhileRunning);
      await broker.execute({
        command: { command: "evaluate", args: { browserId: tab.browserId, function: "() => 1" } },
        workspaceId: "ws-a",
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(overrides().slice(setCount)).toEqual([]);
      // The agent's next command answers at once; its badge still shows.
      chromium.handle("Runtime.evaluate", answersAtOnce);
      await broker.execute({
        command: { command: "evaluate", args: { browserId: tab.browserId, function: "() => 1" } },
        workspaceId: "ws-a",
      });
      await frame(1368, 934);
      expect(overrides().slice(setCount)).toEqual([]);
      // Once the badge has cleared, a frame of another size is re-applied again.
      now += AGENT_ACTIVITY_MS;
      await frame(1368, 934);
      expect(overrides().slice(setCount)).toEqual([SET]);
    });

    /** The watched tab set to another size at a scale factor, with its settling over. */
    const watchedAtScale = async (viewport: { width: number; height: number; scale: number }) => {
      const watched = await watchedAt800();
      await service.setViewport(
        watched.tab.browserId,
        { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.scale },
        "viewer-2",
      );
      now += 1_000;
      return { ...watched, setCount: watched.overrides().length };
    };

    test("takes a frame of the size set times its scale factor 2 as the size set", async () => {
      const { overrides, frame, setCount, viewerSize } = await watchedAtScale({
        width: 844,
        height: 245,
        scale: 2,
      });
      // Chromium sometimes reports a frame in device pixels.
      await frame(1688, 490);
      expect(viewerSize()).toEqual([844, 245]);
      await frame(1689, 489);
      expect(viewerSize()).toEqual([844, 245]);
      expect(overrides().slice(setCount)).toEqual([]);
      // A window close to the size set is still the window's size.
      await frame(845, 246);
      expect(viewerSize()).toEqual([845, 246]);
      expect(overrides().slice(setCount)).toEqual([
        { width: 844, height: 245, deviceScaleFactor: 2, mobile: false },
      ]);
    });

    test("takes a frame of the size set times scale factor 1.5, rounded, as the size set", async () => {
      const { overrides, frame, setCount, viewerSize } = await watchedAtScale({
        width: 391,
        height: 241,
        scale: 1.5,
      });
      // 391x241 at 1.5 is 586.5x361.5 device pixels; Chromium rounds either way.
      await frame(586, 361);
      expect(viewerSize()).toEqual([391, 241]);
      await frame(587, 362);
      expect(viewerSize()).toEqual([391, 241]);
      expect(overrides().slice(setCount)).toEqual([]);
      await frame(588, 362);
      expect(viewerSize()).toEqual([588, 362]);
      expect(overrides().slice(setCount)).toEqual([
        { width: 391, height: 241, deviceScaleFactor: 1.5, mobile: false },
      ]);
    });

    test("measures a frame against the clamped scale factor when 3 was asked", async () => {
      const { overrides, frame, setCount, viewerSize } = await watchedAtScale({
        width: 390,
        height: 723,
        scale: 3,
      });
      // The tab got scale factor 2, so its device-pixel frames are twice the size set.
      await frame(780, 1446);
      await frame(781, 1447);
      expect(viewerSize()).toEqual([390, 723]);
      expect(overrides().slice(setCount)).toEqual([]);
      await frame(1170, 2169);
      expect(viewerSize()).toEqual([1170, 2169]);
      expect(overrides().slice(setCount)).toEqual([
        { width: 390, height: 723, deviceScaleFactor: 2, mobile: false },
      ]);
    });

    test("at scale factor 1 takes only the size set itself", async () => {
      const { overrides, frame, setCount, viewerSize } = await watchedAtScale({
        width: 844,
        height: 245,
        scale: 1,
      });
      await frame(844, 245);
      expect(overrides().slice(setCount)).toEqual([]);
      await frame(845, 246);
      expect(viewerSize()).toEqual([845, 246]);
      now += 1_000;
      await frame(1688, 490);
      expect(viewerSize()).toEqual([1688, 490]);
      expect(overrides().slice(setCount)).toEqual([
        { width: 844, height: 245, deviceScaleFactor: 1, mobile: false },
        { width: 844, height: 245, deviceScaleFactor: 1, mobile: false },
      ]);
    });

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const captures = () =>
      chromium.commands.filter((command) => command.method === "Page.captureScreenshot").length;
    /** The page follows each override, and a capture shows it at the size it has. */
    const trackedPage = (initial = { width: 0, height: 0 }) => {
      const page = { ...initial };
      chromium.handle("Emulation.setDeviceMetricsOverride", (params) => {
        page.width = Number(params.width);
        page.height = Number(params.height);
        return {};
      });
      chromium.handle("Page.captureScreenshot", () => ({
        data: jpegOfSize(page.width, page.height),
      }));
      return page;
    };
    const untilViewerShows = (viewerSize: () => [number, number] | null, size: string) =>
      until(() => viewerSize()?.join("x") === size, `a frame of ${size}`);
    const crashes = () => {
      throw new Error("Target crashed");
    };
    /** An agent command that outlasts its badge, answering after this long. */
    const slowAgentCommand = (ms: number, meanwhile?: () => void) => () => {
      now += AGENT_ACTIVITY_MS + 1_000;
      meanwhile?.();
      return sleep(ms).then(answersAtOnce);
    };
    const agentEvaluates = (browserId: string) =>
      broker.execute({
        command: { command: "evaluate", args: { browserId, function: "() => 1" } },
        workspaceId: "ws-a",
      });

    test("with no frame of the size set, captures one after the wait; the viewer gets it", async () => {
      await service.stop();
      build(logger, 50);
      trackedPage();
      const { viewerSize } = await watchedAt800();
      await untilViewerShows(viewerSize, "800x600");
      const taken = captures();
      await sleep(150);
      expect(captures()).toBe(taken);
    });

    test("a frame of the size set before the wait ends cancels the capture", async () => {
      await service.stop();
      build(logger, 150);
      trackedPage();
      const { tab, frame, viewerSize } = await watchedAt800();
      const before = captures();
      await frame(800, 600);
      await sleep(250);
      expect(captures()).toBe(before);
      // A size with no frame of its own is still captured.
      await service.setViewport(
        tab.browserId,
        { width: 390, height: 700, deviceScaleFactor: 1 },
        "viewer-2",
      );
      await untilViewerShows(viewerSize, "390x700");
      expect(captures()).toBe(before + 1);
    });

    test("stops after three captures that bring no frame, with one warn", async () => {
      let frameWarnings = 0;
      await service.stop();
      build(
        {
          ...logger,
          warn: (_details: unknown, message?: string) => {
            if (String(message).includes("no frame")) frameWarnings += 1;
          },
        },
        30,
      );
      chromium.handle("Page.captureScreenshot", crashes);
      await watchedAt800();
      // The viewer's priming screenshot has gone out; the captures counted start after it.
      const before = captures();
      const warned = () => frameWarnings > 0;
      await until(warned, "the warning");
      await sleep(150);
      expect(captures() - before).toBe(3);
      expect(frameWarnings).toBe(1);
    });

    test("nothing is captured once the last viewer left or the tab closed", async () => {
      await service.stop();
      build(logger, 50);
      trackedPage();
      const { tab, unwatch } = await watchedAt800();
      unwatch();
      const before = captures();
      await sleep(150);
      expect(captures()).toBe(before);
      // Watched again, a new size with no frame is captured; closing the tab stops the wait.
      const sizes: string[] = [];
      await service.screencast.watch(tab.browserId, {
        id: "v2",
        deliver: async (sent) => void sizes.push(`${sent.deviceWidth}x${sent.deviceHeight}`),
      });
      await service.setViewport(
        tab.browserId,
        { width: 390, height: 700, deviceScaleFactor: 1 },
        "viewer-2",
      );
      const captured = () => sizes.includes("390x700");
      await until(captured, "a captured frame");
      await service.setViewport(
        tab.browserId,
        { width: 640, height: 480, deviceScaleFactor: 1 },
        "viewer-2",
      );
      await service.closeTab(tab.browserId);
      const atClose = captures();
      await sleep(150);
      expect(captures()).toBe(atClose);
    });

    test("captures nothing while an agent command runs, and checks when it ends", async () => {
      await service.stop();
      build(logger, 60);
      trackedPage();
      const { tab, viewerSize } = await watchedAt800();
      const before = captures();
      chromium.handle("Runtime.evaluate", slowAgentCommand(250));
      await agentEvaluates(tab.browserId);
      expect(captures()).toBe(before);
      await untilViewerShows(viewerSize, "800x600");
      expect(captures()).toBe(before + 1);
    });

    test("a window size skipped during an agent command is re-applied when it ends", async () => {
      await service.stop();
      build(logger, 40);
      const page = trackedPage();
      const { tab, overrides, setCount, viewerSize } = await watchedAt800();
      const target = [...chromium.targets.keys()][0];
      // The window is resized while the agent works; the page paints once and then sits still.
      const windowResized = () => {
        page.width = 1368;
        page.height = 934;
        chromium.emit(target, "Page.screencastFrame", frameOfSize(1368, 934));
      };
      chromium.handle("Runtime.evaluate", slowAgentCommand(150, windowResized));
      await agentEvaluates(tab.browserId);
      expect(overrides().slice(setCount)).toEqual([]);
      await untilViewerShows(viewerSize, "800x600");
      expect(overrides().slice(setCount)).toEqual([SET]);
    });

    const answerLater = <T>(result: T) => sleep(200).then(() => result);
    /** A tracked page whose captures answer 200 ms after they are asked, showing the page as it was then. */
    const slowTrackedPage = (initial: { width: number; height: number }) => {
      const page = trackedPage(initial);
      chromium.handle("Page.captureScreenshot", () =>
        answerLater({ data: jpegOfSize(page.width, page.height) }),
      );
    };
    /** The watched tab after the captures gave up: the last frame was the window's size. */
    const exhaustedAt800 = async () => {
      const warnings = { frames: 0 };
      await service.stop();
      build(
        {
          ...logger,
          warn: (_details: unknown, message?: string) => {
            if (String(message).includes("no frame")) warnings.frames += 1;
          },
        },
        30,
      );
      chromium.handle("Page.captureScreenshot", crashes);
      const watched = await watchedAt800();
      // The window's size, while the size set still settles: no re-apply, and the last frame is wrong.
      await watched.frame(1368, 934);
      await until(() => warnings.frames > 0, "the capture limit");
      return { ...watched, warnings };
    };
    const claimAt800 = (browserId: string) =>
      service.setViewport(browserId, { width: 800, height: 600, deviceScaleFactor: 1 }, "viewer-1");

    test("after the checks gave up, a person's claim of the same size starts them again", async () => {
      const { tab, overrides, viewerSize, viewerSizes } = await exhaustedAt800();
      expect(viewerSizes()).toEqual(["1368x934"]);
      const before = overrides().length;
      trackedPage();
      await claimAt800(tab.browserId);
      await untilViewerShows(viewerSize, "800x600");
      expect(overrides().slice(before)).toEqual([SET]);
    });

    test("a claim of the same size while the last frame has that size does nothing", async () => {
      await service.stop();
      build(logger, 30);
      trackedPage({ width: 800, height: 600 });
      const { tab, overrides, frame } = await watchedAt800();
      await frame(800, 600);
      const before = overrides().length;
      const taken = captures();
      await claimAt800(tab.browserId);
      await sleep(100);
      expect(overrides().length).toBe(before);
      expect(captures()).toBe(taken);
    });

    test("claims of the same size restart the checks at most once a second", async () => {
      const { tab, overrides, warnings } = await exhaustedAt800();
      const before = overrides().length;
      for (let claim = 0; claim < 10; claim += 1) await claimAt800(tab.browserId);
      expect(overrides().slice(before)).toEqual([SET]);
      // The restarted checks give up again: the captures still fail.
      const gaveUpAgain = () => warnings.frames > 1;
      await until(gaveUpAgain, "the capture limit again");
      for (let claim = 0; claim < 10; claim += 1) await claimAt800(tab.browserId);
      expect(overrides().slice(before)).toEqual([SET]);
      now += 1_000;
      await claimAt800(tab.browserId);
      expect(overrides().slice(before)).toEqual([SET, SET]);
    });

    test("captures that time out stop after three with one warn, across the re-attaches", async () => {
      let frameWarnings = 0;
      await service.stop();
      build(
        {
          ...logger,
          warn: (_details: unknown, message?: string) => {
            if (String(message).includes("no frame")) frameWarnings += 1;
          },
        },
        30,
      );
      await watchedAt800();
      // Each capture times out, which closes the tab socket; the watched tab re-attaches.
      chromium.stall("Page.captureScreenshot");
      const before = captures();
      const warned = () => frameWarnings > 0;
      await until(warned, "the warning");
      await sleep(800);
      expect(captures() - before).toBe(3);
      expect(frameWarnings).toBe(1);
    });

    test("a capture still running is not joined by a second one", async () => {
      await service.stop();
      build(logger, 40);
      const { tab } = await watchedAt800();
      slowTrackedPage({ width: 800, height: 600 });
      const before = captures();
      const captureStarted = () => captures() > before;
      await until(captureStarted, "a capture");
      // A new size starts a new wait, which ends while the first capture still runs.
      await service.setViewport(
        tab.browserId,
        { width: 390, height: 700, deviceScaleFactor: 1 },
        "viewer-2",
      );
      await sleep(100);
      expect(captures()).toBe(before + 1);
    });

    test("a capture answered after a newer size was set is not shown", async () => {
      await service.stop();
      build(logger, 40);
      const { tab, viewerSize, viewerSizes } = await watchedAt800();
      slowTrackedPage({ width: 800, height: 600 });
      const before = captures();
      const captureStarted = () => captures() > before;
      await until(captureStarted, "a capture");
      await service.setViewport(
        tab.browserId,
        { width: 390, height: 700, deviceScaleFactor: 1 },
        "viewer-2",
      );
      await untilViewerShows(viewerSize, "390x700");
      expect(viewerSizes()).toEqual(["390x700"]);
    });

    test("a capture answered after an agent command started is not shown", async () => {
      await service.stop();
      build(logger, 40);
      const { tab, viewerSizes } = await watchedAt800();
      slowTrackedPage({ width: 800, height: 600 });
      const before = captures();
      const captureStarted = () => captures() > before;
      await until(captureStarted, "a capture");
      chromium.handle("Runtime.evaluate", answersAtOnce);
      await agentEvaluates(tab.browserId);
      await sleep(300);
      expect(viewerSizes()).toEqual([]);
    });

    test("ignores a frame that reports no size", async () => {
      const { overrides, frame, setCount } = await watchedAt800();
      now += 1_000;
      await frame(0, 0);
      expect(overrides().slice(setCount)).toEqual([]);
    });

    test("stops after three re-applies that did not take, with one warn", async () => {
      let viewportWarnings = 0;
      await service.stop();
      build({
        ...logger,
        warn: (_details: unknown, message?: string) => {
          if (String(message).includes("viewport")) viewportWarnings += 1;
        },
      });
      const { overrides, frame, setCount } = await watchedAt800();
      for (let attempt = 0; attempt < 6; attempt += 1) {
        now += 1_000;
        await frame(1368, 934);
      }
      expect(overrides().slice(setCount)).toEqual([SET, SET, SET]);
      expect(viewportWarnings).toBe(1);
      // A frame of the size set ends the run; the next mismatch is re-applied again.
      await frame(800, 600);
      now += 1_000;
      await frame(1368, 934);
      expect(overrides().slice(setCount)).toEqual([SET, SET, SET, SET]);
    });
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

  test("correctFrameSize takes a frame in device pixels as the size set, and nothing else", () => {
    const at = (width: number, height: number, deviceScaleFactor: number) => ({
      width,
      height,
      deviceScaleFactor,
    });
    const cases: Array<[ReturnType<typeof at> | undefined, number, number]> = [
      [at(844, 245, 2), 1688, 490],
      [at(844, 245, 2), 1687, 491],
      [at(844, 245, 2), 1686, 490],
      [at(844, 245, 2), 845, 246],
      [at(844, 245, 2), 844, 245],
      [at(391, 241, 1.5), 586, 362],
      [at(391, 241, 1.5), 588, 362],
      [at(844, 245, 1), 1688, 490],
      [at(844, 245, 1), 845, 245],
      [undefined, 1688, 490],
    ];
    expect(
      cases.map(([set, width, height]) => {
        const size = correctFrameSize(set, { width, height });
        return [size.width, size.height];
      }),
    ).toEqual([
      [844, 245],
      [844, 245],
      [1686, 490],
      [845, 246],
      [844, 245],
      [391, 241],
      [588, 362],
      [1688, 490],
      [845, 245],
      [1688, 490],
    ]);
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
