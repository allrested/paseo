import { expect, test } from "vitest";
import { parseColor, relativeLuminance } from "./luminance.js";

test("a theme colour is read in each form the themes use", () => {
  expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
  expect(parseColor("#10203a")).toEqual({ r: 16, g: 32, b: 58 });
  expect(parseColor("#10203aff")).toEqual({ r: 16, g: 32, b: 58 });
  expect(parseColor("rgba(1, 2, 3, 0.5)")).toEqual({ r: 1, g: 2, b: 3 });
  expect(parseColor("tomato")).toBeNull();
});

test("luminance runs from black to white, and an unreadable colour is mid grey", () => {
  expect(relativeLuminance("#000000")).toBe(0);
  expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  expect(relativeLuminance("tomato")).toBeCloseTo(relativeLuminance("#808080"), 5);
  expect(relativeLuminance("#18181c")).toBeLessThan(0.4);
  expect(relativeLuminance("#fafafa")).toBeGreaterThan(0.4);
});
