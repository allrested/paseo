import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { CdpBrowserViewInput } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import type { CdpInputLayerProps } from "./input-layer-types";
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

function isPasteChord(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v";
}

/**
 * A focusable element over the frame. Keys reach the page only while this element itself has
 * focus, so the URL field and every other app input keep their own keys. Ctrl/Cmd+L moves focus
 * to the URL field. Paste goes through the browser paste event, so the clipboard text is sent
 * only when the user pastes; it is never read at any other time.
 */
export function CdpInputLayer({
  rect,
  page,
  onInput,
  onFocusUrl,
  onFocusPane,
}: CdpInputLayerProps) {
  const element = useRef<HTMLDivElement>(null);
  // Handlers read the latest props without re-attaching DOM listeners on every frame.
  const latest = useRef({ rect, page, onInput, onFocusUrl, onFocusPane });
  latest.current = { rect, page, onInput, onFocusUrl, onFocusPane };

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const allowHover = createThrottle(HOVER_INTERVAL_MS);
    const touch = createTouchGesture();
    let touchId: number | null = null;
    const coalescer = createInputCoalescer((input) => latest.current.onInput(input));
    const send = (input: CdpBrowserViewInput) => coalescer.push(input);
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
      send({
        kind: "mouse",
        type: "down",
        ...point(event),
        button: mouseButton(event.button),
        buttons: event.buttons,
        clickCount: Math.max(1, event.detail),
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
      send({
        kind: "mouse",
        type: "move",
        ...point(event),
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
      send({
        kind: "mouse",
        type: "up",
        ...point(event),
        button: mouseButton(event.button),
        buttons: event.buttons,
        clickCount: Math.max(1, event.detail),
        modifiers: modifierMask(event),
      });
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerType === "touch" && event.pointerId === touchId) {
        touchId = null;
        touch.cancel();
      }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? WHEEL_LINE_PX : 1;
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
      send({
        kind: "key",
        type: "down",
        key: event.key,
        code: event.code,
        ...(text ? { text } : {}),
        modifiers: modifierMask(event),
      });
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (document.activeElement !== node || isPasteChord(event)) return;
      event.preventDefault();
      send({
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
    node.addEventListener("contextmenu", onContextMenu);
    return () => {
      coalescer.dispose();
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
  return <div ref={element} style={style} tabIndex={0} />;
}
