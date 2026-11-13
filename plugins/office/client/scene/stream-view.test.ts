import { expect, test } from "vitest";
import { sizeAfterLayout } from "./stream-view.js";

test("the first measured size is taken", () => {
  expect(sizeAfterLayout(null, 390, 700)).toEqual({ width: 390, height: 700 });
});

test("a hidden view measures nothing and keeps its last size", () => {
  const shown = { width: 390, height: 700 };

  expect(sizeAfterLayout(shown, 0, 0)).toBe(shown);
  expect(sizeAfterLayout(null, 0, 0)).toBeNull();
});

test("the same size again is the same object, so nothing is sent to the host", () => {
  const shown = { width: 390, height: 700 };

  expect(sizeAfterLayout(shown, 390, 700)).toBe(shown);
  expect(sizeAfterLayout(shown, 700, 390)).toEqual({ width: 700, height: 390 });
});
