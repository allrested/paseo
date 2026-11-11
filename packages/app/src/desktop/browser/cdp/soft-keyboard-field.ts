import type { CdpBrowserViewInput } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import { createSoftKeyboard, type SoftKeyboardEvent } from "./soft-keyboard";

// DOM code: only input-layer.web.tsx imports it.

export interface SoftKeyboardWiring {
  field: HTMLTextAreaElement;
  /** The layer over the frame. */
  frame: HTMLElement;
  send(input: CdpBrowserViewInput): void;
  isOn(): boolean;
  /** The field got focus, from the keyboard button or from the browser giving it back. */
  turnOn(): void;
  /** The field lost focus to something other than the frame. */
  turnOff(): void;
}

/**
 * Wires the hidden field that raises a touch browser's on-screen keyboard. Its events reach it
 * only while it has focus, and it is a sibling of the layer, so the layer's key and paste
 * listeners never see the same keystroke. The field is emptied after every committed piece.
 * While the keyboard is on, focus that lands on the frame goes straight back to the field, inside
 * the same tap, so the keyboard stays up. The on state follows the field's focus, so the
 * keyboard button shows what typing does: a window that loses and regains focus gives focus back
 * to the field, and the keyboard is on again.
 */
export function attachSoftKeyboardField({
  field,
  frame,
  send,
  isOn,
  turnOn,
  turnOff,
}: SoftKeyboardWiring): {
  detach(): void;
  endComposition(): void;
} {
  const keyboard = createSoftKeyboard();
  const apply = (event: Event, mapped: SoftKeyboardEvent) => {
    const step = keyboard.step(mapped);
    if (step.cancel) event.preventDefault();
    for (const input of step.inputs) send(input);
  };
  const clear = () => {
    if (field.value) field.value = "";
  };
  const onKeyDown = (event: KeyboardEvent) =>
    apply(event, {
      type: "keydown",
      key: event.key,
      keyCode: event.keyCode,
      isComposing: event.isComposing,
    });
  const onBeforeInput = (event: InputEvent) =>
    apply(event, {
      type: "beforeinput",
      inputType: event.inputType,
      data: event.data,
      isComposing: event.isComposing,
    });
  // Clearing during a composition would break the keyboard's word in progress.
  const onInputEvent = (event: Event) => {
    if (!(event as InputEvent).isComposing) clear();
  };
  const onCompositionStart = (event: CompositionEvent) =>
    apply(event, { type: "compositionstart" });
  const onCompositionUpdate = (event: CompositionEvent) =>
    apply(event, { type: "compositionupdate", data: event.data });
  const onCompositionEnd = (event: CompositionEvent) => {
    apply(event, { type: "compositionend", data: event.data });
    clear();
  };
  // The text comes from the paste the user made; the clipboard is never read otherwise.
  const onPaste = (event: ClipboardEvent) =>
    apply(event, { type: "paste", text: event.clipboardData?.getData("text/plain") ?? "" });
  // The page caret moved or the keyboard goes off: an open composition must not edit the page any
  // more. Emptying the field makes the keyboard start a new word.
  const endComposition = () => {
    keyboard.reset();
    clear();
  };
  // The URL field, another control or the keyboard's own hide key take focus: the keyboard is off.
  const onFieldBlur = (event: FocusEvent) => {
    if (event.relatedTarget === frame || !isOn()) return;
    endComposition();
    turnOff();
  };
  const onFieldFocus = () => {
    if (!isOn()) turnOn();
  };
  // A browser that still moved focus to the frame on a tap gets it moved back before the tap ends.
  const onFrameFocus = () => {
    if (isOn()) field.focus({ preventScroll: true });
  };

  field.addEventListener("keydown", onKeyDown);
  field.addEventListener("beforeinput", onBeforeInput);
  field.addEventListener("input", onInputEvent);
  field.addEventListener("compositionstart", onCompositionStart);
  field.addEventListener("compositionupdate", onCompositionUpdate);
  field.addEventListener("compositionend", onCompositionEnd);
  field.addEventListener("paste", onPaste);
  field.addEventListener("focus", onFieldFocus);
  field.addEventListener("blur", onFieldBlur);
  frame.addEventListener("focus", onFrameFocus);
  return {
    detach() {
      field.removeEventListener("keydown", onKeyDown);
      field.removeEventListener("beforeinput", onBeforeInput);
      field.removeEventListener("input", onInputEvent);
      field.removeEventListener("compositionstart", onCompositionStart);
      field.removeEventListener("compositionupdate", onCompositionUpdate);
      field.removeEventListener("compositionend", onCompositionEnd);
      field.removeEventListener("paste", onPaste);
      field.removeEventListener("focus", onFieldFocus);
      field.removeEventListener("blur", onFieldBlur);
      frame.removeEventListener("focus", onFrameFocus);
    },
    endComposition,
  };
}
