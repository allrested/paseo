import { describe, expect, test } from "vitest";
import { cdpKeyEvent, virtualKeyCode } from "./cdp-keys.js";

describe("cdpKeyEvent", () => {
  test("a character key is a raw key down, a char and a key up", () => {
    expect(cdpKeyEvent({ type: "keyDown", keyCode: "a" })).toEqual({
      type: "rawKeyDown",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
    });
    expect(cdpKeyEvent({ type: "char", keyCode: "a" })).toEqual({
      type: "char",
      key: "a",
      text: "a",
    });
    expect(cdpKeyEvent({ type: "keyUp", keyCode: "a" })).toEqual({
      type: "keyUp",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
    });
  });

  test("Enter carries its text so forms submit", () => {
    expect(cdpKeyEvent({ type: "keyDown", keyCode: "Enter" })).toEqual({
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      text: "\r",
    });
  });

  test("Electron arrow aliases and Space map to DOM keys", () => {
    expect(cdpKeyEvent({ type: "keyDown", keyCode: "Down" })).toEqual({
      type: "rawKeyDown",
      key: "ArrowDown",
      code: "ArrowDown",
      windowsVirtualKeyCode: 40,
    });
    expect(cdpKeyEvent({ type: "keyDown", keyCode: "Space" })).toEqual({
      type: "rawKeyDown",
      key: " ",
      code: "Space",
      windowsVirtualKeyCode: 32,
    });
  });

  test("virtualKeyCode covers digits and unknown keys", () => {
    expect(virtualKeyCode("7")).toBe(55);
    expect(virtualKeyCode("ArrowUp")).toBe(38);
    expect(virtualKeyCode("F13")).toBe(0);
  });
});
