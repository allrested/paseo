import type { CdpBrowserViewInput } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import { keyDefinition } from "./cdp-keys.js";

const MOUSE_TYPES = { move: "mouseMoved", down: "mousePressed", up: "mouseReleased" } as const;

/** Turns one pane input into the CDP Input command that replays it on the page. */
export async function dispatchViewInput(
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  input: CdpBrowserViewInput,
): Promise<void> {
  switch (input.kind) {
    case "mouse":
      await send("Input.dispatchMouseEvent", {
        type: MOUSE_TYPES[input.type],
        x: input.x,
        y: input.y,
        button: input.button,
        buttons: input.buttons,
        clickCount: input.clickCount,
        modifiers: input.modifiers,
      });
      return;
    case "wheel":
      await send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: input.x,
        y: input.y,
        deltaX: input.deltaX,
        deltaY: input.deltaY,
        modifiers: input.modifiers,
      });
      return;
    case "key": {
      const definition = keyDefinition(input.key);
      const base = { key: input.key, code: input.code, windowsVirtualKeyCode: definition.vk };
      if (input.type === "up") {
        await send("Input.dispatchKeyEvent", {
          type: "keyUp",
          ...base,
          modifiers: input.modifiers,
        });
        return;
      }
      // Enter has no text from a client's key event, but the page needs "\r" to submit a form.
      const text = input.text ?? definition.text;
      await send("Input.dispatchKeyEvent", {
        type: text ? "keyDown" : "rawKeyDown",
        ...base,
        ...(text ? { text } : {}),
        modifiers: input.modifiers,
      });
      return;
    }
    case "text":
      await send("Input.insertText", { text: input.text });
      return;
  }
}
