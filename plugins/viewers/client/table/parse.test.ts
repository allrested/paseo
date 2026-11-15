import { expect, test } from "vitest";
import { delimiterOf, parseDelimited, readTable, toTable } from "./parse.js";

test("records split at line ends and cells at the delimiter", () => {
  expect(parseDelimited("a,b,c\n1,2,3\n", ",")).toEqual([
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
  // Windows and old Mac line ends, and a last line without one.
  expect(parseDelimited("a,b\r\n1,2\r3,4", ",")).toEqual([
    ["a", "b"],
    ["1", "2"],
    ["3", "4"],
  ]);
});

test("a quoted cell holds the delimiter, a line end and a doubled quote", () => {
  expect(parseDelimited('name,note\n"Lee, Ann","said ""hi""\nthen left"\n', ",")).toEqual([
    ["name", "note"],
    ["Lee, Ann", 'said "hi"\nthen left'],
  ]);
  expect(parseDelimited('"",x', ",")).toEqual([["", "x"]]);
});

test("empty cells are kept, at the start, the middle and the end of a line", () => {
  expect(parseDelimited(",a,,b,\n,,\n", ",")).toEqual([
    ["", "a", "", "b", ""],
    ["", "", ""],
  ]);
});

test("a blank line is no record", () => {
  expect(parseDelimited("a\n\n\nb\n\n", ",")).toEqual([["a"], ["b"]]);
  expect(parseDelimited("", ",")).toEqual([]);
  expect(parseDelimited("\n", ",")).toEqual([]);
});

test("a quote that never closes takes the rest, and text after a closing quote is kept", () => {
  expect(parseDelimited('a,"b\nc,d', ",")).toEqual([["a", "b\nc,d"]]);
  expect(parseDelimited('"a"b,c', ",")).toEqual([["ab", "c"]]);
});

test("a quote inside a cell that does not start with one is a plain character", () => {
  expect(parseDelimited('5" disk,x', ",")).toEqual([['5" disk', "x"]]);
});

test("tabs and semicolons split when they are the delimiter", () => {
  expect(parseDelimited("a\tb,c\n1\t2", "\t")).toEqual([
    ["a", "b,c"],
    ["1", "2"],
  ]);
  expect(parseDelimited("a;b\n1,5;2", ";")).toEqual([
    ["a", "b"],
    ["1,5", "2"],
  ]);
});

test("a .tsv splits at tabs; another file at what its first line holds most of", () => {
  expect(delimiterOf("tsv", "a,b,c")).toBe("\t");
  expect(delimiterOf("csv", "a,b,c\n1;2;3;4;5")).toBe(",");
  expect(delimiterOf("csv", "name;price;note\n1;2,5;x")).toBe(";");
  expect(delimiterOf("csv", "a\tb\tc")).toBe("\t");
  // A delimiter inside quotes does not count, and a file without any is split at commas.
  expect(delimiterOf("csv", '"a;b;c;d",e,f')).toBe(",");
  expect(delimiterOf("csv", "one")).toBe(",");
  expect(delimiterOf("csv", "")).toBe(",");
});

test("the first record names the columns, and every row is as wide as the widest", () => {
  expect(
    toTable([
      ["id", " name ", ""],
      ["1", "Ann"],
      ["2", "Bo", "x", "extra"],
    ]),
  ).toEqual({
    columns: ["id", "name", "Column 3", "Column 4"],
    rows: [
      ["1", "Ann", "", ""],
      ["2", "Bo", "x", "extra"],
    ],
  });
  expect(toTable([])).toEqual({ columns: [], rows: [] });
  expect(toTable([["only", "names"]])).toEqual({ columns: ["only", "names"], rows: [] });
});

test("a file is read with its own delimiter", () => {
  expect(readTable("csv", "a;b\n1;2\n")).toEqual({ columns: ["a", "b"], rows: [["1", "2"]] });
  expect(readTable("tsv", "a\tb\n1\t2\n")).toEqual({ columns: ["a", "b"], rows: [["1", "2"]] });
});
