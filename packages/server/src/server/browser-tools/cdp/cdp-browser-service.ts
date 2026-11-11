import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import {
  BROWSER_AUTOMATION_COMMAND_NAMES,
  type BrowserAutomationErrorCode,
  type BrowserAutomationExecuteRequest,
  type BrowserAutomationExecuteResponse,
} from "@getpaseo/protocol/browser-automation/rpc-schemas";
import type { CdpBrowserErrorCode } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import {
  executeAutomationCommand,
  type BrowserRegistry,
} from "../../browser-automation/service.js";
import type { BrowserToolsBroker } from "../broker.js";
import { browserToolsFailure } from "../errors.js";
import {
  CdpClosedError,
  CdpCommandError,
  CdpTimeoutError,
  type CdpConnection,
} from "./cdp-connection.js";
import { CdpUnreachableError, type CdpEndpoint } from "./cdp-endpoint.js";
import { CdpTab } from "./cdp-tab.js";
import { ScreencastHub } from "./screencast-hub.js";
import type { CdpTabEntry, CdpTabRegistry } from "./tab-registry.js";

export const CDP_HOST_ID = "cdp-browser-host";
export const AGENT_ACTIVITY_MS = 3000;
/**
 * The CDP command timeout the daemon gives its CdpEndpoint. It must stay below the broker's 15 s,
 * so a stalled command fails here first and answers as a retryable browser_timeout.
 */
export const CDP_COMMAND_TIMEOUT_MS = 10_000;
const AGENT_VIEWPORT_OWNER = "agent";
/** Each daemon tab is a Chromium window with its own renderer, in the user's logged-in browser. */
export const MAX_DAEMON_TABS = 10;
/**
 * upload checks the path in the daemon's container, and Chromium runs in another one that does
 * not have the file, so the Docker host does not offer it.
 */
const CDP_HOST_COMMANDS = BROWSER_AUTOMATION_COMMAND_NAMES.filter((name) => name !== "upload");

type Payload = BrowserAutomationExecuteResponse["payload"];

export interface CdpTabState {
  browserId: string;
  workspaceId: string;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /**
   * Daemon wall-clock time. Only null versus non-null carries meaning to a client: a client's
   * clock may be skewed, so do not compare this value with it.
   */
  agentActiveUntil: number | null;
}

export type CdpBrowserEvent =
  | { kind: "opened"; tab: CdpTabState }
  | { kind: "closed"; browserId: string; workspaceId: string; lastUrl: string }
  | { kind: "state"; tab: CdpTabState }
  | { kind: "host"; connected: boolean };

export interface CdpViewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export function clampViewport(viewport: CdpViewport): CdpViewport {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  return {
    width: Math.round(clamp(viewport.width, 320, 1920)),
    height: Math.round(clamp(viewport.height, 240, 1080)),
    deviceScaleFactor: clamp(viewport.deviceScaleFactor, 1, 2),
  };
}

export interface CdpBrowserServiceOptions {
  endpoint: CdpEndpoint;
  registry: CdpTabRegistry;
  broker: BrowserToolsBroker;
  logger: Pick<Logger, "debug" | "info" | "warn" | "error">;
  now?: () => number;
  createBrowserId?: () => string;
  reconnect?: { minMs: number; maxMs: number };
}

