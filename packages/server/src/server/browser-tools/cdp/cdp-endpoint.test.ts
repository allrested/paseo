import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CdpEndpoint, CdpUnreachableError } from "./cdp-endpoint.js";
import { startFakeChromium, type FakeChromium } from "./test-utils/fake-chromium.js";

describe("CdpEndpoint", () => {
  let chromium: FakeChromium;
  beforeEach(async () => {
    chromium = await startFakeChromium();
  });
  afterEach(async () => {
    await chromium.close();
  });

  test("resolves the host name on every call and sends an IP Host header", async () => {
    const lookups: string[] = [];
    const endpoint = new CdpEndpoint({
      url: `http://mdaq-browser:${chromium.port}`,
      lookup: async (hostname) => {
        lookups.push(hostname);
        return "127.0.0.1";
      },
    });
    chromium.addTarget({ id: "T1", url: "https://example.com/", title: "Example" });
    await endpoint.listTargets();
    await endpoint.listTargets();
    expect(lookups).toEqual(["mdaq-browser", "mdaq-browser"]);
    expect(chromium.hostHeaders).toEqual([
      `127.0.0.1:${chromium.port}`,
      `127.0.0.1:${chromium.port}`,
    ]);
  });

  test("lists page targets only", async () => {
    chromium.addTarget({ id: "T1", url: "https://example.com/", title: "Example" });
    chromium.addTarget({ id: "W1", type: "service_worker", url: "https://example.com/sw.js" });
    chromium.addTarget({ id: "T2", url: "about:blank", openerId: "T1" });
    const endpoint = new CdpEndpoint({ url: chromium.url });
    await expect(endpoint.listTargets()).resolves.toEqual([
      { id: "T1", type: "page", url: "https://example.com/", title: "Example" },
      { id: "T2", type: "page", url: "about:blank", title: "", openerId: "T1" },
    ]);
  });

  test("connects to a target and to the browser through its own origin", async () => {
    const target = chromium.addTarget();
    const endpoint = new CdpEndpoint({ url: chromium.url });
    const page = await endpoint.connectTarget(target.id);
    const browser = await endpoint.connectBrowser();
    await page.send("Page.enable");
    await browser.send("Target.setDiscoverTargets", { discover: true });
    expect(chromium.commands.map((command) => command.targetId)).toEqual([target.id, "browser"]);
    page.close();
    browser.close();
  });

  test("an unreachable endpoint fails with CdpUnreachableError", async () => {
    const endpoint = new CdpEndpoint({ url: "http://127.0.0.1:1", fetchTimeoutMs: 500 });
    await expect(endpoint.listTargets()).rejects.toBeInstanceOf(CdpUnreachableError);
    await expect(endpoint.connectBrowser()).rejects.toBeInstanceOf(CdpUnreachableError);
  });

  test("a failed lookup fails with CdpUnreachableError", async () => {
    const endpoint = new CdpEndpoint({
      url: "http://gone:9223",
      lookup: async () => {
        throw new Error("ENOTFOUND gone");
      },
    });
    await expect(endpoint.listTargets()).rejects.toBeInstanceOf(CdpUnreachableError);
  });
});
