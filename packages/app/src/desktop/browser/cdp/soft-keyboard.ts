import type { CdpBrowserViewInput } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";

/** The events of the hidden field that raises a touch browser's on-screen keyboard. */
export type SoftKeyboardEvent =
  | { type: "keydown"; key: string; isComposing: boolean }
  | { type: "beforeinput"; inputType: string; data: string | null; isComposing: boolean }
  | { type: "compositionstart" }
  | { type: "compositionupdate"; data: string }
  | { type: "compositionend"; data: string }
  | { type: "paste"; text: string };

export interface SoftKeyboardStep {
  /** Inputs for the page, in order. */
  inputs: CdpBrowserViewInput[];
  /** Cancel the browser default: the field stays empty, and a cancelled keydown raises no input event. */
  cancel: boolean;
}

export interface SoftKeyboard {
  step(event: SoftKeyboardEvent): SoftKeyboardStep;
}

const PASS: SoftKeyboardStep = { inputs: [], cancel: false };
const DROP: SoftKeyboardStep = { inputs: [], cancel: true };

function keyPress(key: "Enter" | "Backspace"): CdpBrowserViewInput[] {
  return [
    { kind: "key", type: "down", key, code: key, modifiers: 0 },
    { kind: "key", type: "up", key, code: key, modifiers: 0 },
  ];
}

function pressKey(key: "Enter" | "Backspace"): SoftKeyboardStep {
  return { inputs: keyPress(key), cancel: true };
}

function insertText(text: string | null): SoftKeyboardStep {
  return text ? { inputs: [{ kind: "text", text }], cancel: true } : DROP;
}

/**
 * The page inputs that turn the already sent composition into the new one: Backspace back to the
 * common prefix, then the new tail. Counted in code points, so an astral character is one press.
 */
function compositionDiff(sent: string, next: string): CdpBrowserViewInput[] {
  const before = [...sent];
  const after = [...next];
  let common = 0;
  while (common < before.length && common < after.length && before[common] === after[common]) {
    common += 1;
  }
  const inputs: CdpBrowserViewInput[] = [];
  for (let index = common; index < before.length; index += 1) inputs.push(...keyPress("Backspace"));
  const tail = after.slice(common).join("");
  if (tail) inputs.push({ kind: "text", text: tail });
  return inputs;
}

const KEY_FOR_INPUT_TYPE: Record<string, "Enter" | "Backspace"> = {
  deleteContentBackward: "Backspace",
  insertLineBreak: "Enter",
  insertParagraph: "Enter",
};

// The composition events send the text; Safari also reports a commit through these input types.
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
 * Maps the hidden field's events to page inputs. Typed text comes from insertText, pasted text
 * from the paste event. A composition (Android keyboards compose every word) is sent live: each
 * update sends only its difference from what was already sent, and the end sends what still
 * differs, so a cancelled composition takes back what it inserted. Backspace and Enter go as key
 * presses, from a keydown when the keyboard reports the key (a hardware keyboard, iOS) or from
 * the input event when it does not (Android reports key 229 or "Unidentified"). Cancelling the
 * keydown stops the browser from raising the input event as well.
 */
export function createSoftKeyboard(): SoftKeyboard {
  let composed = "";
  const compose = (next: string): SoftKeyboardStep => {
    const inputs = compositionDiff(composed, next);
    composed = next;
    return { inputs, cancel: false };
  };
  return {
    step(event) {
      switch (event.type) {
        case "keydown":
          if (event.isComposing) return PASS;
          return event.key === "Enter" || event.key === "Backspace" ? pressKey(event.key) : PASS;
        case "beforeinput":
          return event.isComposing ? PASS : beforeInputStep(event.inputType, event.data);
        case "compositionstart":
          composed = "";
          return PASS;
        case "compositionupdate":
          return compose(event.data);
        case "compositionend": {
          const step = compose(event.data);
          composed = "";
          return step;
        }
        case "paste":
          return insertText(event.text);
      }
    },
  };
}
