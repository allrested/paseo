// A touch on the streamed 3D view, as the pointer steps the host replays. Pure: the view feeds it
// touches and sends what it returns.
import type { PointerStep } from "../../shared/contracts.js";
import { TAP_SLOP_PX } from "./camera.js";

/** A drag's moves go out this far apart: each one is a call to the host. */
export const MOVE_INTERVAL_MS = 100;

export interface StreamTouch {
  type: "start" | "move" | "end" | "cancel";
  /** Pixels from the view's top left. */
  x: number;
  y: number;
  /** Milliseconds, from any clock. */
  at: number;
}

export interface StreamGesture {
  /** Feed one touch; returns the steps to send now, possibly none. */
  touch(event: StreamTouch): PointerStep[];
  /** The move held back by the interval, once it is due. */
  flush(at: number): PointerStep[];
  /** Whether a move is held back: the view sets a timer for `flush`. */
  waiting(): boolean;
}

export function createStreamGesture(): StreamGesture {
  let start: { x: number; y: number } | null = null;
  let dragging = false;
  let held: { x: number; y: number } | null = null;
  let lastMoveAt = Number.NEGATIVE_INFINITY;

  function takeHeld(): PointerStep[] {
    if (held === null) return [];
    const step: PointerStep = { type: "move", ...held };
    held = null;
    return [step];
  }

  return {
    touch({ type, x, y, at }) {
      if (type === "start") {
        start = { x, y };
        dragging = false;
        held = null;
        lastMoveAt = Number.NEGATIVE_INFINITY;
        return [{ type: "down", x, y }];
      }
      if (start === null) return [];
      if (type === "move") {
        if (!dragging && Math.hypot(x - start.x, y - start.y) <= TAP_SLOP_PX) return [];
        dragging = true;
        if (at - lastMoveAt < MOVE_INTERVAL_MS) {
          held = { x, y };
          return [];
        }
        lastMoveAt = at;
        held = null;
        return [{ type: "move", x, y }];
      }
      const pressedAt = start;
      const wasDragging = dragging;
      start = null;
      dragging = false;
      if (type === "cancel") {
        held = null;
        return [{ type: "cancel", x, y }];
      }
      // A tap is released where it was pressed: a wobble of the finger must not read as a drag.
      return wasDragging ? [...takeHeld(), { type: "up", x, y }] : [{ type: "up", ...pressedAt }];
    },
    flush(at) {
      if (held === null || at - lastMoveAt < MOVE_INTERVAL_MS) return [];
      lastMoveAt = at;
      return takeHeld();
    },
    waiting: () => held !== null,
  };
}
