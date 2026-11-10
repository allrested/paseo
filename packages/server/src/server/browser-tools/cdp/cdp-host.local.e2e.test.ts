// Hand-run only: set PASEO_TEST_CDP_URL to a Chromium's CDP address. The Chromium may be someone's
// logged-in browser, so this file opens its own tabs on about:blank or data: URLs, never visits a
// site, and closes only the tabs it opened.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BrowserToolsBroker } from "../broker.js";
import { CdpBrowserService } from "./cdp-browser-service.js";
import { CdpEndpoint } from "./cdp-endpoint.js";
import type { ScreencastFrame } from "./screencast-hub.js";
import { CdpTabRegistry } from "./tab-registry.js";

const CDP_URL = process.env.PASEO_TEST_CDP_URL;
const WORKSPACE = "e2e-workspace";
const logger = { debug: () => {}, warn: console.warn, error: console.error };

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.skipIf(!CDP_URL)("CDP host against a real Chromium", () => {
  let dir: string;
  let endpoint: CdpEndpoint;
  let broker: BrowserToolsBroker;
  let service: CdpBrowserService;
  let foreignBefore: string[];
  let browserId: string;

  const run = async (command: Record<string, unknown>) => {
    const payload = await broker.execute({
      command: command as never,
      workspaceId: WORKSPACE,
      timeoutMs: 30_000,
    });
    if (!payload.ok)
      throw new Error(`${String(command.command)} failed: ${JSON.stringify(payload.error)}`);
    return payload.result as Record<string, unknown>;
  };

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "paseo-cdp-e2e-"));
    endpoint = new CdpEndpoint({ url: CDP_URL! });
    foreignBefore = (await endpoint.listTargets()).map((target) => target.id).sort();
    broker = new BrowserToolsBroker({});
    service = new CdpBrowserService({
      endpoint,
      registry: new CdpTabRegistry(path.join(dir, "cdp-tabs.json")),
      broker,
      logger,
    });
    service.start();
    const deadline = Date.now() + 10_000;
    while (!service.connected) {
      if (Date.now() > deadline) throw new Error(`CDP at ${CDP_URL} did not answer`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });

  afterAll(async () => {
    // Close only what this run registered, even after a failed test.
    for (const tab of service?.listTabs() ?? []) await service.closeTab(tab.browserId);
    await service?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("opens its own tab and leaves every other target alone", async () => {
    const result = await run({ command: "new_tab", args: {} });
    browserId = String(result.browserId);
    expect(result.url).toBe("about:blank");
    const tabs = await run({ command: "list_tabs" });
    expect((tabs.tabs as Array<{ browserId: string }>).map((tab) => tab.browserId)).toEqual([
      browserId,
    ]);
  });

  test("the tab is visible and paints, which a background tab does not", async () => {
    const tab = await service.attachedTab(browserId);
    expect(await tab!.executeJavaScript("document.visibilityState")).toBe("visible");
    expect(
      await tab!.executeJavaScript(
        "new Promise((resolve) => requestAnimationFrame(() => resolve('painted')))",
      ),
    ).toBe("painted");
  });

  // The broker's navigate command takes only http and https, and this browser must not visit a
  // site, so navigate runs one level down on the tab's loadURL with a data: URL.
  test("navigate waits for the real load event and tracks the URL", async () => {
    const tab = await service.attachedTab(browserId);
    const url = "data:text/html,<title>navigated</title><p>here</p>";
    const started = Date.now();
    await tab!.loadURL(url);
    // Well under the 8 s load wait: the real load event resolved it, not the timeout.
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(tab!.getURL()).toBe(url);
    expect(await tab!.executeJavaScript("document.title")).toBe("navigated");
    await tab!.loadURL(`${url}#x`);
    expect(tab!.getURL()).toBe(`${url}#x`);
    expect(service.listTabs().map((state) => state.url)).toEqual([`${url}#x`]);
  });

  test("snapshot, click by ref and evaluate work on a page built in place", async () => {
    const tab = await service.attachedTab(browserId);
    await tab!.executeJavaScript(
      `document.body.innerHTML = '<button id="go" onclick="document.title = \\'clicked\\'">Go</button>'; true`,
    );
    const snapshot = await run({ command: "snapshot", args: { browserId } });
    const text = JSON.stringify(snapshot);
    const ref = /\[ref=([^\]]+)\]/.exec(text)?.[1] ?? /"ref":"([^"]+)"/.exec(text)?.[1];
    expect(ref, `no ref in snapshot: ${text.slice(0, 400)}`).toBeTruthy();
    await run({ command: "click", args: { browserId, ref } });
    const evaluated = await run({
      command: "evaluate",
      args: { browserId, function: "() => document.title" },
    });
    expect(String(evaluated.resultJson)).toContain("clicked");
  });

  test("screenshot returns a PNG", async () => {
    const shot = await run({ command: "screenshot", args: { browserId } });
    expect(shot.mimeType).toBe("image/png");
    expect(Buffer.from(String(shot.dataBase64), "base64").subarray(1, 4).toString()).toBe("PNG");
  });

  // The first frame may be the priming screenshot, so the check waits for one after a DOM change:
  // the hub primes only once, so that one is a screencast frame.
  test("a screencast frame arrives after a DOM change", async () => {
    const frames: ScreencastFrame[] = [];
    const stop = await service.screencast.watch(browserId, {
      id: "e2e-viewer",
      deliver: async (frame) => void frames.push(frame),
    });
    try {
      await waitFor(() => frames.length > 0, "the first frame");
      const before = frames.at(-1)!.sequence;
      const tab = await service.attachedTab(browserId);
      await tab!.executeJavaScript(
        `document.body.innerHTML = '<h1 style="background:#c00">frame ' + Date.now() + '</h1>'; true`,
      );
      await waitFor(() => frames.at(-1)!.sequence > before, "a screencast frame");
      const frame = frames.at(-1)!;
      expect([...frame.jpeg.subarray(0, 2)]).toEqual([0xff, 0xd8]);
      expect(frame.deviceWidth).toBeGreaterThan(0);
      expect(frame.deviceHeight).toBeGreaterThan(0);
    } finally {
      stop();
    }
    expect(service.screencast.viewerCount(browserId)).toBe(0);
  });

  test("close_tab removes the tab and the other targets are unchanged", async () => {
    await run({ command: "close_tab", args: { browserId } });
    expect(service.listTabs()).toEqual([]);
    const after = (await endpoint.listTargets()).map((target) => target.id).sort();
    expect(after).toEqual(foreignBefore);
  });
});
