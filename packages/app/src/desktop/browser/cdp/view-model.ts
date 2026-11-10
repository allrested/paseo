import type { CdpBrowserViewport } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";

export interface Size {
  width: number;
  height: number;
}
export interface FrameRect extends Size {
  left: number;
  top: number;
}

export type CdpViewStatus = "connecting" | "live" | "closed" | "unreachable" | "unresponsive";

export const HOVER_INTERVAL_MS = 33;
export const TOUCH_SLOP_PX = 8;
const MAX_DEVICE_SCALE_FACTOR = 2;

/** Where the frame is drawn in the pane: scaled to fit, centred. */
export function fitFrame(container: Size, frame: Size): FrameRect {
  if (container.width <= 0 || container.height <= 0 || frame.width <= 0 || frame.height <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const scale = Math.min(container.width / frame.width, container.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  return {
    left: (container.width - width) / 2,
    top: (container.height - height) / 2,
    width,
    height,
  };
}

/** A point on the displayed frame, in page CSS pixels. */
export function toPagePoint(
  local: { x: number; y: number },
  displayed: Size,
  page: Size,
): { x: number; y: number } {
  if (displayed.width <= 0 || displayed.height <= 0) return { x: 0, y: 0 };
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
  return {
    x: clamp((local.x * page.width) / displayed.width, page.width),
    y: clamp((local.y * page.height) / displayed.height, page.height),
  };
}

export function viewportForPane(
  container: Size,
  devicePixelRatio: number,
): CdpBrowserViewport | null {
  if (container.width < 1 || container.height < 1) return null;
  return {
    width: Math.round(container.width),
    height: Math.round(container.height),
    deviceScaleFactor: Math.min(MAX_DEVICE_SCALE_FACTOR, Math.max(1, devicePixelRatio)),
  };
}

export function modifierMask(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (
    (event.altKey ? 1 : 0) |
    (event.ctrlKey ? 2 : 0) |
    (event.metaKey ? 4 : 0) |
    (event.shiftKey ? 8 : 0)
  );
}

export function mouseButton(button: number): "left" | "middle" | "right" {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
}

export function keyText(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}): string | undefined {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey ? event.key : undefined;
}

export function createThrottle(intervalMs: number, now: () => number = Date.now): () => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const current = now();
    if (current - last < intervalMs) return false;
    last = current;
    return true;
  };
}

export function viewStatusForError(code: string): CdpViewStatus {
  if (code.includes("browser_tab_not_found")) return "closed";
  if (code.includes("browser_no_host") || code.includes("browser_unsupported"))
    return "unreachable";
  return "unresponsive";
}
