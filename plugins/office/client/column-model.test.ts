import { expect, test } from "vitest";
import { officeColumnSettings } from "../shared/settings.js";
import { COLUMN_TABS, clampColumn, countLabel } from "./column-model.js";

test("the tabs are Attention, Sessions, Activity and Chat, in that order", () => {
  expect(COLUMN_TABS.map((each) => each.label)).toEqual([
    "Attention",
    "Sessions",
    "Activity",
    "Chat",
  ]);
});

test("a width is kept between the least and the most", () => {
  expect(clampColumn(100, 1280)).toBe(280);
  expect(clampColumn(400, 1280)).toBe(400);
  expect(clampColumn(900, 1280)).toBe(560);
});

test("the floor keeps its least width on a narrow surface", () => {
  // 700 wide: the floor's 320 leaves 380 for the column.
  expect(clampColumn(500, 700)).toBe(380);
  // Too narrow for both: the column is at its least and the floor gives way.
  expect(clampColumn(500, 500)).toBe(280);
});

test("a surface not measured yet leaves the width within the column's own limits", () => {
  expect(clampColumn(400, 0)).toBe(400);
  expect(clampColumn(900, 0)).toBe(560);
});

test("a count shows as a number, capped, and nothing at zero", () => {
  expect(countLabel(0)).toBeNull();
  expect(countLabel(3)).toBe("3");
  expect(countLabel(120)).toBe("99+");
});

test("a device that never set the column has it open at the default width", () => {
  expect(officeColumnSettings.schema.parse({})).toEqual({ width: 360, collapsed: false });
});
