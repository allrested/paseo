import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CdpEndpoint, CdpUnreachableError } from "./cdp-endpoint.js";
import { CdpOffscreenPages } from "./offscreen-pages.js";
import { startFakeChromium, type FakeChromium } from "./test-utils/fake-chromium.js";

const logger = { debug: () => {}, warn: () => {} };
const VIEWPORT = { width: 390, height: 700, deviceScaleFactor: 1.8 };

async function until(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("CdpOffscreenPages", () => {
  let chromium: FakeChromium;
  let pages: CdpOffscreenPages;
  let reachable: boolean;

  const commandsOf = (method: string) =>
    chromium.commands.filter((command) => command.method === method);

  beforeEach(async () => {
    chromium = await startFakeChromium();
    reachable = true;
    pages = new CdpOffscreenPages({
      endpoint: new CdpEndpoint({
        url: `http://chromium-host:${chromium.port}`,
        fetchTimeoutMs: 500,
        commandTimeoutMs: 300,
        lookup: async () => {
          if (!reachable) throw new Error("ENOTFOUND chromium-host");
          return "127.0.0.1";
        },
      }),
      logger,
    });
  });

  afterEach(async () => {
    await pages.stop();
    await chromium.close();
  });

  test("open creates a window target on about:blank and sets its viewport", async () => {
    const page = await pages.open(VIEWPORT);

    expect(commandsOf("Target.createTarget")[0]?.params).toEqual({
      url: "about:blank",
      newWindow: true,
      background: true,
    });
    expect(commandsOf("Emulation.setDeviceMetricsOverride")[0]?.params).toEqual({
      width: 390,
      height: 700,
      deviceScaleFactor: 1.8,
      mobile: false,
    });
    await page.close();
  });

  test("evaluate returns the page's value and rejects with its exception text", async () => {
    const page = await pages.open(VIEWPORT);
    chromium.handle("Runtime.evaluate", () => ({ result: { type: "number", value: 42 } }));
    expect(await page.evaluate("6 * 7")).toBe(42);
    expect(commandsOf("Runtime.evaluate").at(-1)?.params).toEqual({
      expression: "6 * 7",
      returnByValue: true,
      awaitPromise: true,
    });

    chromium.handle("Runtime.evaluate", () => ({
      result: { type: "object" },
      exceptionDetails: { text: "Uncaught", exception: { description: "Error: boom" } },
    }));
    await expect(page.evaluate("x")).rejects.toThrow("boom");
  });

  test("send passes a raw command to the page", async () => {
    const page = await pages.open(VIEWPORT);
    const params = { type: "mousePressed", x: 10, y: 20, button: "left", clickCount: 1 };

    await page.send("Input.dispatchMouseEvent", params);

    expect(commandsOf("Input.dispatchMouseEvent")[0]?.params).toEqual(params);
  });

  test("setViewport changes the page's size", async () => {
    const page = await pages.open(VIEWPORT);

    await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });

    expect(commandsOf("Emulation.setDeviceMetricsOverride").at(-1)?.params).toEqual({
      width: 800,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
  });

  test("close closes the target once, and a second close does nothing", async () => {
    const page = await pages.open(VIEWPORT);
    let closed = 0;
    page.onClosed(() => closed++);

    await page.close();
    await page.close();

    expect(commandsOf("Target.closeTarget")).toHaveLength(1);
    expect(chromium.targets.size).toBe(0);
    expect(closed).toBe(1);
  });

  test("onClosed runs when the target goes away on its own", async () => {
    const page = await pages.open(VIEWPORT);
    let closed = 0;
    page.onClosed(() => closed++);

    chromium.destroyTarget([...chromium.targets.keys()][0]!);

    await until(() => closed === 1, "the closed listener");
    await expect(page.evaluate("1")).rejects.toThrow();
    // Nothing is left to close.
    await page.close();
    expect(commandsOf("Target.closeTarget")).toHaveLength(0);
  });

  test("stop closes every open page", async () => {
    await pages.open(VIEWPORT);
    await pages.open(VIEWPORT);

    await pages.stop();

    expect(commandsOf("Target.closeTarget")).toHaveLength(2);
    expect(chromium.targets.size).toBe(0);
  });

  test("open rejects with CdpUnreachableError when the Chromium is unreachable", async () => {
    reachable = false;

    await expect(pages.open(VIEWPORT)).rejects.toBeInstanceOf(CdpUnreachableError);
  });

  test("a page whose viewport cannot be set is closed again", async () => {
    chromium.handle("Emulation.setDeviceMetricsOverride", () => {
      throw new Error("no such override");
    });

    await expect(pages.open(VIEWPORT)).rejects.toThrow("no such override");

    expect(chromium.targets.size).toBe(0);
  });
});
