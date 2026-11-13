// A touch on the device picture, as the tap or swipe the device receives. Pure: the view feeds it
// touches and maps what it returns from view pixels to device pixels.
import type { Point } from "../shared/contracts.js";

/** A press and release within this many view pixels is a tap. */
export const TAP_SLOP_PX = 8;
export const MIN_SWIPE_MS = 50;
export const MAX_SWIPE_MS = 3000;

export interface StreamTouch {
  type: "start" | "move" | "end" | "cancel";
  /** Pixels from the view's top left. */
  x: number;
  y: number;
  /** Milliseconds, from any clock. */
  at: number;
}

export type GestureAction =
  | { type: "tap"; at: Point }
  | { type: "swipe"; from: Point; to: Point; durationMs: number };

export interface StreamGesture {
  /** Feed one touch; returns the action once the finger lifts. */
  touch(event: StreamTouch): GestureAction | null;
}

export function createStreamGesture(): StreamGesture {
  let start: { x: number; y: number; at: number } | null = null;
  return {
    touch({ type, x, y, at }) {
      if (type === "start") {
        start = { x, y, at };
        return null;
      }
      if (start === null || type === "move") return null;
      const pressed = start;
      start = null;
      if (type === "cancel") return null;
      if (Math.hypot(x - pressed.x, y - pressed.y) <= TAP_SLOP_PX) {
        // A wobble of the finger is still a tap at the press point.
        return { type: "tap", at: { x: pressed.x, y: pressed.y } };
      }
      const durationMs = Math.min(
        MAX_SWIPE_MS,
        Math.max(MIN_SWIPE_MS, Math.round(at - pressed.at)),
      );
      return { type: "swipe", from: { x: pressed.x, y: pressed.y }, to: { x, y }, durationMs };
    },
  };
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  left: number;
  top: number;
}

/** Where `resizeMode="contain"` draws a picture of the device's shape in a view. */
export function letterbox(view: Size, device: Size): Rect {
  const scale = Math.min(view.width / device.width, view.height / device.height);
  const width = device.width * scale;
  const height = device.height * scale;
  return { left: (view.width - width) / 2, top: (view.height - height) / 2, width, height };
}

/** The device pixel under a view pixel, or null outside the picture. */
export function toDevice(rect: Rect, device: Size, point: Point): Point | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const inside =
    point.x >= rect.left &&
    point.x <= rect.left + rect.width &&
    point.y >= rect.top &&
    point.y <= rect.top + rect.height;
  if (!inside) return null;
  return clampToDevice(rect, device, point);
}

function clampToDevice(rect: Rect, device: Size, point: Point): Point {
  const x = ((point.x - rect.left) / rect.width) * device.width;
  const y = ((point.y - rect.top) / rect.height) * device.height;
  return {
    x: Math.min(device.width - 1, Math.max(0, Math.round(x))),
    y: Math.min(device.height - 1, Math.max(0, Math.round(y))),
  };
}

/**
 * The device's own input for a gesture, in whole device pixels. A press outside the picture is
 * ignored; a release outside it lands on the picture's edge, so a swipe off the screen still
 * reaches the device.
 */
export function gestureToDevice(
  action: GestureAction,
  view: Size,
  device: Size,
): { tap: Point } | { swipe: { from: Point; to: Point; durationMs: number } } | null {
  const rect = letterbox(view, device);
  if (action.type === "tap") {
    const at = toDevice(rect, device, action.at);
    return at === null ? null : { tap: at };
  }
  const from = toDevice(rect, device, action.from);
  if (from === null) return null;
  const to = clampToDevice(rect, device, action.to);
  return { swipe: { from, to, durationMs: action.durationMs } };
}
