import { expect, test } from "vitest";
import { resizeToSend, sizeAfterLayout, streamShown } from "./stream-view.js";

test("the first measured size is taken", () => {
  expect(sizeAfterLayout(null, 390, 700)).toEqual({ width: 390, height: 700 });
});

test("a hidden view measures nothing and has no size, so its stream closes", () => {
  expect(sizeAfterLayout({ width: 390, height: 700 }, 0, 0)).toBeNull();
  expect(sizeAfterLayout(null, 0, 0)).toBeNull();
});

test("the same size again is the same object", () => {
  const shown = { width: 390, height: 700 };

  expect(sizeAfterLayout(shown, 390, 700)).toBe(shown);
  expect(sizeAfterLayout(shown, 700, 390)).toEqual({ width: 700, height: 390 });
});

test("the stream shows only with a size and while the app is in front", () => {
  const size = { width: 390, height: 700 };

  expect(streamShown(size, "active")).toBe(true);
  expect(streamShown(size, "background")).toBe(false);
  expect(streamShown(size, "inactive")).toBe(true);
  expect(streamShown(null, "active")).toBe(false);
});

test("a size is sent when it differs from the last one the host was told, the opening size included", () => {
  const opened = { width: 390, height: 700 };
  const turned = { width: 700, height: 390 };

  expect(resizeToSend(opened, opened)).toBeNull();
  expect(resizeToSend(opened, turned)).toEqual(turned);
  // Turned back: the host still has the turned size, so the opening size goes out again.
  expect(resizeToSend(turned, opened)).toEqual(opened);
});
