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
import { ScreencastHub, type FrameSize } from "./screencast-hub.js";
import type { CdpTabEntry, CdpTabRegistry } from "./tab-registry.js";

export const CDP_HOST_ID = "cdp-browser-host";
export const AGENT_ACTIVITY_MS = 3000;
/**
 * The CDP command timeout the daemon gives its CdpEndpoint. It must stay below the broker's 15 s,
 * so a stalled command fails here first and answers as a retryable browser_timeout.
 */
export const CDP_COMMAND_TIMEOUT_MS = 10_000;
const AGENT_VIEWPORT_OWNER = "agent";
/** How long frames of another size are expected after the daemon set a size, and between re-applies. */
export const VIEWPORT_REAPPLY_INTERVAL_MS = 1000;
/** Re-applies in a row whose frames keep another size before the daemon gives up on the tab. */
export const VIEWPORT_REAPPLY_LIMIT = 3;
/** How long after an apply the daemon waits for Chromium's frame of the size set before it captures one. */
export const FRAME_WAIT_MS = 1000;
/** Captures in a row that bring no frame of the size set before the daemon stops capturing. */
export const FRAME_CAPTURE_LIMIT = 3;

/** Frames whose size differs from the one set: a resize of the tab's Chromium window drops it. */
interface FrameSizeCheck {
  /** Frames before this time may still show the size from before the last apply. */
  settleUntil: number;
  lastReapplyAt: number;
  /** Re-applies since the last frame of the size set; one past the limit means it gave up. */
  misses: number;
  /** Set from an apply, or a mismatch skipped for an agent, until a frame of the size set arrives. */
  awaiting: boolean;
  /** Fires when no frame of the size set came in time: the daemon then captures one. */
  waitTimer: ReturnType<typeof setTimeout> | null;
  /** Captures since awaiting began that brought no frame of the size set. */
  captures: number;
  /** A capture is out; the wait does not start another until it answers. */
  capturing: boolean;
  /** The captures ran out for this size; only a new size or a person's claim tries again. */
  gaveUp: boolean;
  /** When a person's claim of the size set last started the checks again. */
  lastRestartAt: number;
}
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

/**
 * The page size a screencast frame shows. Frame metadata is in CSS pixels, but around a screencast
 * start or a resize Chromium sometimes reports a frame in device pixels: the size set times its
 * scale factor, give or take a pixel of rounding. That frame shows the size set. Any other size,
 * such as a resized window's, is returned as reported.
 */
export function correctFrameSize(set: CdpViewport | undefined, reported: FrameSize): FrameSize {
  if (!set || set.deviceScaleFactor === 1) return reported;
  const inDevicePixels =
    Math.abs(reported.width - set.width * set.deviceScaleFactor) <= 1 &&
    Math.abs(reported.height - set.height * set.deviceScaleFactor) <= 1;
  return inDevicePixels ? { width: set.width, height: set.height } : reported;
}

