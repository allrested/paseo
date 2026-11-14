import { expect, test } from "vitest";
import type { SheetEvent } from "../../shared/contracts.js";
import type { Sheet, SheetTile } from "../../shared/sheet.js";
import { INITIAL_SHEET, sheetReducer, type SheetState } from "./sheet-state.js";

function makeSheet(version: number, tiles: number, overrides: Partial<Sheet> = {}): Sheet {
  return {
    version,
    tiles,
    width: 400,
    height: 800,
    ratio: 2,
    scale: 40,
    frame: { width: 60, height: 80, chest: { x: 30, y: 40 } },
    robots: [],
    rooms: [],
    notes: [],
    mentions: [],
    ...overrides,
  };
}

function makeTile(version: number, index: number): SheetTile {
  return {
    version,
    index,
    x: 0,
    y: index * 100,
    width: 400,
    height: 100,
    jpeg: "J",
    overlay: null,
  };
}

const sheetEvent = (sheet: Sheet): SheetEvent => ({ type: "sheet", sheet });
const tileEvent = (version: number, index: number): SheetEvent => ({
  type: "tile",
  tile: makeTile(version, index),
});

function run(events: SheetEvent[], from: SheetState = INITIAL_SHEET): SheetState {
  return events.reduce(sheetReducer, from);
}

test("a sheet waits for the tiles of its version", () => {
  const first = makeSheet(1, 1);
  const shown = run([{ type: "ready", sheetId: "a" }, tileEvent(1, 0), sheetEvent(first)]);
  expect(shown.shown?.sheet).toBe(first);

  const second = makeSheet(2, 2);
  const waiting = run([sheetEvent(second), tileEvent(2, 1)], shown);
  expect(waiting.shown?.sheet).toBe(first);
  expect(waiting.shown?.tiles).toBe(shown.shown?.tiles);

  const done = run([tileEvent(2, 0)], waiting);
  expect(done.shown?.sheet).toBe(second);
  expect(done.shown?.tiles.map((tile) => [tile.version, tile.index])).toEqual([
    [2, 0],
    [2, 1],
  ]);
});

test("a sheet of the shown version replaces it and keeps the tiles", () => {
  const first = makeSheet(1, 1);
  const shown = run([tileEvent(1, 0), sheetEvent(first)]);
  const next = makeSheet(1, 1, { width: 400 });

  const after = run([sheetEvent(next)], shown);

  expect(after.shown?.sheet).toBe(next);
  expect(after.shown?.tiles).toBe(shown.shown?.tiles);
});

test("a new sheet id starts over", () => {
  const shown = run([
    { type: "ready", sheetId: "a" },
    tileEvent(1, 0),
    sheetEvent(makeSheet(1, 1)),
    tileEvent(2, 0),
  ]);

  const after = run([{ type: "ready", sheetId: "b" }], shown);

  expect(after).toEqual({ ...INITIAL_SHEET, sheetId: "b" });
});

test("tiles of an older version are dropped", () => {
  const shown = run([tileEvent(2, 0), sheetEvent(makeSheet(2, 1))]);

  const after = run([tileEvent(1, 0), sheetEvent(makeSheet(1, 1))], shown);

  expect(after.shown).toBe(shown.shown);
  expect(after.collected).toEqual({});
});

test("a problem is kept", () => {
  const shown = run([tileEvent(1, 0), sheetEvent(makeSheet(1, 1))]);

  const after = run([{ type: "problem", message: "no page" }], shown);

  expect(after.problem).toBe("no page");
  expect(after.shown).toBe(shown.shown);
});
