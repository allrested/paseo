import type {
  BrowserAutomationConsoleLogEntry,
  BrowserAutomationDialogEvent,
} from "@getpaseo/protocol/browser-automation/rpc-schemas";
import {
  dialogAcceptValue,
  handledDialogEvent,
  MAX_DIALOGS_PER_COMMAND,
} from "../../browser-automation/dialog-handling.js";
import type { TabContents, TabImage } from "../../browser-automation/service.js";
import type { IsolatedKeyboardInputEvent } from "../../browser-automation/trusted-input.js";
import type { CdpConnection } from "./cdp-connection.js";
import { cdpKeyEvent } from "./cdp-keys.js";

export interface CdpTabOptions {
  id: number;
  connection: CdpConnection;
  initialUrl: string;
  onState?: () => void;
  onError?: (error: unknown) => void;
  loadTimeoutMs?: number;
}

interface HistoryEntry {
  id: number;
  url: string;
  title: string;
}

// Below the 10 s CDP command timeout and the broker's 15 s, so a slow page still answers navigate.
const DEFAULT_LOAD_TIMEOUT_MS = 8_000;
const MAX_CONSOLE_MESSAGES = 500;

export class CdpTab implements TabContents {
  readonly id: number;
  readonly connection: CdpConnection;
  private url: string;
  private title = "";
  private loading = false;
  private mainFrameId: string | null = null;
  private historyIndex = 0;
  private history: HistoryEntry[] = [];
  private readonly consoleMessages: BrowserAutomationConsoleLogEntry[] = [];
  // One list per running captureDialogs call: commands on a tab are not serialized.
  private readonly dialogSinks = new Set<BrowserAutomationDialogEvent[]>();
  private inputChain: Promise<void> = Promise.resolve();
  private readonly loadWaiters = new Set<() => void>();
  private readonly onState: () => void;
  private readonly onError: (error: unknown) => void;
  private readonly loadTimeoutMs: number;

  private constructor(options: CdpTabOptions) {
    this.id = options.id;
    this.connection = options.connection;
    this.url = options.initialUrl;
    // Both callbacks run from socket handlers and rejection handlers: a throw must not escape.
    this.onError = (error) => {
      try {
        options.onError?.(error);
      } catch {
        // nothing left to report to
      }
    };
    this.onState = () => {
      try {
        options.onState?.();
      } catch (error) {
        this.onError(error);
      }
    };
    this.loadTimeoutMs = options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
  }

  static async attach(options: CdpTabOptions): Promise<CdpTab> {
    const tab = new CdpTab(options);
    try {
      tab.listen();
      await tab.connection.send("Page.enable");
      await tab.connection.send("Runtime.enable");
      const tree = await tab.connection.send<{ frameTree?: { frame?: { id?: string } } }>(
        "Page.getFrameTree",
      );
      tab.mainFrameId = tree.frameTree?.frame?.id ?? null;
      await tab.refreshHistory();
      return tab;
    } catch (error) {
      tab.dispose();
      throw error;
    }
  }

  dispose(): void {
    this.connection.close();
  }

  getURL(): string {
    return this.url;
  }
  getTitle(): string {
    return this.title;
  }
  canGoBack(): boolean {
    return this.historyIndex > 0;
  }
  canGoForward(): boolean {
    return this.historyIndex < this.history.length - 1;
  }
  isLoading(): boolean {
    return this.loading;
  }
  isDestroyed(): boolean {
    return this.connection.closed;
  }

