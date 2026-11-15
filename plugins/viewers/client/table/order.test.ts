import { expect, test } from "vitest";
import { arrange, nextSort, numericColumns, searchWords, searchable, type Sort } from "./order.js";
import type { Table } from "./parse.js";

const TABLE: Table = {
  columns: ["name", "price", "note"],
  rows: [
    ["Pear", "10", "ripe"],
    ["apple", "9.5", ""],
    ["Fig", "", "Dried, sweet"],
    ["apple 10", "-3", "ripe"],
    ["apple 9", "1e2", "RIPE and soft"],
  ],
};

const show = (search: string, sort: Sort | null) =>
  arrange(TABLE, {
    words: searchWords(search),
    texts: searchable(TABLE),
    sort,
    numeric: numericColumns(TABLE),
  });

test("a column is numbers when every cell that holds something is one", () => {
  expect(numericColumns(TABLE)).toEqual([false, true, false]);
  // A column of empty cells is not numbers.
  expect(numericColumns({ columns: ["a"], rows: [[""], [" "]] })).toEqual([false]);
  expect(numericColumns({ columns: ["a"], rows: [["1"], ["1,5"]] })).toEqual([false]);
});

test("without a search or a sort, the rows are in the file's order", () => {
  expect(show("", null)).toEqual([0, 1, 2, 3, 4]);
});

test("a search keeps the rows that hold every word, in any cell and any case", () => {
  expect(show("ripe", null)).toEqual([0, 3, 4]);
  expect(show("  RIPE apple ", null)).toEqual([3, 4]);
  expect(show("dried fig", null)).toEqual([2]);
  expect(show("nothing", null)).toEqual([]);
});

test("numbers sort by value, and an empty cell is last both ways", () => {
  expect(show("", { column: 1, direction: "ascending" })).toEqual([3, 1, 0, 4, 2]);
  expect(show("", { column: 1, direction: "descending" })).toEqual([4, 0, 1, 3, 2]);
});

test("text sorts without case, a number inside it by its value", () => {
  expect(show("", { column: 0, direction: "ascending" })).toEqual([1, 4, 3, 2, 0]);
  expect(show("", { column: 0, direction: "descending" })).toEqual([0, 2, 3, 4, 1]);
});

test("rows that compare equal keep the file's order, and a search is sorted too", () => {
  expect(show("", { column: 2, direction: "ascending" })).toEqual([2, 0, 3, 4, 1]);
  expect(show("ripe", { column: 1, direction: "descending" })).toEqual([4, 0, 3]);
});

test("a press on a column's name sorts it up, then down, then not at all", () => {
  const up = nextSort(null, 1);
  expect(up).toEqual({ column: 1, direction: "ascending" });
  const down = nextSort(up, 1);
  expect(down).toEqual({ column: 1, direction: "descending" });
  expect(nextSort(down, 1)).toBeNull();
  // Another column starts over.
  expect(nextSort(down, 0)).toEqual({ column: 0, direction: "ascending" });
});
