import { useEffect, useImperativeHandle, useMemo, useRef, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { CdpBrowserViewInput } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import type { CdpInputLayerProps } from "./input-layer-types";
import { createClickCounter, createPressTracker, isStaleFrame } from "./press-tracker";
import { attachSoftKeyboardField } from "./soft-keyboard-field";
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
 * A focusable element over the frame. Keys reach the page only while this element itself has
 * focus, so the URL field and every other app input keep their own keys. Ctrl/Cmd+L moves focus
 * to the URL field. Paste goes through the browser paste event, so the clipboard text is sent
 * only when the user pastes; it is never read at any other time.
 *
 * On a touch screen the toolbar's keyboard button turns on the on-screen keyboard by focusing a
 * hidden field next to the layer. While it is on, taps and drags on the frame go to the page and
 * the field keeps focus, so the keyboard stays up. It goes off when the button is pressed again,
 * or when the field loses focus to anything but the frame: the URL field, another control, the
 * keyboard's own hide key, or the window. Focus that comes back to the field turns it on again.
 */
export function CdpInputLayer({
  rect,
  page,
  viewport,
  onInput,
  onFocusUrl,
  onFocusPane,
  keyboardRef,
  onKeyboardChange,
}: CdpInputLayerProps) {
  const { t } = useTranslation();
  const element = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const keyboardOn = useRef(false);
  const endComposition = useRef<() => void>(() => {});
  // Handlers read the latest props without re-attaching DOM listeners on every frame.
  const latest = useRef({
    rect,
    page,
    viewport,
    onInput,
    onFocusUrl,
    onFocusPane,
    onKeyboardChange,
  });
  latest.current = { rect, page, viewport, onInput, onFocusUrl, onFocusPane, onKeyboardChange };

  useImperativeHandle(
    keyboardRef,
    () => ({
      show() {
        const target = field.current;
        if (!target) return;
        // Android keeps a field focused after its keyboard is hidden; focus() alone does not raise it.
        if (document.activeElement === target) target.blur();
        target.focus({ preventScroll: true });
        keyboardOn.current = true;
        latest.current.onKeyboardChange(true);
      },
      hide() {
        endComposition.current();
        keyboardOn.current = false;
        field.current?.blur();
        latest.current.onKeyboardChange(false);
      },
      isOn: () => keyboardOn.current,
    }),
    [],
  );

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
    const stale = () => isStaleFrame(latest.current.page, latest.current.viewport);
    // Mouse and key presses go through the tracker, so each down gets exactly one up.
    const sendPress = (input: CdpBrowserViewInput, onStaleFrame = false) => {
      if (tracker.press(input, onStaleFrame)) send(input);
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
      sendAll(touch.end(stale()));
    };

    const onPointerDown = (event: PointerEvent) => {
      if (keyboardOn.current) {
        // The press moves the page caret, so a word still being composed is left where it was.
        endComposition.current();
        // Cancelling the press keeps focus (and the keyboard) on the field.
        event.preventDefault();
      } else {
        node.focus({ preventScroll: true });
      }
      latest.current.onFocusPane?.();
      if (event.pointerType === "touch") {
        if (touchId !== null) return;
        touchId = event.pointerId;
        touch.start(point(event), stale());
        return;
      }
      node.setPointerCapture(event.pointerId);
      const button = mouseButton(event.button);
      sendPress(
        {
          kind: "mouse",
          type: "down",
          ...point(event),
          button,
          buttons: event.buttons,
          clickCount: clicks.press(button, event.clientX, event.clientY),
          modifiers: modifierMask(event),
        },
        stale(),
      );
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        if (event.pointerId === touchId) sendAll(touch.move(point(event)));
        return;
      }
      // A drag sends every move (coalesced per frame); a hover is capped at about 30 per second.
      if (event.buttons === 0 && !allowHover()) return;
      // The drag of a press dropped on a stale frame is dropped too.
      if (event.buttons !== 0 && !tracker.dragAllowed()) return;
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
    const turnOff = () => {
      keyboardOn.current = false;
      latest.current.onKeyboardChange(false);
    };
    const softKeyboardField = attachSoftKeyboardField({
      field: softKeyboard,
      frame: node,
      send,
      isOn: () => keyboardOn.current,
      turnOn: () => {
        keyboardOn.current = true;
        latest.current.onKeyboardChange(true);
      },
      turnOff,
    });
    endComposition.current = softKeyboardField.endComposition;
    return () => {
      endComposition.current = () => {};
      softKeyboardField.detach();
      if (keyboardOn.current) turnOff();
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
