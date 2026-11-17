// Web only. Every function asks for a document before it uses one, and none touches the DOM at
// module top level, because esbuild bundles this file for every platform.

import { parseBrand, type OfficeBrand } from "./brand.js";

export function hasWebGL2(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2");
    if (context === null) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * Calls `onSpace` when Space goes down on the element with this id, and returns what stops it.
 * react-native-web presses on Space only for a button; a switch is turned with Space (WAI-ARIA).
 * Without a document (native) nothing is listened to.
 */
export function listenForSpace(elementId: string, onSpace: () => void): () => void {
  const element = typeof document === "undefined" ? null : document.getElementById(elementId);
  if (element === null) return () => undefined;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== " " && event.key !== "Spacebar") return;
    // Space scrolls the page; a key held down turns the switch once.
    event.preventDefault();
    if (!event.repeat) onSpace();
  };
  element.addEventListener("keydown", onKeyDown);
  return () => element.removeEventListener("keydown", onKeyDown);
}

/** Moves the keyboard's focus to the element with this id. Without a document (native) nothing moves. */
export function focusById(elementId: string): void {
  const element = typeof document === "undefined" ? null : document.getElementById(elementId);
  element?.focus();
}

/** Where a key typed is the field's own: a slash there is text, not a shortcut. */
const FIELD = 'input, textarea, select, [contenteditable="true"]';

/**
 * Focuses the element with this id when "/" goes down outside a field and without Ctrl, Meta or
 * Alt, and returns what stops it. Without a document (native) nothing is listened to.
 */
export function listenForSlash(inputId: string): () => void {
  if (typeof document === "undefined") return () => undefined;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
    const { target } = event;
    if (target instanceof Element && target.closest(FIELD) !== null) return;
    const input = document.getElementById(inputId);
    if (input === null) return;
    event.preventDefault();
    input.focus();
  };
  document.addEventListener("keydown", onKeyDown);
  return () => document.removeEventListener("keydown", onKeyDown);
}

/** The host's brand, as the daemon wrote it into this page; null on a page without one. */
export function readBrand(): OfficeBrand | null {
  if (typeof document === "undefined") return null;
  return parseBrand(Reflect.get(window, "__PASEO_BRAND__"), document.baseURI);
}
