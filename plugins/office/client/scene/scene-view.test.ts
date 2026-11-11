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

/** The fake office after one workspace was archived: the rooms behind it keep their cells. */
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

test("a tall container puts two rooms to a row and a wide one lets them spiral", () => {
  const shapes: ContainerShape[] = [shapeAfter([PHONE]), shapeAfter([TABLET])];
  expect(shapes).toEqual([
    { sized: true, columns: 2 },
    { sized: true, columns: undefined },
  ]);
});

test("a hidden container keeps the grid it had", () => {
  const shape: ContainerShape = shapeAfter([PHONE, HIDDEN]);
  expect(shape).toEqual({ sized: true, columns: 2 });
});

test("a size that gives the same grid is not a new shape", () => {
  const first = shapeAfter([PHONE]);
  const same: boolean = shapeAfterResize(first, 400, 700) === first;
  expect(same).toEqual(true);
});

test("phone, hidden, phone again is one layout, not three", () => {
  const layouts = layoutsAfter(office(), [PHONE, HIDDEN, PHONE]);
  expect(new Set(layouts).size).toEqual(1);
  expect(layouts[0]?.roomById.get("w-load")?.cell).toEqual({ gx: 0, gz: 2 });
});

test("a container turned on its side is laid out again in the other grid", () => {
  const layouts = layoutsAfter(office(), [PHONE, TABLET]);
  const cells = layouts.map((layout) => layout?.roomById.get("w-load")?.cell);
  expect(cells).toEqual([
    { gx: 0, gz: 2 },
    { gx: -1, gz: 1 },
  ]);
});

test("a new model is laid out with the cells the last layout gave", () => {
  const first = nextLayout(NO_LAYOUT, office(), 2);
  const second = nextLayout(first, officeWithout("w-docs"), 2);
  expect([cellOf(first, "w-infra"), cellOf(second, "w-infra")]).toEqual([
    { gx: 0, gz: 1 },
    { gx: 0, gz: 1 },
  ]);
});

test("an office with no rooms is not laid out and the rooms return to their cells", () => {
  const before = nextLayout(nextLayout(NO_LAYOUT, office(), 2), officeWithout("w-docs"), 2);
  const empty = nextLayout(before, NO_ROOMS, 2);
  const after = nextLayout(empty, officeWithout("w-docs"), 2);
  expect(empty.layout).toEqual(null);
  expect(empty.memory).toEqual(before.memory);
  // Laid out from nothing, the room would take the free cell in the row above: { gx: 1, gz: 1 }.
  expect(cellOf(after, "w-infra")).toEqual({ gx: 0, gz: 1 });
});