  async executeJavaScript(code: string): Promise<unknown> {
    const response = await this.connection.send<{
      result?: { value?: unknown };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>("Runtime.evaluate", {
      expression: code,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text ??
          "Evaluation failed",
      );
    }
    return response.result?.value;
  }

  async loadURL(url: string): Promise<void> {
    const loaded = this.waitForLoad();
    const response = await this.connection.send<{ loaderId?: string; errorText?: string }>(
      "Page.navigate",
      { url },
    );
    if (response.errorText) throw new Error(response.errorText);
    // A same-document navigation (a fragment change) has no loader, and no load event follows.
    if (!response.loaderId) return;
    await loaded;
  }

  goBack(): void {
    this.detached(() => this.navigateHistory(-1));
  }
  goForward(): void {
    this.detached(() => this.navigateHistory(1));
  }
  reload(): void {
    this.detached(() => this.connection.send("Page.reload"));
  }

  async captureFrame(signal: AbortSignal): Promise<TabImage> {
    signal.throwIfAborted();
    const { data } = await this.connection.send<{ data: string }>("Page.captureScreenshot", {
      format: "png",
    });
    signal.throwIfAborted();
    const png = Buffer.from(data, "base64");
    return {
      toPNG: () => png,
      // IHDR starts at byte 8; width and height are its first two big-endian u32 fields.
      getSize: () => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }),
    };
  }

  invalidate(): void {}

  withFrameProduction<T>(capture: () => Promise<T>): Promise<T> {
    return capture();
  }

  sendInputEvent(event: IsolatedKeyboardInputEvent): void {
    // The engine calls this synchronously three times per key; the chain keeps the order.
    this.inputChain = this.inputChain
      .then(() => this.connection.send("Input.dispatchKeyEvent", cdpKeyEvent(event)))
      .then(
        () => {
          return undefined;
        },
        (error) => this.onError(error),
      );
  }

  async insertText(text: string): Promise<void> {
    await this.inputChain;
    await this.connection.send("Input.insertText", { text });
  }

  getConsoleMessages(): BrowserAutomationConsoleLogEntry[] {
    return [...this.consoleMessages];
  }

  async captureDialogs<T>(
    task: () => Promise<T>,
  ): Promise<{ result: T; dialogs: BrowserAutomationDialogEvent[] }> {
    const dialogs: BrowserAutomationDialogEvent[] = [];
    this.dialogSinks.add(dialogs);
    try {
      return { result: await task(), dialogs };
    } finally {
      this.dialogSinks.delete(dialogs);
    }
  }

  sendDebugCommand(command: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.connection.send(command, params);
  }

  private listen(): void {
    const on = (event: string, handler: (params: Record<string, unknown>) => void) =>
      this.connection.on(event, (params) => {
        try {
          handler(params);
        } catch (error) {
          this.onError(error);
        }
      });
    const isMainFrame = (frameId: unknown) =>
      this.mainFrameId === null || frameId === this.mainFrameId;

    on("Page.frameStartedLoading", (params) => {
      if (!isMainFrame(params.frameId)) return;
      this.loading = true;
      this.onState();
    });
    on("Page.frameStoppedLoading", (params) => {
      if (!isMainFrame(params.frameId)) return;
      this.finishLoad();
    });
    on("Page.loadEventFired", () => this.finishLoad());
    on("Page.frameNavigated", (params) => {
      const frame = params.frame as { id?: string; parentId?: string; url?: string } | undefined;
      if (!frame || frame.parentId) return;
      if (frame.id) this.mainFrameId = frame.id;
      if (frame.url) this.url = frame.url;
      this.onState();
      this.detached(() => this.refreshHistory());
    });
    on("Page.navigatedWithinDocument", (params) => {
      if (!isMainFrame(params.frameId) || typeof params.url !== "string") return;
      this.url = params.url;
      this.onState();
      this.detached(() => this.refreshHistory());
    });
    on("Runtime.consoleAPICalled", (params) => {
      const args = Array.isArray(params.args)
        ? (params.args as Array<{ value?: unknown; description?: string }>)
        : [];
      this.consoleMessages.push({
        level: typeof params.type === "string" ? params.type : "log",
        message: args
          .map((arg) => (arg.value !== undefined ? String(arg.value) : (arg.description ?? "")))
          .join(" "),
        timestamp: typeof params.timestamp === "number" ? params.timestamp : Date.now(),
      });
      if (this.consoleMessages.length > MAX_CONSOLE_MESSAGES) this.consoleMessages.shift();
    });
    on("Page.javascriptDialogOpening", (params) => {
      // An unanswered dialog blocks the page, and with it every later command.
      const event = handledDialogEvent(params);
      for (const sink of this.dialogSinks)
        if (sink.length < MAX_DIALOGS_PER_COMMAND) sink.push(event);
      this.detached(() =>
        this.connection.send("Page.handleJavaScriptDialog", {
          accept: dialogAcceptValue(event.type),
        }),
      );
    });
  }

  private finishLoad(): void {
    this.loading = false;
    for (const resolve of this.loadWaiters) resolve();
    this.loadWaiters.clear();
    this.onState();
    this.detached(() => this.refreshHistory());
  }

  /** Resolves on the next load event, or after the timeout: a slow page is not a failed navigation. */
  private waitForLoad(): Promise<void> {
    let done: () => void = () => {};
    const loaded = new Promise<void>((resolve) => {
      done = () => resolve();
    });
    const timer = setTimeout(done, this.loadTimeoutMs);
    this.loadWaiters.add(done);
    // Removed once settled, so close listeners do not pile up one per navigation.
    const offClose = this.connection.onClose(done);
    return loaded.finally(() => {
      clearTimeout(timer);
      this.loadWaiters.delete(done);
      offClose();
    });
  }

  private async refreshHistory(): Promise<void> {
    const response = await this.connection.send<{
      currentIndex?: number;
      entries?: HistoryEntry[];
    }>("Page.getNavigationHistory");
    this.history = response.entries ?? [];
    this.historyIndex = response.currentIndex ?? 0;
    const current = this.history[this.historyIndex];
    if (current) {
      this.url = current.url;
      this.title = current.title;
    }
    this.onState();
  }

  private async navigateHistory(offset: number): Promise<void> {
    await this.refreshHistory();
    const entry = this.history[this.historyIndex + offset];
    if (entry) await this.connection.send("Page.navigateToHistoryEntry", { entryId: entry.id });
  }

  /** Runs work nobody awaits. A rejection here would otherwise be unhandled in the daemon. */
  private detached(run: () => Promise<unknown>): void {
    run().catch((error) => {
      if (!this.connection.closed) this.onError(error);
    });
  }
}
