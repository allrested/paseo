import { expect, test } from "vitest";
import { followHostFocus, hostFocused } from "../../vendor/my-office/src/office/paseo-focus.js";

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

test("a page that is not in a frame keeps its own hasFocus, and asks it once", () => {
  let asked = 0;
  const own = () => {
    asked += 1;
    return false;
  };
  const doc: { hasFocus(): boolean; defaultView: unknown } = { hasFocus: own, defaultView: null };
  const win = { document: doc };
  doc.defaultView = win;
  followHostFocus(doc, win);
  expect(doc.hasFocus).toBe(own);
  expect(doc.hasFocus()).toBe(false);
  expect(asked).toBe(1);
});

test("a page in a frame follows the page it sits in", () => {
  const doc: { hasFocus(): boolean; defaultView: unknown } = {
    hasFocus: () => false,
    defaultView: {},
  };
  followHostFocus(doc, { document: { hasFocus: () => true } });
  expect(doc.hasFocus()).toBe(true);
});
