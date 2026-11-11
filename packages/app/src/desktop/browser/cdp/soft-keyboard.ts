import type { CdpBrowserViewInput } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";

/** The events of the hidden field that raises a touch browser's on-screen keyboard. */
export type SoftKeyboardEvent =
  | { type: "keydown"; key: string; isComposing: boolean }
  | { type: "beforeinput"; inputType: string; data: string | null; isComposing: boolean }
  | { type: "compositionend"; data: string }
  | { type: "paste"; text: string };

export interface SoftKeyboardStep {
  /** Inputs for the page, in order. */
  inputs: CdpBrowserViewInput[];
  /** Cancel the browser default: the field stays empty, and a cancelled keydown raises no input event. */
  cancel: boolean;
}

const PASS: SoftKeyboardStep = { inputs: [], cancel: false };
const DROP: SoftKeyboardStep = { inputs: [], cancel: true };

function pressKey(key: "Enter" | "Backspace"): SoftKeyboardStep {
  return {
    inputs: [
      { kind: "key", type: "down", key, code: key, modifiers: 0 },
      { kind: "key", type: "up", key, code: key, modifiers: 0 },
    ],
    cancel: true,
  };
}

function insertText(text: string | null): SoftKeyboardStep {
  return text ? { inputs: [{ kind: "text", text }], cancel: true } : DROP;
}

const KEY_FOR_INPUT_TYPE: Record<string, "Enter" | "Backspace"> = {
  deleteContentBackward: "Backspace",
  insertLineBreak: "Enter",
  insertParagraph: "Enter",
};

// Safari reports a composition commit through these before compositionend; compositionend sends it.
const COMPOSITION_INPUT_TYPES = new Set([
  "insertCompositionText",
  "insertFromComposition",
  "deleteCompositionText",
]);

function beforeInputStep(inputType: string, data: string | null): SoftKeyboardStep {
  if (inputType === "insertText") return insertText(data);
  const key = KEY_FOR_INPUT_TYPE[inputType];
  if (key) return pressKey(key);
  if (COMPOSITION_INPUT_TYPES.has(inputType)) return PASS;
  // Paste arrives through the paste event; replacements, drops and word deletes have no exact page input.
  return DROP;
}

/**
 * Maps one event of the hidden field to page inputs. Text is sent once: typed text from
 * insertText, composed text at compositionend, pasted text from the paste event. Backspace and
 * Enter go as key presses, from a keydown when the keyboard reports the key (a hardware keyboard,
 * iOS) or from the input event when it does not (Android reports key 229 or "Unidentified").
 * Cancelling the keydown stops the browser from raising the input event as well.
 */
export function softKeyboardStep(event: SoftKeyboardEvent): SoftKeyboardStep {
  switch (event.type) {
    case "keydown":
      if (event.isComposing) return PASS;
      return event.key === "Enter" || event.key === "Backspace" ? pressKey(event.key) : PASS;
    case "beforeinput":
      return event.isComposing ? PASS : beforeInputStep(event.inputType, event.data);
    case "compositionend":
      return event.data ? { inputs: [{ kind: "text", text: event.data }], cancel: false } : PASS;
    case "paste":
      return insertText(event.text);
  }
}
