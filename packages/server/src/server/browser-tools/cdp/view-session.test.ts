import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { decodeBrowserViewFrame } from "@getpaseo/protocol/binary-frames/index";
import type { SessionInboundMessage, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { SessionDelivery } from "../../session/owned-subscriptions/index.js";
import { BrowserToolsBroker } from "../broker.js";
import { CdpBrowserService } from "./cdp-browser-service.js";
import { CdpEndpoint } from "./cdp-endpoint.js";
import { CdpTabRegistry } from "./tab-registry.js";
import { startFakeChromium, type FakeChromium } from "./test-utils/fake-chromium.js";
import { CdpViewSession } from "./view-session.js";

const logger = { debug: () => {}, warn: () => {}, error: () => {} };

async function until(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const FRAME = {
  data: Buffer.from([0xff, 0xd8, 9]).toString("base64"),
  sessionId: 1,
  metadata: {
    deviceWidth: 390,
    deviceHeight: 700,
    pageScaleFactor: 1,
    scrollOffsetX: 0,
    scrollOffsetY: 12,
  },
};

describe("CdpViewSession", () => {
  let chromium: FakeChromium;
  let dir: string;
  let service: CdpBrowserService;
  let session: CdpViewSession;
  let delivery: SessionDelivery;
  let socket: object;
  let json: SessionOutboundMessage[];
  let binary: Uint8Array[];

  const emit = (message: SessionOutboundMessage) => void json.push(message);
  /** Runs a handler inside a request context, as Session does for an inbound message. */
  const request = <T extends SessionInboundMessage>(
    message: T,
    run: (message: T) => Promise<void> | void,
  ) =>
    delivery.request(socket, message, async () => {
      await run(message);
    });
  const all = <T extends SessionOutboundMessage["type"]>(type: T) =>
    json.filter(
      (message): message is Extract<SessionOutboundMessage, { type: T }> => message.type === type,
    );
  const last = <T extends SessionOutboundMessage["type"]>(type: T) => all(type).at(-1);
  const sentTo = (targetId: string, method: string) =>
    chromium.commands
      .filter((command) => command.targetId === targetId && command.method === method)
      .map((command) => command.params);

  beforeEach(async () => {
    chromium = await startFakeChromium();
    dir = await mkdtemp(path.join(os.tmpdir(), "paseo-cdp-view-"));
    service = new CdpBrowserService({
      endpoint: new CdpEndpoint({ url: chromium.url, commandTimeoutMs: 300 }),
      registry: new CdpTabRegistry(path.join(dir, "cdp-tabs.json")),
      broker: new BrowserToolsBroker({}),
      logger,
      reconnect: { minMs: 20, maxMs: 40 },
    });
    service.start();
    await until(() => service.connected, "the CDP host");
    json = [];
    binary = [];
    socket = {};
    delivery = new SessionDelivery(
      (_source, message) => void json.push(message),
      (_source, frame) => void binary.push(frame),
    );
    delivery.attach(socket, true);
    session = new CdpViewSession(() => service, logger);
  });
  afterEach(async () => {
    await delivery.detach(socket);
    await service.stop();
    await chromium.close();
    await rm(dir, { recursive: true, force: true });
  });

  const openTab = async (workspaceId = "ws-a") => {
    await request(
      {
        type: "browser.cdp.tab.open.request",
        requestId: `open-${json.length}`,
        workspaceId,
        url: "https://example.com/",
      },
      (message) => session.openTab(message, emit),
    );
    const tab = last("browser.cdp.tab.open.response")?.payload.tab;
    if (!tab) throw new Error("open failed");
    return tab;
  };
  const viewRequest = (browserId: string) =>
    ({
      type: "browser.cdp.view.subscribe.request",
      requestId: "view-1",
      browserId,
      width: 390,
      height: 700,
      deviceScaleFactor: 3,
    }) as const;
  const subscribeView = async (browserId: string) => {
    await request(viewRequest(browserId), (message) =>
      session.subscribeView(message, delivery, emit),
    );
    return last("browser.cdp.view.subscribe.response")!.payload;
  };

  test("tab.open answers with the tab; tab.close closes it", async () => {
    const tab = await openTab();
    expect(tab).toMatchObject({ workspaceId: "ws-a", url: "https://example.com/" });
    await request(
      { type: "browser.cdp.tab.close.request", requestId: "close-1", browserId: tab.browserId },
      (message) => session.closeTab(message, emit),
    );
    expect(last("browser.cdp.tab.close.response")?.payload).toEqual({
      requestId: "close-1",
      error: null,
    });
    expect(service.listTabs()).toEqual([]);
    await request(
      { type: "browser.cdp.tab.close.request", requestId: "close-2", browserId: tab.browserId },
      (message) => session.closeTab(message, emit),
    );
    expect(last("browser.cdp.tab.close.response")?.payload.error).toBe("browser_tab_not_found");
  });

  test("tabs.subscribe answers with this workspace's tabs, then sends its events", async () => {
    const mine = await openTab("ws-a");
    await openTab("ws-b");
    await request(
      { type: "browser.cdp.tabs.subscribe.request", requestId: "tabs-1", workspaceId: "ws-a" },
      (message) => session.subscribeTabs(message, delivery, emit),
    );
    const snapshot = last("browser.cdp.tabs.subscribe.response")!.payload;
    expect(snapshot.connected).toBe(true);
    expect(snapshot.tabs.map((tab) => tab.browserId)).toEqual([mine.browserId]);

    json.length = 0;
    const other = await openTab("ws-b");
    const added = await openTab("ws-a");
    await service.closeTab(other.browserId);
    const events = json
      .filter((message) => message.type === "browser.cdp.tabs.update")
      .map((message) => (message.type === "browser.cdp.tabs.update" ? message.payload : null));
    expect(events.every((payload) => payload?.subscriptionId === snapshot.subscriptionId)).toBe(
      true,
    );
    expect(
      events
        .filter((payload) => payload?.event.kind === "opened")
        .map((payload) => payload?.event.kind === "opened" && payload.event.tab.browserId),
    ).toEqual([added.browserId]);
    expect(events.some((payload) => payload?.event.kind === "closed")).toBe(false);
  });

  test("view.subscribe claims the viewport, answers, then streams frames to the subscription", async () => {
    const tab = await openTab();
    const targetId = [...chromium.targets.keys()][0];
    const response = await subscribeView(tab.browserId);
    expect(response.error).toBeNull();
    expect(sentTo(targetId, "Emulation.setDeviceMetricsOverride").at(-1)).toEqual({
      width: 390,
      height: 700,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await until(() => sentTo(targetId, "Page.startScreencast").length === 1, "the screencast");
    chromium.emit(targetId, "Page.screencastFrame", FRAME);
    await until(() => binary.length > 0, "a frame");
    const frame = decodeBrowserViewFrame(binary[0]);
    expect(frame).toMatchObject({
      subscriptionId: response.subscriptionId,
      deviceWidth: 390,
      deviceHeight: 700,
      scrollY: 12,
    });
    expect([...frame!.jpeg]).toEqual([0xff, 0xd8, 9]);
    // The response left before any frame, so the client can route the first one.
    expect(json.at(-1)?.type).toBe("browser.cdp.view.subscribe.response");
  });

  test("view.subscribe on an unknown tab answers browser_tab_not_found", async () => {
    const response = await subscribeView("99999999-9999-4999-8999-999999999999");
    expect(response).toEqual({
      requestId: "view-1",
      subscriptionId: "",
      error: "browser_tab_not_found",
    });
  });

  test("input reaches the page and claims the viewport for the sender", async () => {
    const tab = await openTab();
    const targetId = [...chromium.targets.keys()][0];
    const { subscriptionId } = await subscribeView(tab.browserId);
    session.input({
      type: "browser.cdp.view.input.request",
      subscriptionId,
      input: {
        kind: "mouse",
        type: "down",
        x: 5,
        y: 6,
        button: "left",
        buttons: 1,
        clickCount: 1,
        modifiers: 0,
      },
      viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
    });
    await until(() => sentTo(targetId, "Input.dispatchMouseEvent").length === 1, "the mouse event");
    expect(sentTo(targetId, "Input.dispatchMouseEvent")[0]).toMatchObject({
      type: "mousePressed",
      x: 5,
      y: 6,
    });
    expect(sentTo(targetId, "Emulation.setDeviceMetricsOverride").at(-1)).toMatchObject({
      width: 1200,
      height: 800,
    });
  });

  test("input for a subscription this session does not own is ignored", async () => {
    await openTab();
    const targetId = [...chromium.targets.keys()][0];
    session.input({
      type: "browser.cdp.view.input.request",
      subscriptionId: "someone-else",
      input: { kind: "text", text: "x" },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentTo(targetId, "Input.insertText")).toEqual([]);
  });

  test("an input that times out tells the view the page is not responding", async () => {
    const tab = await openTab();
    const { subscriptionId } = await subscribeView(tab.browserId);
    chromium.stall("Input.insertText");
    session.input({
      type: "browser.cdp.view.input.request",
      subscriptionId,
      input: { kind: "text", text: "x" },
    });
    await until(() => last("browser.cdp.view.update") !== undefined, "the view update");
    expect(last("browser.cdp.view.update")?.payload).toEqual({
      subscriptionId,
      error: "browser_timeout",
    });
  });

  test("a closed tab tells its view", async () => {
    const tab = await openTab();
    const { subscriptionId } = await subscribeView(tab.browserId);
    await service.closeTab(tab.browserId);
    expect(last("browser.cdp.view.update")?.payload).toEqual({
      subscriptionId,
      error: "browser_tab_not_found",
    });
  });

  test("a closed tab ends its view subscription", async () => {
    const tab = await openTab();
    const targetId = [...chromium.targets.keys()][0];
    const { subscriptionId } = await subscribeView(tab.browserId);
    await until(() => service.screencast.viewerCount(tab.browserId) === 1, "the viewer");
    expect(delivery.subscriptionIds(socket, "cdp-view")).toHaveLength(1);
    await service.closeTab(tab.browserId);
    expect(delivery.subscriptionIds(socket, "cdp-view")).toEqual([]);
    json.length = 0;
    // The view is gone, so its input goes nowhere and nothing more is said about it.
    session.input({
      type: "browser.cdp.view.input.request",
      subscriptionId,
      input: { kind: "text", text: "x" },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(json).toEqual([]);
    expect(sentTo(targetId, "Input.insertText")).toEqual([]);
  });

  test("a tab that closes while its first watch is starting ends the view once", async () => {
    const tab = await openTab();
    const targetId = [...chromium.targets.keys()][0];
    chromium.stall("Page.startScreencast");
    const subscribing = request(viewRequest(tab.browserId), (message) =>
      session.subscribeView(message, delivery, emit),
    );
    await until(() => sentTo(targetId, "Page.startScreencast").length === 1, "the start");
    const { subscriptionId } = last("browser.cdp.view.subscribe.response")!.payload;
    await service.closeTab(tab.browserId);
    await subscribing;
    expect(all("browser.cdp.view.update").map((message) => message.payload)).toEqual([
      { subscriptionId, error: "browser_tab_not_found" },
    ]);
    expect(delivery.subscriptionIds(socket, "cdp-view")).toEqual([]);
    expect(service.screencast.viewerCount(tab.browserId)).toBe(0);
  });

  test("after a Chromium reconnect the view streams again from the new tab socket", async () => {
    const tab = await openTab();
    const targetId = [...chromium.targets.keys()][0];
    const { subscriptionId } = await subscribeView(tab.browserId);
    await until(() => sentTo(targetId, "Page.startScreencast").length === 1, "the screencast");
    chromium.disconnect("browser");
    await until(() => !service.connected, "the disconnect");
    expect(last("browser.cdp.view.update")?.payload).toEqual({
      subscriptionId,
      error: "browser_no_host",
    });
    await until(() => service.connected, "the reconnect");
    await until(
      () => sentTo(targetId, "Page.startScreencast").length === 2,
      "the screencast on the new socket",
    );
    chromium.emit(targetId, "Page.screencastFrame", FRAME);
    await until(() => binary.length > 0, "a frame after the reconnect");
    expect(decodeBrowserViewFrame(binary[0])?.subscriptionId).toBe(subscriptionId);
    expect(service.screencast.viewerCount(tab.browserId)).toBe(1);
  });

  test("navigate sends the URL, refuses other schemes, and maps back, forward and reload", async () => {
    const tab = await openTab();
    const targetId = [...chromium.targets.keys()][0];
    const navigate = (
      requestId: string,
      action: Extract<
        SessionInboundMessage,
        { type: "browser.cdp.view.navigate.request" }
      >["action"],
    ) =>
      request(
        { type: "browser.cdp.view.navigate.request", requestId, browserId: tab.browserId, action },
        (message) => session.navigate(message, emit),
      );
    await navigate("n1", { kind: "url", url: "https://example.org/" });
    expect(last("browser.cdp.view.navigate.response")?.payload).toEqual({
      requestId: "n1",
      error: null,
    });
    expect(sentTo(targetId, "Page.navigate")).toEqual([{ url: "https://example.org/" }]);
    await navigate("n2", { kind: "url", url: "javascript:alert(1)" });
    expect(last("browser.cdp.view.navigate.response")?.payload.error).toBe("browser_unknown_error");
    expect(sentTo(targetId, "Page.navigate")).toHaveLength(1);
    await navigate("n3", { kind: "reload" });
    await until(() => sentTo(targetId, "Page.reload").length === 1, "the reload");
  });

  test("releasing the view stops the screencast", async () => {
    const tab = await openTab();
    const targetId = [...chromium.targets.keys()][0];
    const { subscriptionId } = await subscribeView(tab.browserId);
    await until(() => service.screencast.viewerCount(tab.browserId) === 1, "the viewer");
    // release() finds the subscription through the current request's source.
    await request(
      { type: "subscription.release.request", requestId: "release-1", subscriptionId },
      () => delivery.release(subscriptionId),
    );
    expect(service.screencast.viewerCount(tab.browserId)).toBe(0);
    await until(() => sentTo(targetId, "Page.stopScreencast").length === 1, "the stop");
  });

  test("with no service every request answers browser_unsupported", async () => {
    const off = new CdpViewSession(() => null, logger);
    await request(
      { type: "browser.cdp.tab.open.request", requestId: "o", workspaceId: "ws-a" },
      (message) => off.openTab(message, emit),
    );
    expect(last("browser.cdp.tab.open.response")?.payload).toEqual({
      requestId: "o",
      tab: null,
      error: "browser_unsupported",
    });
    await request(
      { type: "browser.cdp.tab.close.request", requestId: "c", browserId: "b" },
      (message) => off.closeTab(message, emit),
    );
    await request({ type: "browser.cdp.tabs.subscribe.request", requestId: "t" }, (message) =>
      off.subscribeTabs(message, delivery, emit),
    );
    await request(viewRequest("b"), (message) => off.subscribeView(message, delivery, emit));
    await request(
      {
        type: "browser.cdp.view.navigate.request",
        requestId: "n",
        browserId: "b",
        action: { kind: "reload" },
      },
      (message) => off.navigate(message, emit),
    );
    off.input({
      type: "browser.cdp.view.input.request",
      subscriptionId: "s",
      input: { kind: "text", text: "x" },
    });
    expect([
      last("browser.cdp.tab.close.response")?.payload.error,
      last("browser.cdp.tabs.subscribe.response")?.payload.error,
      last("browser.cdp.view.subscribe.response")?.payload.error,
      last("browser.cdp.view.navigate.response")?.payload.error,
    ]).toEqual([
      "browser_unsupported",
      "browser_unsupported",
      "browser_unsupported",
      "browser_unsupported",
    ]);
    expect(delivery.subscriptionIds(socket, "cdp-tabs")).toEqual([]);
  });
});
