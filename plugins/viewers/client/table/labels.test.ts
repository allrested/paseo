import { expect, test } from "vitest";
import { rowCount, sortIcon, sortLabel } from "./labels.js";

test("the count names the rows, and how many of them a search left", () => {
  expect(rowCount(1, 1)).toBe("1 row");
  expect(rowCount(1204, 1204)).toBe("1,204 rows");
  expect(rowCount(37, 1204)).toBe("37 of 1,204 rows");
  expect(rowCount(0, 1)).toBe("0 of 1 row");
  expect(rowCount(0, 0)).toBe("0 rows");
});

test("a column's name says how it is sorted and what a press does", () => {
  expect(sortLabel("price", null)).toBe("Sort by price");
  expect(sortLabel("price", "ascending")).toBe("price, sorted ascending. Sort descending");
  expect(sortLabel("price", "descending")).toBe(
    "price, sorted descending. Back to the file's order",
  );
  expect([sortIcon(null), sortIcon("ascending"), sortIcon("descending")]).toEqual([
    "ChevronsUpDown",
    "ArrowUp",
    "ArrowDown",
  ]);
});
