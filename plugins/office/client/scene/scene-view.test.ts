import { expect, test } from "vitest";
import type { GridCell, OfficeLayout } from "../layout.js";
import { buildOfficeModel, type OfficeModel } from "../model.js";
import { fakeOffice } from "./fake-office.js";
import {
  NO_LAYOUT,
  UNMEASURED,
  nextLayout,
  shapeAfterResize,
  type ContainerShape,
  type SceneLayout,
} from "./scene-view.js";

interface Size {
  width: number;
  height: number;
}

const PHONE: Size = { width: 390, height: 640 };
const TABLET: Size = { width: 1180, height: 700 };
const HIDDEN: Size = { width: 0, height: 0 };
const NO_ROOMS: OfficeModel = {
  rooms: [],
  attention: [],
  agents: new Map(),
  roomOfAgent: new Map(),
};

function office(): OfficeModel {
  return buildOfficeModel(fakeOffice());
}

/** The fake office after one workspace was archived: the other rooms keep their columns. */
function officeWithout(workspaceId: string): OfficeModel {
  const state = fakeOffice();
  return buildOfficeModel({
    ...state,
    workspaces: state.workspaces.filter((workspace) => workspace.id !== workspaceId),
  });
}

function shapeAfter(sizes: readonly Size[]): ContainerShape {
  return sizes.reduce(
    (shape, size) => shapeAfterResize(shape, size.width, size.height),
    UNMEASURED,
  );
}

/** What the host does: measure, then lay out with the grid the measurement gave. */
function layoutsAfter(model: OfficeModel, sizes: readonly Size[]): (OfficeLayout | null)[] {
  let shape: ContainerShape = UNMEASURED;
  let state: SceneLayout = NO_LAYOUT;
  return sizes.map((size) => {
    shape = shapeAfterResize(shape, size.width, size.height);
    state = nextLayout(state, model, shape.columns);
    return state.layout;
  });
}

function cellOf(state: SceneLayout, roomId: string): GridCell | null {
  return state.layout?.roomById.get(roomId)?.cell ?? null;
}

test("a container that was never measured has no size", () => {
  const shape: ContainerShape = shapeAfter([HIDDEN]);
  expect(shape).toEqual({ sized: false, columns: undefined });
});

test("a tall container stacks the rooms in one column and a wide one gets two", () => {
  const shapes: ContainerShape[] = [shapeAfter([PHONE]), shapeAfter([TABLET])];
  expect(shapes).toEqual([
    { sized: true, columns: 1 },
    { sized: true, columns: 2 },
  ]);
});

test("a hidden container keeps the columns it had", () => {
  const shape: ContainerShape = shapeAfter([TABLET, HIDDEN]);
  expect(shape).toEqual({ sized: true, columns: 2 });
});

test("a size that gives the same columns is not a new shape", () => {
  const first = shapeAfter([PHONE]);
  const same: boolean = shapeAfterResize(first, 400, 700) === first;
  expect(same).toEqual(true);
});

test("phone, hidden, phone again is one layout, not three", () => {
  const layouts = layoutsAfter(office(), [PHONE, HIDDEN, PHONE]);
  expect(new Set(layouts).size).toEqual(1);
  expect(layouts[0]?.roomById.get("w-load")?.cell).toEqual({ gx: 0, gz: 4 });
});

test("a container turned on its side is laid out again in the other columns", () => {
  const layouts = layoutsAfter(office(), [PHONE, TABLET]);
  const cells = layouts.map((layout) => layout?.roomById.get("w-load")?.cell);
  // The last of one column on a phone; the deepest room, so the first of the second column.
  expect(cells).toEqual([
    { gx: 0, gz: 4 },
    { gx: 1, gz: 0 },
  ]);
});

test("a new model is laid out with the cells the last layout gave", () => {
  const first = nextLayout(NO_LAYOUT, office(), 2);
  const second = nextLayout(first, officeWithout("w-main"), 2);
  // It keeps its column and moves up to the place the archived room left.
  expect([cellOf(first, "w-infra"), cellOf(second, "w-infra")]).toEqual([
    { gx: 0, gz: 2 },
    { gx: 0, gz: 1 },
  ]);
});

test("an office with no rooms is not laid out and the rooms return to their cells", () => {
  const before = nextLayout(nextLayout(NO_LAYOUT, office(), 2), officeWithout("w-main"), 2);
  const empty = nextLayout(before, NO_ROOMS, 2);
  const after = nextLayout(empty, officeWithout("w-main"), 2);
  expect(empty.layout).toEqual(null);
  expect(empty.memory).toEqual(before.memory);
  // Laid out from nothing, the room would be dealt into the other column: { gx: 1, gz: 1 }.
  expect(cellOf(after, "w-infra")).toEqual({ gx: 0, gz: 1 });
  expect(cellOf(nextLayout(NO_LAYOUT, officeWithout("w-main"), 2), "w-infra")).toEqual({
    gx: 1,
    gz: 1,
  });
});

/** The fake office for a moment after a reconnect: its agents came, its workspaces not yet. */
function officeLobbyOnly(): OfficeModel {
  return buildOfficeModel({ ...fakeOffice(), workspaces: [] });
}

function allCells(state: SceneLayout): [string, GridCell][] {
  return (state.layout?.rooms ?? []).map((room) => [room.roomId, room.cell]);
}

test("a snapshot of the lobby alone between two full ones keeps every room's cell and rows", () => {
  const before = nextLayout(NO_LAYOUT, office(), 2);
  const lobby = nextLayout(before, officeLobbyOnly(), 2);
  const after = nextLayout(lobby, office(), 2);
  expect(allCells(after)).toEqual(allCells(before));
  expect(after.layout?.rooms.map((room) => room.rows)).toEqual(
    before.layout?.rooms.map((room) => room.rows),
  );
});

test("a layout kept while the view was away is the layout the view draws when it comes back", () => {
  const model = office();
  const kept = nextLayout(NO_LAYOUT, model, 2);
  // A new view measures its container again, then lays out from what the surface kept.
  const shape = shapeAfter([HIDDEN, TABLET]);
  expect(nextLayout(kept, model, shape.columns) === kept).toEqual(true);
});
