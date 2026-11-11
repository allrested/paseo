import type { Logger } from "pino";
import type {
  CdpBrowserErrorCode,
  CdpBrowserViewInput,
} from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import { encodeBrowserViewFrame } from "@getpaseo/protocol/binary-frames/index";
import type { SessionInboundMessage, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type { SessionDelivery } from "../../session/owned-subscriptions/index.js";
import { cdpErrorCode, isOpenableUrl, type CdpBrowserService } from "./cdp-browser-service.js";
import { dispatchViewInput } from "./view-input.js";

type Inbound<T extends SessionInboundMessage["type"]> = Extract<SessionInboundMessage, { type: T }>;
type Emit = (message: SessionOutboundMessage) => void;

/** Inputs one view may have queued, running or waiting. A stalled page must not collect a backlog. */
export const VIEW_INPUT_QUEUE_CAP = 32;
/** How long presses wait for a frame of the new size after a resize. A still page may not repaint. */
export const RESIZE_FRAME_WAIT_MS = 1000;

interface FrameSize {
  width: number;
  height: number;
}

interface View {
  browserId: string;
  viewerId: string;
  chain: Promise<void>;
  depth: number;
  /** Held buttons and keys: true when the press was queued, false when it was dropped. */
  presses: Map<string, boolean>;
  /** The page size, in CSS pixels, of the last frame this viewer was sent. */
  frameSize: FrameSize | null;
  /** The size an input resized the page to, until a frame of that size is sent or the wait ends. */
  awaitedSize: FrameSize | null;
  awaitTimer: ReturnType<typeof setTimeout> | null;
  /** Buttons whose press was aimed at a frame from before a resize; the rest of the gesture goes too. */
  stale: Set<string>;
  notify(error: CdpBrowserErrorCode): void;
}

/**
 * The client mapped a press to page coordinates on the frame it showed. Until a frame of the new
 * size reaches it, a press would click whatever reflowed under it, so the gesture is dropped.
 */
function isStale(view: View, input: CdpBrowserViewInput): boolean {
  if (input.kind !== "mouse") return false;
  if (input.type === "down" && view.awaitedSize) {
    view.stale.add(input.button);
    return true;
  }
  if (input.type === "up") return view.stale.delete(input.button);
  return input.buttons !== 0 && view.stale.size > 0;
}

function sameSize(a: FrameSize | null, b: FrameSize): boolean {
  return a !== null && a.width === b.width && a.height === b.height;
}

function stopAwaiting(view: View): void {
  if (view.awaitTimer) clearTimeout(view.awaitTimer);
  view.awaitTimer = null;
  view.awaitedSize = null;
}

function pressId(input: CdpBrowserViewInput): string | null {
  if (input.kind === "mouse" && input.type !== "move") return `mouse:${input.button}`;
  if (input.kind === "key") return `key:${input.code}`;
  return null;
}

/**
 * Whether an input joins the view's queue. Moves and wheels are dropped once something waits, all
 * else at the cap, so late input cannot replay. A release goes exactly when its press went.
 */
function admit(view: View, input: CdpBrowserViewInput): boolean {
  const press = pressId(input);
  const release = (input.kind === "mouse" || input.kind === "key") && input.type === "up";
  if (press && release) {
    const queued = view.presses.get(press) !== false;
    view.presses.delete(press);
    return queued;
  }
  // A repeat of a dropped press is dropped too; the page gets neither it nor the release.
  if (press && view.presses.get(press) === false) return false;
  const continuous = input.kind === "wheel" || (input.kind === "mouse" && input.type === "move");
  const admitted = view.depth < (continuous ? 2 : VIEW_INPUT_QUEUE_CAP);
  if (press && !view.presses.has(press)) view.presses.set(press, admitted);
  return admitted;
}

/** One session's browser.cdp.* handlers. The service and its hub are shared by every session. */
export class CdpViewSession {
  private readonly views = new Map<string, View>();

  constructor(
    private readonly service: () => CdpBrowserService | null,
    private readonly logger: Pick<Logger, "debug">,
    private readonly options: { resizeFrameWaitMs?: number } = {},
  ) {}

  async openTab(msg: Inbound<"browser.cdp.tab.open.request">, emit: Emit): Promise<void> {
    const respond = (
      tab: Awaited<ReturnType<CdpBrowserService["openTab"]>> | null,
      error: CdpBrowserErrorCode | null,
    ) =>
      emit({
        type: "browser.cdp.tab.open.response",
        payload: { requestId: msg.requestId, tab, error },
      });
    const service = this.service();
    if (!service) return respond(null, "browser_unsupported");
    try {
      respond(await service.openTab({ workspaceId: msg.workspaceId, url: msg.url }), null);
    } catch (error) {
      this.logger.debug({ err: error }, "browser.cdp.tab.open failed");
      respond(null, cdpErrorCode(error));
    }
  }

  async closeTab(msg: Inbound<"browser.cdp.tab.close.request">, emit: Emit): Promise<void> {
    const respond = (error: CdpBrowserErrorCode | null) =>
      emit({
        type: "browser.cdp.tab.close.response",
        payload: { requestId: msg.requestId, error },
      });
    const service = this.service();
    if (!service) return respond("browser_unsupported");
    try {
      respond((await service.closeTab(msg.browserId)) ? null : "browser_tab_not_found");
    } catch (error) {
      this.logger.debug({ err: error }, "browser.cdp.tab.close failed");
      respond(cdpErrorCode(error));
    }
  }

  async subscribeTabs(
    msg: Inbound<"browser.cdp.tabs.subscribe.request">,
    ownership: SessionDelivery,
    emit: Emit,
  ): Promise<void> {
    const service = this.service();
    if (!service || !ownership.isModern(ownership.currentSource)) {
      emit({
        type: "browser.cdp.tabs.subscribe.response",
        payload: {
          requestId: msg.requestId,
          subscriptionId: "",
          connected: false,
          tabs: [],
          error: "browser_unsupported" satisfies CdpBrowserErrorCode,
        },
      });
      return;
    }
    const inScope = (workspaceId: string) => !msg.workspaceId || msg.workspaceId === workspaceId;
    let unsubscribe: (() => void) | undefined;
    const owner = ownership.begin("cdp-tabs", undefined, () => unsubscribe?.());
    // Snapshot and listener in one synchronous turn, so no event falls between them.
    emit({
      type: "browser.cdp.tabs.subscribe.response",
      payload: {
        requestId: msg.requestId,
        subscriptionId: owner.responseId,
        connected: service.connected,
        tabs: service.listTabs().filter((tab) => inScope(tab.workspaceId)),
        error: null,
      },
    });
    unsubscribe = service.subscribe((event) => {
      if (owner.signal.aborted) return;
      if (event.kind === "closed" && !inScope(event.workspaceId)) return;
      if ((event.kind === "opened" || event.kind === "state") && !inScope(event.tab.workspaceId))
        return;
      owner.emit({
        type: "browser.cdp.tabs.update",
        payload: { subscriptionId: owner.responseId, event },
      });
    });
  }

  async subscribeView(
    msg: Inbound<"browser.cdp.view.subscribe.request">,
    ownership: SessionDelivery,
    emit: Emit,
  ): Promise<void> {
    const reject = (error: CdpBrowserErrorCode) =>
      emit({
        type: "browser.cdp.view.subscribe.response",
        payload: { requestId: msg.requestId, subscriptionId: "", error },
      });
    const service = this.service();
    if (!service || !ownership.isModern(ownership.currentSource))
      return reject("browser_unsupported");
    if (!service.connected) {
      // The pane's Retry is a new subscribe; it should not wait out the reconnect backoff.
      service.retryNow();
      return reject("browser_no_host");
    }
    // Only a tab in the service's registry can be watched. The check follows the await, so the
    // listener below starts in the same turn and no closed event falls between them.
    const tab = await service.attachedTab(msg.browserId);
    if (!tab || !service.workspaceOf(msg.browserId)) return reject("browser_tab_not_found");

    let unwatch: (() => void) | undefined;
    let offEvents: (() => void) | undefined;
    const owner = ownership.begin("cdp-view", undefined, () => {
      this.views.delete(owner.responseId);
      stopAwaiting(view);
      offEvents?.();
      unwatch?.();
    });
    const notify = (error: CdpBrowserErrorCode) => {
      if (owner.signal.aborted) return;
      owner.emit({
        type: "browser.cdp.view.update",
        payload: { subscriptionId: owner.responseId, error },
      });
    };
    const view: View = {
      browserId: msg.browserId,
      viewerId: owner.id,
      chain: Promise.resolve(),
      depth: 0,
      presses: new Map(),
      frameSize: null,
      awaitedSize: null,
      awaitTimer: null,
      stale: new Set(),
      notify,
    };
    this.views.set(owner.responseId, view);
    offEvents = service.subscribe((event) => {
      if (event.kind === "closed" && event.browserId === msg.browserId) {
        notify("browser_tab_not_found");
        // The tab is gone for good. Ending the view also covers a tab that closed while its first
        // watch was starting: the hub had nothing to drop then, and the late watch is stopped below.
        owner.release().catch((error: unknown) => {
          this.logger.debug({ err: error }, "browser.cdp.view release after close failed");
        });
      }
      if (event.kind === "host" && !event.connected) notify("browser_no_host");
      if (event.kind === "host" && event.connected) this.reattach(service, msg.browserId);
    });
    // The response goes first: a client can route a frame only once it knows the subscription id.
    emit({
      type: "browser.cdp.view.subscribe.response",
      payload: { requestId: msg.requestId, subscriptionId: owner.responseId, error: null },
    });
    try {
      // A new viewer takes the size only when nobody has set one; after that, input claims it.
      if (service.viewportOwner(msg.browserId) === null) {
        await service.setViewport(
          msg.browserId,
          { width: msg.width, height: msg.height, deviceScaleFactor: msg.deviceScaleFactor },
          owner.id,
        );
      }
      const stop = await service.screencast.watch(msg.browserId, {
        id: owner.id,
        deliver: (frame) => {
          // Device size is the page size in CSS pixels; page scale and the JPEG size leave it alone.
          view.frameSize = {
            width: Math.round(frame.deviceWidth),
            height: Math.round(frame.deviceHeight),
          };
          if (view.awaitedSize && sameSize(view.frameSize, view.awaitedSize)) stopAwaiting(view);
          return owner.emitBinaryAndWait(
            encodeBrowserViewFrame({ subscriptionId: owner.responseId, ...frame }),
          );
        },
      });
      if (owner.signal.aborted) stop();
      else unwatch = stop;
    } catch (error) {
      this.logger.debug({ err: error }, "browser.cdp.view.subscribe failed after its response");
      notify(cdpErrorCode(error));
    }
  }

  /**
   * A Chromium reconnect disposed every tab socket, and the hub still listens on the dead one.
   * Attaching the tab again fires the service's onAttached, whose rebind moves the screencast, with
   * every session's viewers of this tab, to the new socket. attachedTab dedupes concurrent calls.
   */
  private reattach(service: CdpBrowserService, browserId: string): void {
    service.attachedTab(browserId).catch((error: unknown) => {
      this.logger.debug({ err: error, browserId }, "browser.cdp.view re-attach failed");
    });
  }

  private awaitFrame(view: View, size: FrameSize): void {
    stopAwaiting(view);
    view.awaitedSize = { width: size.width, height: size.height };
    view.awaitTimer = setTimeout(
      () => stopAwaiting(view),
      this.options.resizeFrameWaitMs ?? RESIZE_FRAME_WAIT_MS,
    );
    view.awaitTimer.unref?.();
  }

  input(msg: Inbound<"browser.cdp.view.input.request">): void {
    const view = this.views.get(msg.subscriptionId);
    const service = this.service();
    if (!view || !service || !admit(view, msg.input)) return;
    view.depth += 1;
    // One chain per view keeps a press before its release. Every failure ends in notify, never a rejection.
    view.chain = view.chain
      .then(async () => {
        try {
          if (msg.viewport) {
            // The last interacting client sets the size; a press it aimed at the old size is stale.
            const resized = service.viewportDiffers(view.browserId, msg.viewport);
            const size = await service.setViewport(view.browserId, msg.viewport, view.viewerId);
            // A frame of the new size may already have been sent while the resize settled.
            if (resized && !sameSize(view.frameSize, size)) this.awaitFrame(view, size);
          }
          if (isStale(view, msg.input)) return undefined;
          const tab = await service.attachedTab(view.browserId);
          if (!tab) return undefined;
          await dispatchViewInput(
            (method, params) => tab.connection.send(method, params),
            msg.input,
          );
          return undefined;
        } finally {
          view.depth -= 1;
        }
      })
      .catch((error: unknown) => {
        this.logger.debug({ err: error }, "browser.cdp.view.input failed");
        view.notify(cdpErrorCode(error));
      });
  }

  async navigate(msg: Inbound<"browser.cdp.view.navigate.request">, emit: Emit): Promise<void> {
    const respond = (error: CdpBrowserErrorCode | null) =>
      emit({
        type: "browser.cdp.view.navigate.response",
        payload: { requestId: msg.requestId, error },
      });
    const service = this.service();
    if (!service) return respond("browser_unsupported");
    try {
      const tab = await service.attachedTab(msg.browserId);
      if (!tab) return respond("browser_tab_not_found");
      const { action } = msg;
      if (action.kind === "url") {
        if (!isOpenableUrl(action.url)) return respond("browser_url_refused");
        // Not tab.loadURL: that waits for the load event, and the toolbar should not wait for it.
        const result = await tab.connection.send<{ errorText?: string }>("Page.navigate", {
          url: action.url,
        });
        return respond(result.errorText ? "browser_unknown_error" : null);
      }
      if (action.kind === "back") tab.goBack();
      else if (action.kind === "forward") tab.goForward();
      else tab.reload();
      respond(null);
    } catch (error) {
      this.logger.debug({ err: error }, "browser.cdp.view.navigate failed");
      respond(cdpErrorCode(error));
    }
  }
}
