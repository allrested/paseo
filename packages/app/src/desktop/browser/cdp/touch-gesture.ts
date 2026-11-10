import type { CdpBrowserViewInput } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import { TOUCH_SLOP_PX } from "./view-model";

interface Point {
  x: number;
  y: number;
}

export interface TouchGesture {
  start(point: Point): void;
  move(point: Point): CdpBrowserViewInput[];
  end(): CdpBrowserViewInput[];
  /** Drops the touch without a click, for a system-cancelled gesture. */
  cancel(): void;
}

/** Touch on the frame: a tap is a click, a drag is a scroll. Points are page CSS pixels. No pinch zoom. */
export function createTouchGesture(): TouchGesture {
  let origin: Point | null = null;
  let last: Point | null = null;
  let scrolling = false;
  return {
    start(point) {
      origin = point;
      last = point;
      scrolling = false;
    },
    move(point) {
      if (!origin || !last) return [];
      if (!scrolling && Math.hypot(point.x - origin.x, point.y - origin.y) < TOUCH_SLOP_PX)
        return [];
      scrolling = true;
      // The page follows the finger: dragging up scrolls down.
      const wheel: CdpBrowserViewInput = {
        kind: "wheel",
        x: origin.x,
        y: origin.y,
        deltaX: last.x - point.x,
        deltaY: last.y - point.y,
        modifiers: 0,
      };
      last = point;
      return [wheel];
    },
    end() {
      const point = origin;
      const tapped = point !== null && !scrolling;
      origin = null;
      last = null;
      scrolling = false;
      if (!tapped || !point) return [];
      const base = { kind: "mouse" as const, x: point.x, y: point.y, modifiers: 0 };
      return [
        { ...base, type: "move", button: "none", buttons: 0, clickCount: 0 },
        { ...base, type: "down", button: "left", buttons: 1, clickCount: 1 },
        { ...base, type: "up", button: "left", buttons: 0, clickCount: 1 },
      ];
    },
    cancel() {
      origin = null;
      last = null;
      scrolling = false;
    },
  };
}

export interface InputCoalescer {
  push(input: CdpBrowserViewInput): void;
  flush(): void;
  dispose(): void;
}

/**
 * Sends at most one pointer move and one wheel event per animation frame: the latest move wins,
 * wheel deltas add up. Any other input first flushes what is pending, so order is kept.
 */
export function createInputCoalescer(
  send: (input: CdpBrowserViewInput) => void,
  schedule: (callback: () => void) => number = requestAnimationFrame,
  cancel: (handle: number) => void = cancelAnimationFrame,
): InputCoalescer {
  let move: Extract<CdpBrowserViewInput, { kind: "mouse" }> | null = null;
  let wheel: Extract<CdpBrowserViewInput, { kind: "wheel" }> | null = null;
  let handle: number | null = null;

  const flush = () => {
    if (handle !== null) {
      cancel(handle);
      handle = null;
    }
    const pendingMove = move;
    const pendingWheel = wheel;
    move = null;
    wheel = null;
    if (pendingMove) send(pendingMove);
    if (pendingWheel) send(pendingWheel);
  };

  return {
    push(input) {
      if (input.kind === "mouse" && input.type === "move") {
        move = input;
      } else if (input.kind === "wheel") {
        wheel = wheel
          ? { ...input, deltaX: wheel.deltaX + input.deltaX, deltaY: wheel.deltaY + input.deltaY }
          : input;
      } else {
        flush();
        send(input);
        return;
      }
      if (handle === null) {
        handle = schedule(() => {
          handle = null;
          flush();
        });
      }
    },
    flush,
    dispose() {
      if (handle !== null) cancel(handle);
      handle = null;
      move = null;
      wheel = null;
    },
  };
}