/** The one URL check for tabs the daemon opens or navigates: http, https or about:blank. */
export function isOpenableUrl(url: string): boolean {
  if (url === "about:blank") return true;
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * The one map from a CDP failure to an error code, for agent responses and the pane's
 * browser.cdp messages alike. Every code it returns is in both vocabularies.
 */
export function cdpErrorCode(error: unknown): BrowserAutomationErrorCode & CdpBrowserErrorCode {
  if (error instanceof CdpTimeoutError) return "browser_timeout";
  if (error instanceof CdpUnreachableError || error instanceof CdpClosedError)
    return "browser_no_host";
  // ScreencastHub.watch rejects with this message when the tab has no socket to watch.
  if (error instanceof Error && error.message === "browser_tab_not_found")
    return "browser_tab_not_found";
  return "browser_unknown_error";
}

export class CdpBrowserService {
  private readonly endpoint: CdpEndpoint;
  private readonly registry: CdpTabRegistry;
  private readonly broker: BrowserToolsBroker;
  private readonly logger: Pick<Logger, "debug" | "info" | "warn" | "error">;
  private readonly now: () => number;
  private readonly createBrowserId: () => string;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;

  private browser: CdpConnection | null = null;
  private unregister: (() => void) | null = null;
  private stopped = true;
  private loaded = false;
  private connecting = false;
  /** Set once an unreachable Chromium was logged at warn, so retries do not repeat it. */
  private reportedUnreachable = false;
  private backoffMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private nextTabId = 1;
  private readonly tabs = new Map<string, CdpTab>();
  private readonly attaching = new Map<string, Promise<CdpTab | null>>();
  private readonly viewports = new Map<string, CdpViewport & { owner: string }>();
  private readonly agentActiveUntil = new Map<string, number>();
  private readonly agentTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly activeByWorkspace = new Map<string, string>();
  private readonly listeners = new Set<(event: CdpBrowserEvent) => void>();
  private readonly attachListeners = new Set<(browserId: string) => void>();
  readonly screencast: ScreencastHub;

  private readonly browserRegistry: BrowserRegistry = {
    listRegisteredBrowserIds: () => this.registry.list().map((entry) => entry.browserId),
    listRegisteredBrowserIdsForWorkspace: (workspaceId) =>
      this.registry
        .list()
        .filter((entry) => entry.workspaceId === workspaceId)
        .map((entry) => entry.browserId),
    getTabContents: (browserId) => this.tabs.get(browserId) ?? null,
    getBrowserWorkspaceId: (browserId) => this.registry.get(browserId)?.workspaceId ?? null,
    getWorkspaceActiveBrowserId: (workspaceId) => {
      const active = this.activeByWorkspace.get(workspaceId);
      if (active && this.registry.get(active)) return active;
      const inWorkspace = this.registry.list().filter((entry) => entry.workspaceId === workspaceId);
      return inWorkspace.at(-1)?.browserId ?? null;
    },
  };

  constructor(options: CdpBrowserServiceOptions) {
    this.endpoint = options.endpoint;
    this.registry = options.registry;
    this.broker = options.broker;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
    this.createBrowserId = options.createBrowserId ?? randomUUID;
    this.minBackoffMs = options.reconnect?.minMs ?? 1_000;
    this.maxBackoffMs = options.reconnect?.maxMs ?? 30_000;
    this.backoffMs = this.minBackoffMs;
    this.screencast = new ScreencastHub({
      source: async (browserId) => (await this.attachedTab(browserId))?.connection ?? null,
      onError: (error) => this.logger.debug({ err: error }, "Screencast error"),
    });
    // A tab that reconnects after a timed-out command has a new socket; its viewers follow it.
    this.onAttached((browserId) => {
      this.screencast
        .rebind(browserId)
        .catch((error: unknown) => this.logger.debug({ err: error }, "Screencast rebind failed"));
    });
  }

  get connected(): boolean {
    return this.browser !== null;
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const timer of this.agentTimers.values()) clearTimeout(timer);
    this.agentTimers.clear();
    const browser = this.browser;
    this.disconnect();
    browser?.close();
    await this.registry.flush();
  }

  retryNow(): void {
    if (this.stopped || this.browser) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.backoffMs = this.minBackoffMs;
    void this.connect();
  }

  listTabs(): CdpTabState[] {
    return this.registry.list().map((entry) => this.stateOf(entry));
  }

  subscribe(listener: (event: CdpBrowserEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onAttached(listener: (browserId: string) => void): () => void {
    this.attachListeners.add(listener);
    return () => this.attachListeners.delete(listener);
  }

  workspaceOf(browserId: string): string | null {
    return this.registry.get(browserId)?.workspaceId ?? null;
  }

  async openTab(input: { workspaceId: string; url?: string }): Promise<CdpTabState> {
    const browser = this.browser;
    if (!browser) throw new CdpUnreachableError("The Docker browser is unreachable.");
    const url = input.url ?? "about:blank";
    if (!isOpenableUrl(url)) throw new Error("Only http and https URLs can be opened.");
    if (this.registry.list().length >= MAX_DAEMON_TABS) {
      throw new Error(
        `The Docker browser already has ${MAX_DAEMON_TABS} open tabs. Close a tab before opening another.`,
      );
    }
    // A background tab is hidden: it paints no screencast frames and its requestAnimationFrame
    // never fires. A background window is visible and does not take focus from the noVNC desktop.
    const { targetId } = await browser.send<{ targetId: string }>("Target.createTarget", {
      url,
      newWindow: true,
      background: true,
    });
    const entry: CdpTabEntry = {
      browserId: this.createBrowserId(),
      targetId,
      workspaceId: input.workspaceId,
      lastUrl: url,
      createdAt: this.now(),
    };
    this.registry.add(entry);
    this.broker.claimBrowser(CDP_HOST_ID, entry.browserId);
    this.activeByWorkspace.set(entry.workspaceId, entry.browserId);
    await this.attachedTab(entry.browserId);
    const state = this.stateOf(entry);
    this.emit({ kind: "opened", tab: state });
    return state;
  }

  async closeTab(browserId: string): Promise<boolean> {
    const entry = this.registry.get(browserId);
    if (!entry) return false;
    // A tab the daemon forgets but did not close is a window it can never close again.
    if (!this.browser) throw new CdpUnreachableError("The Docker browser is unreachable.");
    try {
      await this.browser.send("Target.closeTarget", { targetId: entry.targetId });
    } catch (error) {
      const gone =
        error instanceof CdpCommandError && error.message.includes("No target with given id");
      if (!gone) throw error;
    }
    // The targetDestroyed event usually gets here first; forget() is a no-op the second time.
    this.forget(browserId);
    return true;
  }

  /** The live tab for a registered browser, reconnecting its socket when the last one closed. */
  attachedTab(browserId: string): Promise<CdpTab | null> {
    const existing = this.tabs.get(browserId);
    if (existing && !existing.isDestroyed()) return Promise.resolve(existing);
    const entry = this.registry.get(browserId);
    if (!entry || !this.browser) return Promise.resolve(null);
    const running = this.attaching.get(browserId);
    if (running) return running;
    const attach = this.attach(entry).finally(() => this.attaching.delete(browserId));
    this.attaching.set(browserId, attach);
    return attach;
  }

  /** Whether this size, once clamped, differs from the one the tab was last given. */
  viewportDiffers(browserId: string, viewport: CdpViewport): boolean {
    const next = clampViewport(viewport);
    const current = this.viewports.get(browserId);
    return (
      !current ||
      current.width !== next.width ||
      current.height !== next.height ||
      current.deviceScaleFactor !== next.deviceScaleFactor
    );
  }

  /** Resolves with the clamped size, which is what the page gets. */
  async setViewport(browserId: string, viewport: CdpViewport, owner: string): Promise<CdpViewport> {
    const next = clampViewport(viewport);
    const same = !this.viewportDiffers(browserId, viewport);
    this.viewports.set(browserId, { ...next, owner });
    if (same) return next;
    const tab = await this.attachedTab(browserId);
    if (tab) await this.applyViewport(tab, next);
    return next;
  }

  viewportOwner(browserId: string): string | null {
    return this.viewports.get(browserId)?.owner ?? null;
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connecting || this.browser) return;
    this.connecting = true;
    let pending: CdpConnection | null = null;
    try {
      if (!this.loaded) {
        await this.registry.load();
        this.loaded = true;
      }
      const targets = await this.endpoint.listTargets();
      for (const dropped of this.registry.reconcile(new Set(targets.map((target) => target.id)))) {
        this.announceClosed(dropped);
      }
      const browser = await this.endpoint.connectBrowser();
      pending = browser;
      browser.on("Target.targetCreated", (params) =>
        this.guard(() => this.onTargetCreated(params)),
      );
      browser.on("Target.targetDestroyed", (params) =>
        this.guard(() => this.onTargetDestroyed(params)),
      );
      browser.onClose(() => this.guard(() => this.onBrowserClosed(browser)));
      await browser.send("Target.setDiscoverTargets", { discover: true });
      if (this.stopped) return;
      this.browser = browser;
      pending = null;
      this.backoffMs = this.minBackoffMs;
      this.unregister = this.broker.registerClient({
        id: CDP_HOST_ID,
        hostKind: "docker-chromium",
        supportedCommands: CDP_HOST_COMMANDS,
        prefersNewTabs: true,
        sendBrowserAutomationRequest: (request) => this.handleRequest(request),
      });
      for (const entry of this.registry.list())
        this.broker.claimBrowser(CDP_HOST_ID, entry.browserId);
      this.emit({ kind: "host", connected: true });
      if (this.reportedUnreachable) this.logger.info("Docker browser CDP is reachable again");
      this.reportedUnreachable = false;
    } catch (error) {
      // Warn once per outage; the retries log at debug.
      if (this.reportedUnreachable) {
        this.logger.debug({ err: error }, "Docker browser CDP is unreachable");
      } else {
        this.logger.warn({ err: error }, "Docker browser CDP is unreachable");
        this.reportedUnreachable = true;
      }
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
      // A socket that opened but never became the host's (stopped, or setup failed) is not kept.
      pending?.close();
    }
  }

  /**
   * Only a closed browser socket is detected. A hung Chromium with an open socket keeps the host
   * registered and agents wait out their command timeouts: v1 has no liveness probe (ruled).
   */
  private onBrowserClosed(browser: CdpConnection): void {
    if (this.browser === browser) {
      this.disconnect();
      this.emit({ kind: "host", connected: false });
    }
    this.scheduleReconnect();
  }

  private disconnect(): void {
    this.browser = null;
    this.unregister?.();
    this.unregister = null;
    for (const tab of this.tabs.values()) tab.dispose();
    this.tabs.clear();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || this.browser) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
  }

  private async attach(entry: CdpTabEntry): Promise<CdpTab | null> {
    try {
      const connection = await this.endpoint.connectTarget(entry.targetId);
      const tab = await CdpTab.attach({
        id: this.nextTabId++,
        connection,
        initialUrl: entry.lastUrl,
        onState: () => this.guard(() => this.onTabState(entry.browserId)),
        onError: (error) =>
          this.logger.debug({ err: error, browserId: entry.browserId }, "CDP tab error"),
      });
      if (!this.registry.get(entry.browserId) || !this.browser) {
        tab.dispose();
        return null;
      }
      this.tabs.set(entry.browserId, tab);
      connection.onClose(() => this.guard(() => this.onTabSocketClosed(entry.browserId, tab)));
      // The device metrics override belongs to the socket that set it, so a new socket needs it again.
      const viewport = this.viewports.get(entry.browserId);
      if (viewport) {
        await this.applyViewport(tab, viewport).catch((error: unknown) => {
          this.logger.debug({ err: error, browserId: entry.browserId }, "CDP viewport failed");
        });
      }
      for (const listener of this.attachListeners) this.guard(() => listener(entry.browserId));
      return tab;
    } catch (error) {
      this.logger.debug({ err: error, browserId: entry.browserId }, "CDP tab attach failed");
      return null;
    }
  }

  /**
   * A command that timed out closed the tab's socket. Nothing else re-attaches a tab that someone
   * only watches, so do it here; the new socket's onAttached moves the screencast over.
   */
  private onTabSocketClosed(browserId: string, tab: CdpTab): void {
    if (this.tabs.get(browserId) !== tab) return;
    this.tabs.delete(browserId);
    if (!this.registry.get(browserId) || this.screencast.viewerCount(browserId) === 0) return;
    this.attachedTab(browserId).catch((error: unknown) =>
      this.logger.debug({ err: error, browserId }, "CDP tab re-attach failed"),
    );
  }

  private async applyViewport(tab: CdpTab, viewport: CdpViewport): Promise<void> {
    // mobile: true shrinks the page scale on narrow widths; the width alone gives the responsive layout.
    await tab.connection.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      mobile: false,
    });
  }

  private onTargetCreated(params: Record<string, unknown>): void {
    const info = params.targetInfo as
      | { targetId?: string; type?: string; url?: string; openerId?: string }
      | undefined;
    if (!info?.targetId || info.type !== "page" || !info.openerId) return;
    const entry = this.registry.adoptPopup({
      targetId: info.targetId,
      openerId: info.openerId,
      url: info.url ?? "about:blank",
      browserId: this.createBrowserId(),
      now: this.now(),
    });
    if (!entry) return;
    this.broker.claimBrowser(CDP_HOST_ID, entry.browserId);
    void this.attachedTab(entry.browserId).then(
      () => this.guard(() => this.emit({ kind: "opened", tab: this.stateOf(entry) })),
      (error) => this.logger.debug({ err: error }, "CDP popup attach failed"),
    );
  }

  private onTargetDestroyed(params: Record<string, unknown>): void {
    const entry =
      typeof params.targetId === "string" ? this.registry.findByTarget(params.targetId) : null;
    if (entry) this.forget(entry.browserId);
  }

  private forget(browserId: string): void {
    const entry = this.registry.remove(browserId);
    if (entry) this.announceClosed(entry);
  }

  private announceClosed(entry: CdpTabEntry): void {
    this.tabs.get(entry.browserId)?.dispose();
    this.tabs.delete(entry.browserId);
    this.viewports.delete(entry.browserId);
    this.agentActiveUntil.delete(entry.browserId);
    const timer = this.agentTimers.get(entry.browserId);
    if (timer) clearTimeout(timer);
    this.agentTimers.delete(entry.browserId);
    this.screencast.drop(entry.browserId);
    this.broker.releaseBrowser(entry.browserId);
    this.emit({
      kind: "closed",
      browserId: entry.browserId,
      workspaceId: entry.workspaceId,
      lastUrl: entry.lastUrl,
    });
  }

  private onTabState(browserId: string): void {
    const entry = this.registry.get(browserId);
    const tab = this.tabs.get(browserId);
    if (!entry || !tab) return;
    this.registry.setLastUrl(browserId, tab.getURL());
    this.emit({ kind: "state", tab: this.stateOf(this.registry.get(browserId) ?? entry) });
  }

  private noteAgentActivity(browserId: string): void {
    const entry = this.registry.get(browserId);
    if (!entry) return;
    this.agentActiveUntil.set(browserId, this.now() + AGENT_ACTIVITY_MS);
    this.activeByWorkspace.set(entry.workspaceId, browserId);
    this.emit({ kind: "state", tab: this.stateOf(entry) });
    const previous = this.agentTimers.get(browserId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this.guard(() => {
        this.agentTimers.delete(browserId);
        this.agentActiveUntil.delete(browserId);
        const current = this.registry.get(browserId);
        if (current) this.emit({ kind: "state", tab: this.stateOf(current) });
      });
    }, AGENT_ACTIVITY_MS);
    timer.unref?.();
    this.agentTimers.set(browserId, timer);
  }

  private stateOf(entry: CdpTabEntry): CdpTabState {
    const tab = this.tabs.get(entry.browserId);
    return {
      browserId: entry.browserId,
      workspaceId: entry.workspaceId,
      url: tab?.getURL() ?? entry.lastUrl,
      title: tab?.getTitle() ?? "",
      isLoading: tab?.isLoading() ?? false,
      canGoBack: tab?.canGoBack() ?? false,
      canGoForward: tab?.canGoForward() ?? false,
      agentActiveUntil: this.agentActiveUntil.get(entry.browserId) ?? null,
    };
  }

  /** The broker's send hook. It never rejects: every outcome goes back as a response payload. */
  private async handleRequest(request: BrowserAutomationExecuteRequest): Promise<void> {
    let payload: Payload;
    try {
      payload = await this.execute(request);
    } catch (error) {
      payload = this.failure(request.requestId, error);
    }
    try {
      this.broker.receiveResponse({ type: "browser.automation.execute.response", payload }, [
        CDP_HOST_ID,
      ]);
    } catch (error) {
      this.logger.error({ err: error }, "Failed to deliver a CDP browser response");
    }
  }

  private async execute(request: BrowserAutomationExecuteRequest): Promise<Payload> {
    const { requestId, command } = request;
    if (command.command === "new_tab") {
      if (!request.workspaceId) {
        return browserToolsFailure({
          requestId,
          code: "browser_unknown_error",
          message: "browser_new_tab needs a workspace.",
        });
      }
      const tab = await this.openTab({ workspaceId: request.workspaceId, url: command.args.url });
      this.noteAgentActivity(tab.browserId);
      return {
        requestId,
        ok: true,
        result: {
          command: "new_tab",
          browserId: tab.browserId,
          workspaceId: tab.workspaceId,
          url: tab.url,
        },
      };
    }
    if (command.command === "list_tabs") {
      await Promise.all(this.registry.list().map((entry) => this.attachedTab(entry.browserId)));
      return executeAutomationCommand(request, this.browserRegistry);
    }

    const browserId = command.args.browserId;
    const entry = this.registry.get(browserId);
    if (!entry || (request.workspaceId && entry.workspaceId !== request.workspaceId)) {
      return browserToolsFailure({
        requestId,
        code: "browser_tab_not_found",
        message: `Browser tab ${browserId} is not open in the Docker browser. Call browser_list_tabs.`,
      });
    }
    if (command.command === "close_tab") {
      await this.closeTab(browserId);
      return { requestId, ok: true, result: { command: "close_tab", browserId } };
    }
    this.noteAgentActivity(browserId);
    if (command.command === "resize") {
      // An agent's size holds until a person interacts with the pane again.
      const { width, height } = await this.setViewport(
        browserId,
        { width: command.args.width, height: command.args.height, deviceScaleFactor: 1 },
        AGENT_VIEWPORT_OWNER,
      );
      return { requestId, ok: true, result: { command: "resize", browserId, width, height } };
    }
    const tab = await this.attachedTab(browserId);
    if (!tab) {
      return browserToolsFailure({
        requestId,
        code: "browser_tab_closed",
        message: `Browser tab ${browserId} is closed.`,
      });
    }
    const payload = await executeAutomationCommand(request, this.browserRegistry);
    // The engine turns a thrown CDP error into a generic failure. A socket that closed while its
    // target is still registered means a command timed out (CdpConnection closes on timeout).
    if (!payload.ok && tab.isDestroyed() && this.registry.get(browserId)) {
      return this.failure(requestId, new CdpTimeoutError(command.command, 0));
    }
    return payload;
  }

  private failure(requestId: string, error: unknown): Payload {
    const code = cdpErrorCode(error);
    if (code === "browser_timeout") {
      return browserToolsFailure({
        requestId,
        code,
        message: "The page did not answer in time.",
        retryable: true,
      });
    }
    if (code === "browser_no_host") {
      return browserToolsFailure({
        requestId,
        code,
        message: "The Docker browser is unreachable.",
        retryable: true,
      });
    }
    return browserToolsFailure({
      requestId,
      code,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private emit(event: CdpBrowserEvent): void {
    for (const listener of this.listeners) this.guard(() => listener(event));
  }

  private guard(run: () => void): void {
    try {
      run();
    } catch (error) {
      this.logger.error({ err: error }, "CDP browser host handler failed");
    }
  }
}
