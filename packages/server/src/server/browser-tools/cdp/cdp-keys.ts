export interface KeyDefinition {
  key: string;
  code: string;
  vk: number;
  /** Sent with the key down. Only keys whose default action needs it (Enter) have one. */
  text?: string;
}

const NAMED_KEYS: Record<string, KeyDefinition> = {
  Enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", vk: 9 },
  Backspace: { key: "Backspace", code: "Backspace", vk: 8 },
  Delete: { key: "Delete", code: "Delete", vk: 46 },
  Escape: { key: "Escape", code: "Escape", vk: 27 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
  Home: { key: "Home", code: "Home", vk: 36 },
  End: { key: "End", code: "End", vk: 35 },
  PageUp: { key: "PageUp", code: "PageUp", vk: 33 },
  PageDown: { key: "PageDown", code: "PageDown", vk: 34 },
  Space: { key: " ", code: "Space", vk: 32 },
  Shift: { key: "Shift", code: "ShiftLeft", vk: 16 },
  Control: { key: "Control", code: "ControlLeft", vk: 17 },
  Alt: { key: "Alt", code: "AltLeft", vk: 18 },
  Meta: { key: "Meta", code: "MetaLeft", vk: 91 },
};
// The engine sends Electron accelerator names for the arrows.
const ALIASES: Record<string, string> = {
  Up: "ArrowUp",
  Down: "ArrowDown",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  " ": "Space",
};

export function keyDefinition(name: string): KeyDefinition {
  const named = NAMED_KEYS[ALIASES[name] ?? name];
  if (named) return named;
  if (name.length === 1) {
    const upper = name.toUpperCase();
    if (upper >= "A" && upper <= "Z")
      return { key: name, code: `Key${upper}`, vk: upper.charCodeAt(0) };
    if (name >= "0" && name <= "9")
      return { key: name, code: `Digit${name}`, vk: name.charCodeAt(0) };
  }
  return { key: name, code: "", vk: 0 };
}

export function virtualKeyCode(key: string): number {
  return keyDefinition(key).vk;
}

export function cdpKeyEvent(event: {
  type: "char" | "keyDown" | "keyUp";
  keyCode: string;
}): Record<string, unknown> {
  if (event.type === "char") return { type: "char", key: event.keyCode, text: event.keyCode };
  const definition = keyDefinition(event.keyCode);
  const base = { key: definition.key, code: definition.code, windowsVirtualKeyCode: definition.vk };
  if (event.type === "keyUp") return { type: "keyUp", ...base };
  return definition.text
    ? { type: "keyDown", ...base, text: definition.text }
    : { type: "rawKeyDown", ...base };
}
