import type {
  CdpBrowserViewInput,
  CdpBrowserViewport,
} from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import type { Size } from "./view-model";

type MouseInput = Extract<CdpBrowserViewInput, { kind: "mouse" }>;
type KeyInput = Extract<CdpBrowserViewInput, { kind: "key" }>;
type MouseButton = MouseInput["button"];

/** The bit of each button in PointerEvent.buttons. */
const BUTTON_BITS: Record<MouseButton, number> = { none: 0, left: 1, right: 2, middle: 4 };

/** The daemon clamps a claimed size to these bounds (see CdpBrowserViewportSchema). */
const CLAIM_WIDTH = { min: 320, max: 1920 };
const CLAIM_HEIGHT = { min: 240, max: 1080 };
const SIZE_TOLERANCE_PX = 1;

/**
 * The frame on screen is not of the size the pane claims, so a press mapped on it would land on
 * the page laid out at the new size. Sizes are CSS pixels; the scale factor does not count. Before
 * the first frame or the first measure nothing is stale.
 */
export function isStaleFrame(frame: Size, claimed: CdpBrowserViewport | null): boolean {
  if (!claimed || frame.width <= 0 || frame.height <= 0) return false;
  const clamp = (value: number, bounds: { min: number; max: number }) =>
    Math.round(Math.min(bounds.max, Math.max(bounds.min, value)));
  return (
    Math.abs(frame.width - clamp(claimed.width, CLAIM_WIDTH)) > SIZE_TOLERANCE_PX ||
    Math.abs(frame.height - clamp(claimed.height, CLAIM_HEIGHT)) > SIZE_TOLERANCE_PX
  );
}

export interface PressTracker {
  /**
   * Records a mouse down or key down; false when it must not be sent. A mouse down on a stale frame
   * is dropped, with its drag and its release, even if a fresh frame arrives before the release.
   */
  press(input: CdpBrowserViewInput, stale?: boolean): boolean;
  /** A drag move may go: no button pressed on a stale frame is held. */
  dragAllowed(): boolean;
  /**
   * The PointerEvent `buttons` mask now held. A second button pressed or released while another
   * is held comes as a move, not a down or up, so a dropped press ends when its bit clears.
   */
  held(buttons: number): void;
  /** Keeps the position a held button is released at. */
  moved(x: number, y: number): void;
  /** The inputs to send for a mouse up or key up: nothing if it was never pressed. */
  release(input: CdpBrowserViewInput): CdpBrowserViewInput[];
  /** Releases everything still held, once. */
  releaseAll(): CdpBrowserViewInput[];
}

/**
 * Remembers which mouse buttons and keys the page was told are down, so each gets exactly one
 * matching up: the browser drops key ups on blur, and macOS drops the key up of a key pressed
 * while Cmd is held.
 */
export function createPressTracker(): PressTracker {
  const buttons = new Map<MouseButton, MouseInput>();
  const keys = new Map<string, KeyInput>();
  const dropped = new Set<MouseButton>();

  const keyUp = (down: KeyInput): KeyInput => ({
    kind: "key",
    type: "up",
    key: down.key,
    code: down.code,
    modifiers: 0,
  });
  const mouseUp = (down: MouseInput, at: { x: number; y: number }): MouseInput => ({
    ...down,
    ...at,
    type: "up",
    buttons: 0,
  });

  return {
    press(input, stale = false) {
      if (input.kind === "mouse" && input.type === "down") {
        if (stale) {
          dropped.add(input.button);
          return false;
        }
        dropped.delete(input.button);
        buttons.set(input.button, input);
      } else if (input.kind === "key" && input.type === "down") keys.set(input.code, input);
      return true;
    },
    dragAllowed: () => dropped.size === 0,
    held(mask) {
      for (const button of dropped) if ((mask & BUTTON_BITS[button]) === 0) dropped.delete(button);
    },
    moved(x, y) {
      for (const [button, down] of buttons) buttons.set(button, { ...down, x, y });
    },
    release(input) {
      if (input.kind === "mouse" && input.type === "up") {
        dropped.delete(input.button);
        const down = buttons.get(input.button);
        if (!down) return [];
        buttons.delete(input.button);
        return [{ ...input, clickCount: down.clickCount }];
      }
      if (input.kind === "key" && input.type === "up") {
        const down = keys.get(input.code);
        if (!down) return [];
        keys.delete(input.code);
        if (input.key !== "Meta") return [input];
        const others = [...keys.values()].map(keyUp);
        keys.clear();
        return [...others, input];
      }
      return [];
    },
    releaseAll() {
      const released = [
        ...[...buttons.values()].map((down) => mouseUp(down, down)),
        ...[...keys.values()].map(keyUp),
      ];
      buttons.clear();
      keys.clear();
      dropped.clear();
      return released;
    },
  };
}

const CLICK_WINDOW_MS = 500;
const CLICK_SLOP_PX = 5;

export interface ClickCounter {
  /** The click count for a press: 2 and up for a repeat on the same button, in time and place. */
  press(button: MouseButton, x: number, y: number): number;
  /** A press dropped on a stale frame: it does not count, and the next press starts at 1. */
  drop(): void;
}

/** PointerEvent.detail is 0 on pointerdown and pointerup, so the layer counts clicks itself. */
export function createClickCounter(now: () => number = Date.now): ClickCounter {
  let previous: { button: MouseButton; x: number; y: number; time: number; count: number } | null =
    null;
  return {
    press(button, x, y) {
      const time = now();
      const repeat =
        previous !== null &&
        previous.button === button &&
        time - previous.time <= CLICK_WINDOW_MS &&
        Math.hypot(x - previous.x, y - previous.y) <= CLICK_SLOP_PX;
      const count = repeat && previous ? previous.count + 1 : 1;
      previous = { button, x, y, time, count };
      return count;
    },
    drop() {
      previous = null;
    },
  };
}
