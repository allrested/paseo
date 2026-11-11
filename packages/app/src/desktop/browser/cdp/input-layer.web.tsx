import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { CdpBrowserViewInput } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import type { CdpInputLayerProps } from "./input-layer-types";
import { createClickCounter, createPressTracker } from "./press-tracker";
import { softKeyboardStep, type SoftKeyboardEvent } from "./soft-keyboard";
import { createInputCoalescer, createTouchGesture } from "./touch-gesture";
import {
  createThrottle,
  HOVER_INTERVAL_MS,
  keyText,
  modifierMask,
  mouseButton,
  toPagePoint,
} from "./view-model";

const WHEEL_LINE_PX = 16;

/** Pixels per wheel delta unit: pixels, lines, or pages of the displayed frame. */
function wheelUnit(deltaMode: number, frameHeight: number): number {
  if (deltaMode === 1) return WHEEL_LINE_PX;
  return deltaMode === 2 ? frameHeight : 1;
}

function isPasteChord(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v";
}

/**
 * Wires the hidden field that raises a touch browser's on-screen keyboard. Its events reach it
 * only while it has focus, and it is a sibling of the layer, so the layer's key and paste
 * listeners never see the same keystroke. The field is emptied after every committed piece.
 */
function attachSoftKeyboardField(
  field: HTMLTextAreaElement,
  send: (input: CdpBrowserViewInput) => void,
): () => void {
  const apply = (event: Event, mapped: SoftKeyboardEvent) => {
    const step = softKeyboardStep(mapped);
    if (step.cancel) event.preventDefault();
    for (const input of step.inputs) send(input);
  };
  const clear = () => {
    if (field.value) field.value = "";
  };
  const onKeyDown = (event: KeyboardEvent) =>
    apply(event, { type: "keydown", key: event.key, isComposing: event.isComposing });
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
  const onCompositionEnd = (event: CompositionEvent) => {
    apply(event, { type: "compositionend", data: event.data });
    clear();
  };
  // The text comes from the paste the user made; the clipboard is never read otherwise.
  const onPaste = (event: ClipboardEvent) =>
    apply(event, { type: "paste", text: event.clipboardData?.getData("text/plain") ?? "" });

  field.addEventListener("keydown", onKeyDown);
  field.addEventListener("beforeinput", onBeforeInput);
  field.addEventListener("input", onInputEvent);
  field.addEventListener("compositionend", onCompositionEnd);
  field.addEventListener("paste", onPaste);
  return () => {
    field.removeEventListener("keydown", onKeyDown);
    field.removeEventListener("beforeinput", onBeforeInput);
    field.removeEventListener("input", onInputEvent);
    field.removeEventListener("compositionend", onCompositionEnd);
    field.removeEventListener("paste", onPaste);
  };
}

/**
 * A focusable element over the frame. Keys reach the page only while this element itself has
 * focus, so the URL field and every other app input keep their own keys. Ctrl/Cmd+L moves focus
 * to the URL field. Paste goes through the browser paste event, so the clipboard text is sent
 * only when the user pastes; it is never read at any other time.
 *
 * On a touch screen the toolbar's keyboard button focuses a hidden field next to the layer, which
 * raises the on-screen keyboard. The keyboard stays up until the field loses focus: a tap on the
 * frame (which focuses the layer and clicks), the URL field, any other app control, or the
 * keyboard's own dismiss key. Pressing the button again raises it again.
 */
