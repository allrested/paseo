import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CdpConnection } from "./cdp-connection.js";
import { CdpTab } from "./cdp-tab.js";
import { startFakeChromium, type FakeChromium } from "./test-utils/fake-chromium.js";

// A 1x1 PNG.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("CdpTab", () => {
  let chromium: FakeChromium;
  let targetId: string;
  let tab: CdpTab;
  let stateChanges: number;
  const sent = (method: string) =>
    chromium.commands
      .filter((command) => command.method === method)
      .map((command) => command.params);
  // A round trip proves the fake's earlier events were delivered.
  const settle = () => tab.connection.send("Page.enable");

  beforeEach(async () => {
    chromium = await startFakeChromium();
    targetId = chromium.addTarget({ url: "https://example.com/", title: "Example" }).id;
    stateChanges = 0;
    const connection = await CdpConnection.open({
      url: `ws://127.0.0.1:${chromium.port}/devtools/page/${targetId}`,
    });
    tab = await CdpTab.attach({
      id: 7,
      connection,
      initialUrl: "https://example.com/",
      loadTimeoutMs: 200,
      onState: () => {
        stateChanges += 1;
      },
    });
  });
  afterEach(async () => {
    tab.dispose();
    await chromium.close();
  });

  test("reads its first state from the navigation history", () => {
    expect(tab.id).toBe(7);
    expect(tab.getURL()).toBe("https://example.com/");
    expect(tab.getTitle()).toBe("Example");
    expect(tab.canGoBack()).toBe(false);
    expect(tab.canGoForward()).toBe(false);
    expect(tab.isLoading()).toBe(false);
    expect(sent("Page.enable").length).toBe(1);
    expect(sent("Runtime.enable").length).toBe(1);
  });

  test("executeJavaScript returns the value and throws the page's exception", async () => {
    chromium.handle("Runtime.evaluate", (params) =>
      params.expression === "boom()"
        ? {
            result: { type: "object" },
            exceptionDetails: {
              text: "Uncaught",
              exception: { description: "ReferenceError: boom is not defined" },
            },
          }
        : { result: { type: "number", value: 3 } },
    );
    await expect(tab.executeJavaScript("1+2")).resolves.toBe(3);
    expect(sent("Runtime.evaluate")[0]).toEqual({
      expression: "1+2",
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    await expect(tab.executeJavaScript("boom()")).rejects.toThrow(
      "ReferenceError: boom is not defined",
    );
  });

  test("loadURL waits for the load event and tracks loading and history", async () => {
    chromium.handle("Page.navigate", () => ({ frameId: "F" }));
    chromium.handle("Page.getNavigationHistory", () => ({
      currentIndex: 1,
      entries: [
        { id: 1, url: "https://example.com/", title: "Example" },
        { id: 2, url: "https://example.com/next", title: "Next" },
      ],
    }));
    let loaded = false;
    const loading = tab.loadURL("https://example.com/next").then(() => {
      loaded = true;
      return undefined;
    });
    chromium.emit(targetId, "Page.frameStartedLoading", { frameId: "F" });
    await settle();
    expect(loaded).toBe(false);
    expect(tab.isLoading()).toBe(true);
    chromium.emit(targetId, "Page.frameNavigated", {
      frame: { id: "F", url: "https://example.com/next" },
    });
    chromium.emit(targetId, "Page.loadEventFired", { timestamp: 1 });
    await loading;
    await settle();
    await settle();
    expect(tab.isLoading()).toBe(false);
    expect(tab.getURL()).toBe("https://example.com/next");
    expect(tab.getTitle()).toBe("Next");
    expect(tab.canGoBack()).toBe(true);
    expect(stateChanges).toBeGreaterThan(0);
  });

  test("loadURL rejects on a navigation error and resolves when no load event comes", async () => {
    chromium.handle("Page.navigate", (params) =>
      params.url === "https://bad.invalid/"
        ? { errorText: "net::ERR_NAME_NOT_RESOLVED" }
        : { frameId: "F" },
    );
    await expect(tab.loadURL("https://bad.invalid/")).rejects.toThrow("net::ERR_NAME_NOT_RESOLVED");
    await expect(tab.loadURL("https://example.com/slow")).resolves.toBeUndefined();
  });

  test("goBack navigates to the previous history entry", async () => {
    chromium.handle("Page.getNavigationHistory", () => ({
      currentIndex: 1,
      entries: [
        { id: 11, url: "https://example.com/", title: "Example" },
        { id: 12, url: "https://example.com/next", title: "Next" },
      ],
    }));
    tab.goBack();
    await settle();
    await settle();
    expect(sent("Page.navigateToHistoryEntry")).toEqual([{ entryId: 11 }]);
  });

  test("captureFrame returns a PNG with its size", async () => {
    chromium.handle("Page.captureScreenshot", () => ({ data: PNG_1X1 }));
    const image = await tab.captureFrame(new AbortController().signal);
    expect(image.getSize()).toEqual({ width: 1, height: 1 });
    expect(Buffer.from(image.toPNG()).toString("base64")).toBe(PNG_1X1);
    expect(sent("Page.captureScreenshot")).toEqual([{ format: "png" }]);
  });

  test("key events and text go out in order", async () => {
    tab.sendInputEvent({ type: "keyDown", keyCode: "a", skipIfUnhandled: true });
    tab.sendInputEvent({ type: "char", keyCode: "a", skipIfUnhandled: true });
    tab.sendInputEvent({ type: "keyUp", keyCode: "a", skipIfUnhandled: true });
    await tab.insertText("hello");
    expect(sent("Input.dispatchKeyEvent").map((params) => params.type)).toEqual([
      "rawKeyDown",
      "char",
      "keyUp",
    ]);
    expect(sent("Input.insertText")).toEqual([{ text: "hello" }]);
  });

  test("buffers console messages", async () => {
    chromium.emit(targetId, "Runtime.consoleAPICalled", {
      type: "error",
      timestamp: 1700000000000,
      args: [
        { type: "string", value: "failed" },
        { type: "object", description: "Error: x" },
      ],
    });
    await settle();
    expect(tab.getConsoleMessages()).toEqual([
      { level: "error", message: "failed Error: x", timestamp: 1700000000000 },
    ]);
  });

  test("answers every dialog and records those opened during a capture", async () => {
    chromium.emit(targetId, "Page.javascriptDialogOpening", { type: "alert", message: "outside" });
    await settle();
    const { result, dialogs } = await tab.captureDialogs(async () => {
      chromium.emit(targetId, "Page.javascriptDialogOpening", {
        type: "confirm",
        message: "Sure?",
      });
      await settle();
      return "done";
    });
    expect(result).toBe("done");
    expect(dialogs.map((dialog) => [dialog.type, dialog.message])).toEqual([["confirm", "Sure?"]]);
    // The second answer goes out after the in-task round trip; one more proves the fake read it.
    await settle();
    expect(sent("Page.handleJavaScriptDialog").length).toBe(2);
  });

  test("is destroyed once the target closes", async () => {
    expect(tab.isDestroyed()).toBe(false);
    const closed = new Promise<void>((resolve) => tab.connection.onClose(resolve));
    chromium.destroyTarget(targetId);
    await closed;
    expect(tab.isDestroyed()).toBe(true);
  });
});
