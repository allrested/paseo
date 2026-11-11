import type { CdpBrowserErrorCode } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";

export interface ScreencastFrame {
  sequence: number;
  jpeg: Uint8Array;
  deviceWidth: number;
  deviceHeight: number;
  pageScaleFactor: number;
  scrollX: number;
  scrollY: number;
}

export interface FrameSize {
  width: number;
  height: number;
}

export interface ScreencastSource {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>;
  on(event: string, listener: (params: Record<string, unknown>) => void): () => void;
}

export interface ScreencastViewer {
  id: string;
  /** Resolves when the frame left this viewer's socket. A rejection removes the viewer. */
  deliver(frame: ScreencastFrame): Promise<void>;
}

export interface ScreencastHubOptions {
  source: (browserId: string) => Promise<ScreencastSource | null>;
  onError?: (error: unknown) => void;
  /**
   * Each screencast frame of a tab, and each refresh, before it is fanned out. Not called for the
   * priming screenshot.
   */
  onFrame?: (browserId: string, frame: ScreencastFrame) => void;
  /**
   * Corrects the page size a screencast frame reports, before the cache, viewers or onFrame see
   * it. Not called for the priming screenshot, whose size comes from the layout metrics.
   */
  frameSize?: (browserId: string, reported: FrameSize) => FrameSize;
  /** The tab's device scale factor, which turns a screenshot's pixel size into CSS pixels. */
  deviceScaleFactor?: (browserId: string) => number;
  /** Nothing watches the tab any more: its last viewer left, or it was dropped. */
  onIdle?: (browserId: string) => void;
  minFrameIntervalMs?: number;
}

export const SCREENCAST_PARAMS = {
  format: "jpeg",
  quality: 60,
  maxWidth: 1920,
  maxHeight: 1080,
  everyNthFrame: 1,
} as const;

const TAB_NOT_FOUND: CdpBrowserErrorCode = "browser_tab_not_found";

interface ViewerSlot {
  viewer: ScreencastViewer;
  sending: boolean;
  pending: ScreencastFrame | null;
}

