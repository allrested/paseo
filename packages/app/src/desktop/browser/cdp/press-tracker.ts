import type { CdpBrowserViewInput } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";

type MouseInput = Extract<CdpBrowserViewInput, { kind: "mouse" }>;
type KeyInput = Extract<CdpBrowserViewInput, { kind: "key" }>;
type MouseButton = MouseInput["button"];

export interface PressTracker {
  /** Records a mouse down or key down that was sent to the page. */
  press(input: CdpBrowserViewInput): void;
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
    press(input) {
      if (input.kind === "mouse" && input.type === "down") buttons.set(input.button, input);
      else if (input.kind === "key" && input.type === "down") keys.set(input.code, input);
    },
    moved(x, y) {
      for (const [button, down] of buttons) buttons.set(button, { ...down, x, y });
    },
    release(input) {
      if (input.kind === "mouse" && input.type === "up") {
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
      return released;
    },
  };
}

const CLICK_WINDOW_MS = 500;
const CLICK_SLOP_PX = 5;

export interface ClickCounter {
  /** The click count for a press: 2 and up for a repeat on the same button, in time and place. */
  press(button: MouseButton, x: number, y: number): number;
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
  };
}