export function CdpInputLayer({
  rect,
  page,
  onInput,
  onFocusUrl,
  onFocusPane,
  keyboardRequest,
}: CdpInputLayerProps) {
  const { t } = useTranslation();
  const element = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  // Handlers read the latest props without re-attaching DOM listeners on every frame.
  const latest = useRef({ rect, page, onInput, onFocusUrl, onFocusPane });
  latest.current = { rect, page, onInput, onFocusUrl, onFocusPane };

  // A layer mounted after a request (the frame came back) does not raise the keyboard by itself.
  const handledRequest = useRef(keyboardRequest);
  // A layout effect runs inside the button's event, which iOS Safari needs to show the keyboard.
  useLayoutEffect(() => {
    const target = field.current;
    if (keyboardRequest === handledRequest.current || !target) return;
    handledRequest.current = keyboardRequest;
    // Android keeps a field focused after its keyboard is dismissed; focus() alone does not raise it again.
    if (document.activeElement === target) target.blur();
    target.focus({ preventScroll: true });
  }, [keyboardRequest]);

  useEffect(() => {
    const node = element.current;
    const softKeyboard = field.current;
    if (!node || !softKeyboard) return;
    const allowHover = createThrottle(HOVER_INTERVAL_MS);
    const touch = createTouchGesture();
    let touchId: number | null = null;
    const coalescer = createInputCoalescer((input) => latest.current.onInput(input));
    const tracker = createPressTracker();
    const clicks = createClickCounter();
    const send = (input: CdpBrowserViewInput) => coalescer.push(input);
    // Mouse and key presses go through the tracker, so each down gets exactly one up.
    const sendPress = (input: CdpBrowserViewInput) => {
      tracker.press(input);
      send(input);
    };
    const sendRelease = (input: CdpBrowserViewInput) => {
      for (const released of tracker.release(input)) send(released);
    };
    const releaseAll = () => {
      for (const released of tracker.releaseAll()) send(released);
    };
    const point = (event: { clientX: number; clientY: number }) => {
      const bounds = node.getBoundingClientRect();
      const { rect: displayed, page: pageSize } = latest.current;
      return toPagePoint(
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        { width: displayed.width, height: displayed.height },
        pageSize,
      );
    };
    const sendAll = (inputs: CdpBrowserViewInput[]) => {
      for (const input of inputs) send(input);
    };
    const endTouch = () => {
      touchId = null;
      sendAll(touch.end());
    };

    const onPointerDown = (event: PointerEvent) => {
      node.focus({ preventScroll: true });
      latest.current.onFocusPane?.();
      if (event.pointerType === "touch") {
        if (touchId !== null) return;
        touchId = event.pointerId;
        touch.start(point(event));
        return;
      }
      node.setPointerCapture(event.pointerId);
      const button = mouseButton(event.button);
      sendPress({
        kind: "mouse",
        type: "down",
        ...point(event),
        button,
        buttons: event.buttons,
        clickCount: clicks.press(button, event.clientX, event.clientY),
        modifiers: modifierMask(event),
      });
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        if (event.pointerId === touchId) sendAll(touch.move(point(event)));
        return;
      }
      // A drag sends every move (coalesced per frame); a hover is capped at about 30 per second.
      if (event.buttons === 0 && !allowHover()) return;
      const moved = point(event);
      tracker.moved(moved.x, moved.y);
      send({
        kind: "mouse",
        type: "move",
        ...moved,
        button: event.buttons === 0 ? "none" : mouseButton(event.button === -1 ? 0 : event.button),
        buttons: event.buttons,
        clickCount: 0,
        modifiers: modifierMask(event),
      });
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        if (event.pointerId === touchId) endTouch();
        return;
      }
      // The click count of the matching down replaces the placeholder here.
      sendRelease({
        kind: "mouse",
        type: "up",
        ...point(event),
        button: mouseButton(event.button),
        buttons: event.buttons,
        clickCount: 1,
        modifiers: modifierMask(event),
      });
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerType !== "touch") {
        releaseAll();
      } else if (event.pointerId === touchId) {
        touchId = null;
        touch.cancel();
      }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = wheelUnit(event.deltaMode, latest.current.rect.height);
      send({
        kind: "wheel",
        ...point(event),
        deltaX: event.deltaX * unit,
        deltaY: event.deltaY * unit,
        modifiers: modifierMask(event),
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.activeElement !== node) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        latest.current.onFocusUrl();
        return;
      }
      // Let the browser raise its paste event; onPaste sends the text.
      if (isPasteChord(event)) return;
      event.preventDefault();
      const text = keyText(event);
      sendPress({
        kind: "key",
        type: "down",
        key: event.key,
        code: event.code,
        ...(text ? { text } : {}),
        modifiers: modifierMask(event),
      });
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (document.activeElement !== node) return;
      event.preventDefault();
      sendRelease({
        kind: "key",
        type: "up",
        key: event.key,
        code: event.code,
        modifiers: modifierMask(event),
      });
    };
    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      const text = event.clipboardData?.getData("text/plain");
      if (text) send({ kind: "text", text });
    };
    const onContextMenu = (event: Event) => event.preventDefault();

    node.addEventListener("pointerdown", onPointerDown);
    node.addEventListener("pointermove", onPointerMove);
    node.addEventListener("pointerup", onPointerUp);
    node.addEventListener("pointercancel", onPointerCancel);
    // React's wheel listener is passive, so it cannot stop the workspace from scrolling.
    node.addEventListener("wheel", onWheel, { passive: false });
    node.addEventListener("keydown", onKeyDown);
    node.addEventListener("keyup", onKeyUp);
    node.addEventListener("paste", onPaste);
    node.addEventListener("blur", releaseAll);
    window.addEventListener("blur", releaseAll);
    node.addEventListener("contextmenu", onContextMenu);
    const detachSoftKeyboard = attachSoftKeyboardField(softKeyboard, send);
    return () => {
      detachSoftKeyboard();
      releaseAll();
      coalescer.dispose();
      window.removeEventListener("blur", releaseAll);
      node.removeEventListener("blur", releaseAll);
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", onPointerUp);
      node.removeEventListener("pointercancel", onPointerCancel);
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("keydown", onKeyDown);
      node.removeEventListener("keyup", onKeyUp);
      node.removeEventListener("paste", onPaste);
      node.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  const style = useMemo<CSSProperties>(
    () => ({
      position: "absolute",
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      outline: "none",
      // The layer scrolls the remote page, not this document.
      touchAction: "none",
      cursor: "default",
    }),
    [rect.left, rect.top, rect.width, rect.height],
  );
  const fieldStyle = useMemo<CSSProperties>(
    () => ({ ...HIDDEN_FIELD_STYLE, left: rect.left, top: rect.top }),
    [rect.left, rect.top],
  );
  return (
    <>
      <div ref={element} style={style} tabIndex={0} />
      <textarea
        ref={field}
        aria-label={t("cdpBrowser.keyboard")}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        rows={1}
        spellCheck={false}
        style={fieldStyle}
        tabIndex={-1}
      />
    </>
  );
}

// Invisible but focusable. 16px text stops iOS Safari from zooming in on focus. It sits at the
// frame's top-left corner, so a browser that scrolls it into view keeps the frame's top visible.
const HIDDEN_FIELD_STYLE: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: 0,
  border: 0,
  opacity: 0,
  fontSize: 16,
  color: "transparent",
  caretColor: "transparent",
  background: "transparent",
  resize: "none",
  overflow: "hidden",
  pointerEvents: "none",
};
