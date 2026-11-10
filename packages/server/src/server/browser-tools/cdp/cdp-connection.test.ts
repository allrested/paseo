import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  CdpClosedError,
  CdpCommandError,
  CdpConnection,
  CdpTimeoutError,
} from "./cdp-connection.js";
import { startFakeChromium, type FakeChromium } from "./test-utils/fake-chromium.js";

describe("CdpConnection", () => {
  let chromium: FakeChromium;
  let targetId: string;
  const open = (commandTimeoutMs?: number) =>
    CdpConnection.open({
      url: `ws://127.0.0.1:${chromium.port}/devtools/page/${targetId}`,
      commandTimeoutMs,
    });

  beforeEach(async () => {
    chromium = await startFakeChromium();
    targetId = chromium.addTarget().id;
  });
  afterEach(async () => {
    await chromium.close();
  });

  test("answers a command with its result", async () => {
    chromium.handle("Runtime.evaluate", () => ({ result: { type: "number", value: 2 } }));
    const connection = await open();
    await expect(connection.send("Runtime.evaluate", { expression: "1+1" })).resolves.toEqual({
      result: { type: "number", value: 2 },
    });
    expect(chromium.commands).toEqual([
      { targetId, method: "Runtime.evaluate", params: { expression: "1+1" } },
    ]);
    connection.close();
  });

  test("rejects with the CDP error", async () => {
    chromium.handle("Page.navigate", () => {
      throw new Error("Cannot navigate to invalid URL");
    });
    const connection = await open();
    const failure = await connection.send("Page.navigate", { url: "x" }).catch((error) => error);
    expect(failure).toBeInstanceOf(CdpCommandError);
    expect((failure as CdpCommandError).method).toBe("Page.navigate");
    expect((failure as CdpCommandError).message).toBe("Cannot navigate to invalid URL");
    connection.close();
  });

  test("delivers events to listeners until they unsubscribe", async () => {
    const connection = await open();
    const seen: unknown[] = [];
    const off = connection.on("Page.loadEventFired", (params) => seen.push(params));
    await connection.send("Page.enable");
    chromium.emit(targetId, "Page.loadEventFired", { timestamp: 1 });
    await connection.send("Page.enable");
    off();
    chromium.emit(targetId, "Page.loadEventFired", { timestamp: 2 });
    await connection.send("Page.enable");
    expect(seen).toEqual([{ timestamp: 1 }]);
    connection.close();
  });

  test("a timed-out command closes the socket and fails the others", async () => {
    chromium.stall("Page.captureScreenshot");
    const connection = await open(50);
    const closed = new Promise<void>((resolve) => connection.onClose(resolve));
    await expect(connection.send("Page.captureScreenshot")).rejects.toBeInstanceOf(CdpTimeoutError);
    await closed;
    expect(connection.closed).toBe(true);
    await expect(connection.send("Page.enable")).rejects.toBeInstanceOf(CdpClosedError);
  });

  test("a listener that throws is reported and does not break the socket", async () => {
    const errors: unknown[] = [];
    const connection = await CdpConnection.open({
      url: `ws://127.0.0.1:${chromium.port}/devtools/page/${targetId}`,
      onError: (error) => errors.push(error),
    });
    connection.on("Page.loadEventFired", () => {
      throw new Error("listener failed");
    });
    chromium.emit(targetId, "Page.loadEventFired", {});
    await expect(connection.send("Page.enable")).resolves.toEqual({});
    expect(errors).toHaveLength(1);
    connection.close();
  });

  test("rejects open when nothing listens", async () => {
    await expect(
      CdpConnection.open({ url: "ws://127.0.0.1:1/devtools/page/x", connectTimeoutMs: 500 }),
    ).rejects.toBeInstanceOf(CdpClosedError);
  });
});
