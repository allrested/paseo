import { expect, test } from "vitest";
import { compileSprite } from "./sprite.js";

const PALETTE = { a: "#111111", b: "#222222" };

test("a row becomes one rectangle per run, and clear pixels become none", () => {
  expect(compileSprite(["aa.b"], PALETTE)).toEqual({
    width: 4,
    height: 1,
    rects: [
      { x: 0, y: 0, w: 2, h: 1, color: "#111111" },
      { x: 3, y: 0, w: 1, h: 1, color: "#222222" },
    ],
  });
});

test("a run that repeats in the row below grows down; one that moves starts anew", () => {
  expect(compileSprite(["aab.", "aab.", ".aab", "aab."], PALETTE).rects).toEqual([
    { x: 0, y: 0, w: 2, h: 2, color: "#111111" },
    { x: 2, y: 0, w: 1, h: 2, color: "#222222" },
    { x: 1, y: 2, w: 2, h: 1, color: "#111111" },
    { x: 3, y: 2, w: 1, h: 1, color: "#222222" },
    { x: 0, y: 3, w: 2, h: 1, color: "#111111" },
    { x: 2, y: 3, w: 1, h: 1, color: "#222222" },
  ]);
});

test("every pixel of the grid is covered once by its own colour", () => {
  const grid = ["a.ab", "aaab", "b..b", "bbbb"];
  const sprite = compileSprite(grid, PALETTE);
  const drawn = grid.map((row) => [...row].map(() => "."));
  for (const rect of sprite.rects) {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        expect(drawn[y]?.[x]).toBe(".");
        const line = drawn[y];
        if (line) line[x] = rect.color === PALETTE.a ? "a" : "b";
      }
    }
  }
  expect(drawn.map((row) => row.join(""))).toEqual(grid);
});

test("a ragged grid and a letter without a colour are mistakes in the art", () => {
  expect(() => compileSprite(["aa", "a"], PALETTE)).toThrow("Sprite row 1 is 1 wide, not 2");
  expect(() => compileSprite(["az"], PALETTE)).toThrow('Sprite letter "z" has no colour');
});

test("an empty grid is an empty sprite", () => {
  expect(compileSprite([], PALETTE)).toEqual({ width: 0, height: 0, rects: [] });
});