export interface CdpBrowserServiceOptions {
  endpoint: CdpEndpoint;
  registry: CdpTabRegistry;
  broker: BrowserToolsBroker;
  logger: Pick<Logger, "debug" | "info" | "warn" | "error">;
  now?: () => number;
  createBrowserId?: () => string;
  reconnect?: { minMs: number; maxMs: number };
  /** Overrides FRAME_WAIT_MS, for tests. */
  frameWaitMs?: number;
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
  private readonly frameWaitMs: number;

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
  private readonly frameSizeChecks = new Map<string, FrameSizeCheck>();
  private readonly agentActiveUntil = new Map<string, number>();
  private readonly agentTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Agent commands running per tab. */
  private readonly agentCommands = new Map<string, number>();
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
    this.frameWaitMs = options.frameWaitMs ?? FRAME_WAIT_MS;
    this.screencast = new ScreencastHub({
      source: async (browserId) => (await this.attachedTab(browserId))?.connection ?? null,
      onError: (error) => this.logger.debug({ err: error }, "Screencast error"),
      frameSize: (browserId, reported) => correctFrameSize(this.viewports.get(browserId), reported),
      deviceScaleFactor: (browserId) => this.viewports.get(browserId)?.deviceScaleFactor ?? 1,
      onIdle: (browserId) => this.guard(() => this.endFrameWait(browserId)),
      onFrame: (browserId, frame) =>
        this.guard(() => this.checkFrameSize(browserId, frame.deviceWidth, frame.deviceHeight)),
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
    for (const browserId of this.frameSizeChecks.keys()) this.endFrameWait(browserId);
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
    if (same && !this.claimRestartsChecks(browserId, next, owner)) return next;
    // A new size starts a new run: the old one's failed re-applies say nothing about it. So does a
    // person's claim of the size set once the checks gave up on it.
    const check = this.frameSizeCheck(browserId);
    check.misses = 0;
    if (same) check.lastRestartAt = this.now();
    this.holdFrameSizeCheck(browserId);
    const tab = await this.attachedTab(browserId);
    if (tab) {
      await this.applyViewport(tab, next);
      this.awaitFrameOfSetSize(browserId, "apply");
    }
    return next;
  }

  /**
   * A person claims the size already set while the last frame shows another and nothing tries any
   * more: the re-apply or the capture limit ran out. The app sends no press on such a frame, so
   * without a new try the pane could never press again. Not while a wait runs, whose timer each
   * claim would push back, and at most once a second, so hover moves cannot drive it.
   */
  private claimRestartsChecks(browserId: string, set: CdpViewport, owner: string): boolean {
    if (owner === AGENT_VIEWPORT_OWNER || this.agentIsActive(browserId)) return false;
    const check = this.frameSizeChecks.get(browserId);
    if (!check || check.awaiting || check.capturing) return false;
    if (this.now() - check.lastRestartAt < VIEWPORT_REAPPLY_INTERVAL_MS) return false;
    const frame = this.screencast.lastFrame(browserId);
    if (!frame) return false;
    return (
      Math.round(frame.deviceWidth) !== set.width || Math.round(frame.deviceHeight) !== set.height
    );
  }

  viewportOwner(browserId: string): string | null {
    return this.viewports.get(browserId)?.owner ?? null;
  }

  /** The agent's browser_resize set the size, and no person's input has taken it since. */
  agentOwnsViewport(browserId: string): boolean {
    return this.viewportOwner(browserId) === AGENT_VIEWPORT_OWNER;
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
        this.holdFrameSizeCheck(entry.browserId);
        await this.applyViewport(tab, viewport).then(
          () => this.awaitFrameOfSetSize(entry.browserId, "re-attach"),
          (error: unknown) => {
            this.logger.debug({ err: error, browserId: entry.browserId }, "CDP viewport failed");
          },
        );
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

  private frameSizeCheck(browserId: string): FrameSizeCheck {
    let check = this.frameSizeChecks.get(browserId);
    if (!check) {
      check = {
        settleUntil: 0,
        lastReapplyAt: Number.NEGATIVE_INFINITY,
        misses: 0,
        awaiting: false,
        waitTimer: null,
        captures: 0,
        capturing: false,
        gaveUp: false,
        lastRestartAt: Number.NEGATIVE_INFINITY,
      };
      this.frameSizeChecks.set(browserId, check);
    }
    return check;
  }

  /** Frames of the size from before an apply keep coming for a moment; they are not a mismatch. */
  private holdFrameSizeCheck(browserId: string): void {
    this.frameSizeCheck(browserId).settleUntil = this.now() + VIEWPORT_REAPPLY_INTERVAL_MS;
  }

  /**
   * After the tab's Chromium window is resized, frames report the window's view size instead of
   * the override, and the pane shows the page small in a grey frame. Applying the override again
   * restores it. Bounded, so a page that cannot take the size does not loop.
   */
  private checkFrameSize(browserId: string, width: number, height: number): void {
    const set = this.viewports.get(browserId);
    // A frame without size metadata says nothing about the size.
    if (!set || width <= 0 || height <= 0) return;
    const check = this.frameSizeCheck(browserId);
    if (Math.round(width) === set.width && Math.round(height) === set.height) {
      check.misses = 0;
      check.settleUntil = 0;
      this.endFrameWait(browserId);
      return;
    }
    // A full-page screenshot (captureBeyondViewport) changes the emulated size while it captures;
    // an override sent then would cut the capture short. The agent's own frames are left alone,
    // and the wait looks at the tab again once the agent is done.
    if (this.agentIsActive(browserId)) {
      if (!check.awaiting) this.awaitFrameOfSetSize(browserId, "apply");
      return;
    }
    const now = this.now();
    if (now < check.settleUntil || now - check.lastReapplyAt < VIEWPORT_REAPPLY_INTERVAL_MS) return;
    if (check.misses > VIEWPORT_REAPPLY_LIMIT) return;
    check.misses += 1;
    if (check.misses > VIEWPORT_REAPPLY_LIMIT) {
      this.logger.warn(
        { browserId, set: { width: set.width, height: set.height }, frame: { width, height } },
        "CDP tab frames keep another size than the viewport set; stopped re-applying it",
      );
      return;
    }
    check.lastReapplyAt = now;
    this.holdFrameSizeCheck(browserId);
    const viewport = {
      width: set.width,
      height: set.height,
      deviceScaleFactor: set.deviceScaleFactor,
    };
    this.attachedTab(browserId)
      .then(async (tab) => {
        if (!tab) return undefined;
        await this.applyViewport(tab, viewport);
        this.awaitFrameOfSetSize(browserId, "apply");
        return undefined;
      })
      .catch((error: unknown) =>
        this.logger.debug({ err: error, browserId }, "CDP viewport re-apply failed"),
      );
  }

  private agentIsActive(browserId: string): boolean {
    return this.agentCommands.has(browserId) || this.agentBadgeShows(browserId);
  }

  /**
   * Chromium may paint the size set late, or not at all while its window is covered. Without that
   * frame the pane keeps the old picture and its presses wait, so after FRAME_WAIT_MS the daemon
   * captures one. A frame of the size set from Chromium ends the wait first.
   *
   * An apply starts the count at zero. A re-attach re-applies the same size on a new socket, so a
   * running wait keeps its count and one that gave up stays given up: a capture that times out
   * closes the socket, and its re-attach must not start the count again.
   */
  private awaitFrameOfSetSize(browserId: string, cause: "apply" | "re-attach"): void {
    if (!this.registry.get(browserId)) return;
    const check = this.frameSizeCheck(browserId);
    if (cause === "re-attach" && check.gaveUp) return;
    if (cause === "apply" || !check.awaiting) check.captures = 0;
    check.awaiting = true;
    check.gaveUp = false;
    this.scheduleFrameWait(browserId, check);
  }

  private scheduleFrameWait(browserId: string, check: FrameSizeCheck): void {
    if (check.waitTimer) clearTimeout(check.waitTimer);
    check.waitTimer = setTimeout(
      () => this.guard(() => this.onFrameWaitOver(browserId, check)),
      this.frameWaitMs,
    );
    check.waitTimer.unref?.();
  }

  private endFrameWait(browserId: string): void {
    const check = this.frameSizeChecks.get(browserId);
    if (!check) return;
    if (check.waitTimer) clearTimeout(check.waitTimer);
    check.waitTimer = null;
    check.awaiting = false;
    check.gaveUp = false;
  }

  private onFrameWaitOver(browserId: string, check: FrameSizeCheck): void {
    check.waitTimer = null;
    if (this.frameSizeChecks.get(browserId) !== check || !check.awaiting) return;
    // Nobody watches: nothing to show. The next viewer's claim or frame starts a new wait.
    if (!this.browser || this.screencast.viewerCount(browserId) === 0) {
      this.endFrameWait(browserId);
      return;
    }
    // A capture must not run inside an agent's own screenshot, nor beside another capture; look
    // again after the next wait.
    if (this.agentIsActive(browserId) || check.capturing) {
      this.scheduleFrameWait(browserId, check);
      return;
    }
    check.captures += 1;
    check.capturing = true;
    // An answer that comes after a newer size was set or an agent began is dropped.
    const set = this.viewports.get(browserId);
    const wanted = () => {
      const current = this.viewports.get(browserId);
      return (
        set !== undefined &&
        current !== undefined &&
        current.width === set.width &&
        current.height === set.height &&
        current.deviceScaleFactor === set.deviceScaleFactor &&
        !this.agentIsActive(browserId)
      );
    };
    // The captured frame goes through onFrame, so checkFrameSize ends the wait or re-applies.
    this.screencast
      .refresh(browserId, wanted)
      .catch((error: unknown) =>
        this.logger.debug({ err: error, browserId }, "CDP frame capture failed"),
      )
      .finally(() => {
        check.capturing = false;
        this.guard(() => this.afterFrameCapture(browserId, check));
      });
  }

  private afterFrameCapture(browserId: string, check: FrameSizeCheck): void {
    // Ended by a frame of the size set, the tab closed, or a new apply restarted the wait.
    if (this.frameSizeChecks.get(browserId) !== check || !check.awaiting || check.waitTimer) return;
    if (check.captures < FRAME_CAPTURE_LIMIT) {
      this.scheduleFrameWait(browserId, check);
      return;
    }
    check.awaiting = false;
    check.gaveUp = true;
    const set = this.viewports.get(browserId);
    this.logger.warn(
      { browserId, set: set ? { width: set.width, height: set.height } : null },
      "CDP tab sent no frame of the viewport set; stopped capturing one",
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
    this.endFrameWait(entry.browserId);
    this.frameSizeChecks.delete(entry.browserId);
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

  private agentBadgeShows(browserId: string): boolean {
    return (this.agentActiveUntil.get(browserId) ?? 0) > this.now();
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
    this.agentCommands.set(browserId, (this.agentCommands.get(browserId) ?? 0) + 1);
    try {
      return await this.executeOnTab(request, browserId);
    } finally {
      const left = (this.agentCommands.get(browserId) ?? 1) - 1;
      if (left > 0) this.agentCommands.set(browserId, left);
      else this.agentCommands.delete(browserId);
    }
  }

  private async executeOnTab(
    request: BrowserAutomationExecuteRequest,
    browserId: string,
  ): Promise<Payload> {
    const { requestId, command } = request;
    if (command.command === "resize") {
      // An agent's size holds until a person sends input on the tab (pointer, touch, key or text).
      // A pane's size-only claim (shown again, reconnect, layout change) does not take it.
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
