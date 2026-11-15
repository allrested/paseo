import { expect, test } from "vitest";
import { columnWidths, numberWidth } from "./layout.js";

test("a column is as wide as its longest cell or its name with the sort mark", () => {
  const [short, named, long] = columnWidths({
    columns: ["n", "a rather long column name", "note"],
    rows: [
      ["1", "x", "twelve chars"],
      ["22", "y", "x".repeat(400)],
    ],
  });

  // Never under four characters.
  expect(short).toBe(4 * 8 + 24);
  expect(named).toBe(Math.round(25 * 8.5) + 24 + 22);
  // A very long cell is cut at forty characters.
  expect(long).toBe(40 * 8 + 24);
});

test("a cell of several lines is measured by its first", () => {
  const [width] = columnWidths({
    columns: ["n"],
    rows: [["short\nand then a very long second line"]],
  });
  expect(width).toBe(5 * 8 + 24);
});

test("the number column fits the last row's number", () => {
  expect(numberWidth(5)).toBe(2.5 * 8 + 24);
  expect(numberWidth(120_000)).toBe(6.5 * 8 + 24);
});