interface Watched {
  browserId: string;
  source: ScreencastSource;
  off: () => void;
  viewers: Map<string, ViewerSlot>;
  lastFrame: ScreencastFrame | null;
  priming: boolean;
  sequence: number;
  lastAckAt: number;
  ackTimer: ReturnType<typeof setTimeout> | null;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Start-of-frame markers, which carry the picture size: 0xc0 to 0xcf except DHT, JPG and DAC. */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** The pixel size in a JPEG's frame header, or null when the bytes are not a JPEG this can read. */
export function jpegSize(jpeg: Uint8Array): FrameSize | null {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 <= jpeg.length) {
    if (jpeg[at] !== 0xff) return null;
    const marker = jpeg[at + 1];
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (isStartOfFrame(marker)) {
      const height = (jpeg[at + 5] << 8) | jpeg[at + 6];
      const width = (jpeg[at + 7] << 8) | jpeg[at + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    at += 2 + ((jpeg[at + 2] << 8) | jpeg[at + 3]);
  }
  return null;
}

/** One screencast per watched tab, shared by every viewer of that tab. */
export class ScreencastHub {
  private readonly watched = new Map<string, Watched>();
  private readonly starting = new Map<string, Promise<Watched | null>>();
  private readonly minFrameIntervalMs: number;
  private readonly onError: (error: unknown) => void;
  private readonly frameSize: (browserId: string, reported: FrameSize) => FrameSize;

  constructor(private readonly options: ScreencastHubOptions) {
    this.minFrameIntervalMs = options.minFrameIntervalMs ?? 100;
    const report = options.onError ?? (() => {});
    // A throwing error callback must not escape into a socket handler or timer.
    this.onError = (error) => {
      try {
        report(error);
      } catch {
        // nothing left to report to
      }
    };
    const correct = options.frameSize;
    // A correction that throws leaves the size as Chromium reported it; the frame still goes out.
    this.frameSize = (browserId, reported) => {
      if (!correct) return reported;
      try {
        return correct(browserId, reported);
      } catch (error) {
        this.onError(error);
        return reported;
      }
    };
  }

  viewerCount(browserId: string): number {
    return this.watched.get(browserId)?.viewers.size ?? 0;
  }

  /**
   * Captures the tab once and sends the picture down the frame path: the cache, every viewer and
   * onFrame, as a screencast frame goes. Resolves false when no viewer watches the tab or the
   * capture gave no picture; rejects when the capture fails.
   */
  async refresh(browserId: string): Promise<boolean> {
    const watched = this.watched.get(browserId);
    if (!watched || watched.viewers.size === 0) return false;
    return this.capture(watched, "refresh");
  }

  /** Rejects with Error("browser_tab_not_found") when the tab has no source. */
  async watch(browserId: string, viewer: ScreencastViewer): Promise<() => void> {
    const watched = this.watched.get(browserId) ?? (await this.begin(browserId));
    if (!watched) throw new Error(TAB_NOT_FOUND);
    const slot: ViewerSlot = { viewer, sending: false, pending: null };
    watched.viewers.set(viewer.id, slot);
    if (watched.lastFrame) this.push(watched, slot, watched.lastFrame);
    else this.prime(watched);
    return () => this.leave(watched, slot);
  }

  /** The tab got a new socket. Listeners and the screencast belong to the old one. */
  async rebind(browserId: string): Promise<void> {
    const watched = this.watched.get(browserId);
    if (!watched) return;
    watched.off();
    watched.off = () => {};
    // A pending ack carries the old socket's session id.
    if (watched.ackTimer) clearTimeout(watched.ackTimer);
    watched.ackTimer = null;
    const source = await this.options.source(browserId);
    if (this.watched.get(browserId) !== watched) return;
    if (!source) {
      this.drop(browserId);
      return;
    }
    watched.source = source;
    watched.off = this.listen(watched);
    await source.send("Page.startScreencast", { ...SCREENCAST_PARAMS });
  }

  drop(browserId: string): void {
    const watched = this.watched.get(browserId);
    if (!watched) return;
    this.watched.delete(browserId);
    watched.off();
    if (watched.ackTimer) clearTimeout(watched.ackTimer);
    watched.viewers.clear();
    this.idle(browserId);
  }

  private idle(browserId: string): void {
    try {
      this.options.onIdle?.(browserId);
    } catch (error) {
      this.onError(error);
    }
  }

  private begin(browserId: string): Promise<Watched | null> {
    const running = this.starting.get(browserId);
    if (running) return running;
    const start = (async () => {
      const source = await this.options.source(browserId);
      if (!source) return null;
      const watched: Watched = {
        browserId,
        source,
        off: () => {},
        viewers: new Map(),
        lastFrame: null,
        priming: false,
        sequence: 0,
        lastAckAt: Number.NEGATIVE_INFINITY,
        ackTimer: null,
      };
      watched.off = this.listen(watched);
      try {
        await source.send("Page.startScreencast", { ...SCREENCAST_PARAMS });
      } catch (error) {
        watched.off();
        throw error;
      }
      this.watched.set(browserId, watched);
      return watched;
    })().finally(() => this.starting.delete(browserId));
    this.starting.set(browserId, start);
    return start;
  }

  private listen(watched: Watched): () => void {
    return watched.source.on("Page.screencastFrame", (params) => {
      try {
        this.onFrame(watched, params);
      } catch (error) {
        this.onError(error);
      }
    });
  }

  private onFrame(watched: Watched, params: Record<string, unknown>): void {
    const metadata = (params.metadata ?? {}) as Record<string, unknown>;
    const size = this.frameSize(watched.browserId, {
      width: num(metadata.deviceWidth),
      height: num(metadata.deviceHeight),
    });
    const frame: ScreencastFrame = {
      sequence: ++watched.sequence,
      jpeg: Buffer.from(String(params.data ?? ""), "base64"),
      deviceWidth: size.width,
      deviceHeight: size.height,
      pageScaleFactor: num(metadata.pageScaleFactor, 1),
      scrollX: num(metadata.scrollOffsetX),
      scrollY: num(metadata.scrollOffsetY),
    };
    watched.lastFrame = frame;
    for (const slot of watched.viewers.values()) this.push(watched, slot, frame);
    this.ack(watched, params.sessionId);
    this.options.onFrame?.(watched.browserId, frame);
  }

  /** Chromium sends the next frame only after the ack, so delaying the ack caps the frame rate. */
  private ack(watched: Watched, sessionId: unknown): void {
    const send = () => {
      watched.ackTimer = null;
      watched.lastAckAt = Date.now();
      watched.source
        .send("Page.screencastFrameAck", { sessionId })
        .catch((error: unknown) => this.onError(error));
    };
    const wait = this.minFrameIntervalMs - (Date.now() - watched.lastAckAt);
    if (wait <= 0) {
      send();
      return;
    }
    // Only the newest frame is acked; an older pending ack would only repeat its session id.
    if (watched.ackTimer) clearTimeout(watched.ackTimer);
    watched.ackTimer = setTimeout(() => {
      try {
        send();
      } catch (error) {
        this.onError(error);
      }
    }, wait);
  }

  /** At most one send in flight per viewer; frames that arrive meanwhile replace each other. */
  private push(watched: Watched, slot: ViewerSlot, frame: ScreencastFrame): void {
    if (slot.sending) {
      slot.pending = frame;
      return;
    }
    slot.sending = true;
    void (async () => {
      let next: ScreencastFrame | null = frame;
      // A viewer that left stops here, even with a frame still pending.
      while (next && watched.viewers.get(slot.viewer.id) === slot) {
        try {
          await slot.viewer.deliver(next);
        } catch (error) {
          this.onError(error);
          this.leave(watched, slot);
          return;
        }
        next = slot.pending;
        slot.pending = null;
      }
      slot.sending = false;
    })();
  }

  /** Chromium sends a frame only on repaint, so a still page needs one screenshot to show anything. */
  private prime(watched: Watched): void {
    if (watched.priming) return;
    watched.priming = true;
    this.capture(watched, "prime")
      .catch((error: unknown) => this.onError(error))
      .finally(() => {
        watched.priming = false;
      });
  }

  private async capture(watched: Watched, purpose: "prime" | "refresh"): Promise<boolean> {
    const [shot, metrics] = await Promise.all([
      watched.source.send<{ data?: string }>("Page.captureScreenshot", {
        format: "jpeg",
        quality: SCREENCAST_PARAMS.quality,
      }),
      watched.source.send<{ cssVisualViewport?: Record<string, unknown> }>("Page.getLayoutMetrics"),
    ]);
    if (this.watched.get(watched.browserId) !== watched || !shot.data) return false;
    // A screencast frame that came while the priming screenshot was taken is newer than it.
    if (purpose === "prime" && watched.lastFrame) return false;
    const viewport = metrics.cssVisualViewport ?? {};
    const jpeg = Buffer.from(shot.data, "base64");
    const size = this.screenshotSize(watched.browserId, jpeg) ?? {
      width: num(viewport.clientWidth),
      height: num(viewport.clientHeight),
    };
    const frame: ScreencastFrame = {
      sequence: ++watched.sequence,
      jpeg,
      deviceWidth: size.width,
      deviceHeight: size.height,
      pageScaleFactor: num(viewport.scale, 1),
      scrollX: num(viewport.pageX),
      scrollY: num(viewport.pageY),
    };
    watched.lastFrame = frame;
    for (const slot of watched.viewers.values()) this.push(watched, slot, frame);
    if (purpose === "refresh") this.options.onFrame?.(watched.browserId, frame);
    return true;
  }

  /**
   * A screenshot's page size in CSS pixels: the JPEG's pixel size over the tab's scale factor. The
   * layout viewport's client size leaves out a scrollbar; screencast frames do not.
   */
  private screenshotSize(browserId: string, jpeg: Uint8Array): FrameSize | null {
    const pixels = jpegSize(jpeg);
    if (!pixels) return null;
    let scale = 1;
    try {
      scale = this.options.deviceScaleFactor?.(browserId) ?? 1;
    } catch (error) {
      this.onError(error);
    }
    return { width: Math.round(pixels.width / scale), height: Math.round(pixels.height / scale) };
  }

  /** Removes this slot only: a newer watch by the same viewer id keeps its own slot. */
  private leave(watched: Watched, slot: ViewerSlot): void {
    if (watched.viewers.get(slot.viewer.id) !== slot) return;
    watched.viewers.delete(slot.viewer.id);
    if (watched.viewers.size > 0) return;
    if (this.watched.get(watched.browserId) !== watched) return;
    this.watched.delete(watched.browserId);
    watched.off();
    if (watched.ackTimer) clearTimeout(watched.ackTimer);
    watched.source.send("Page.stopScreencast").catch((error: unknown) => this.onError(error));
    this.idle(watched.browserId);
  }
}
