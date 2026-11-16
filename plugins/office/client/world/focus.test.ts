import { expect, test } from "vitest";
import { hostFocused } from "../../vendor/my-office/src/office/paseo-focus.js";

test("the scene counts as focused while Paseo's page has focus", () => {
  expect(hostFocused(() => false, { document: { hasFocus: () => true } })).toBe(true);
  expect(hostFocused(() => false, { document: { hasFocus: () => false } })).toBe(false);
});

test("a press inside the frame still counts", () => {
  expect(hostFocused(() => true, { document: { hasFocus: () => false } })).toBe(true);
});

test("a parent page it cannot reach falls back to the frame's own focus", () => {
  const crossOrigin = {
    get document(): { hasFocus(): boolean } {
      throw new Error("cross-origin");
    },
  };
  expect(hostFocused(() => true, crossOrigin)).toBe(true);
  expect(hostFocused(() => false, crossOrigin)).toBe(false);
  expect(hostFocused(() => false, null)).toBe(false);
});
