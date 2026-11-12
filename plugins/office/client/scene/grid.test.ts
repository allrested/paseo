import { expect, test } from "vitest";
import { gridColumns } from "./grid.js";

interface Size {
  width: number;
  height: number;
}

/** The scene's container under the app's header, the 3D switch and the attention strip. */
const PHONE: Size = { width: 390, height: 666 };
const PHONE_ON_ITS_SIDE: Size = { width: 844, height: 212 };
const TABLET: Size = { width: 820, height: 1000 };
const TABLET_ON_ITS_SIDE: Size = { width: 1180, height: 640 };
const DESKTOP: Size = { width: 1440, height: 720 };

function columnsOf(view: Size, offices: readonly number[]): number[] {
  return offices.map((rooms) => gridColumns(view, rooms));
}

test("a phone has room for one column, whatever the office", () => {
  expect(columnsOf(PHONE, [1, 3, 8, 15])).toEqual([1, 1, 1, 1]);
});

test("a tablet held upright stacks a small office and puts a large one in two columns", () => {
  // In one column fifteen rooms are a strip 380 px wide on 820 px, and five of them show.
  expect(columnsOf(TABLET, [1, 2, 4, 5, 7, 10, 15])).toEqual([1, 1, 1, 1, 2, 2, 2]);
});

test("a wide view starts at two columns and takes a third for a large office", () => {
  expect(columnsOf(TABLET_ON_ITS_SIDE, [1, 3, 5, 8, 15])).toEqual([2, 2, 2, 3, 3]);
});

test("a desktop takes as many columns as show the whole office largest", () => {
  expect(columnsOf(DESKTOP, [3, 8, 15])).toEqual([2, 3, 4]);
});

test("a view never gets more columns than its width has room for", () => {
  expect(columnsOf(PHONE_ON_ITS_SIDE, [1, 8, 30])).toEqual([2, 2, 2]);
  expect(gridColumns({ width: 0, height: 0 }, 15)).toBe(1);
});

test("the columns in use stay unless another count shows the office a tenth larger", () => {
  // Five rooms upright on a tablet: 28.5 px per unit in one column, 26.7 in two.
  const fresh: number = gridColumns(TABLET, 5);
  const held: number[] = [gridColumns(TABLET, 5, 1), gridColumns(TABLET, 5, 2)];
  expect(fresh).toBe(1);
  expect(held).toEqual([1, 2]);
  // Four rooms are 35.1 against 26.7, fifteen are 9.9 against 18.3: the rooms are dealt again.
  expect([gridColumns(TABLET, 4, 2), gridColumns(TABLET, 15, 1)]).toEqual([1, 2]);
});

test("an office that is the lobby alone for a moment keeps the columns in use", () => {
  // After a reconnect the agents come before their workspaces. One room is as large in any grid.
  expect([gridColumns(TABLET, 1), gridColumns(TABLET, 1, 2)]).toEqual([1, 2]);
});

test("columns in use that the view no longer has room for are not kept", () => {
  expect(gridColumns(PHONE, 15, 2)).toBe(1);
  expect(gridColumns(TABLET_ON_ITS_SIDE, 3, 1)).toBe(2);
});
