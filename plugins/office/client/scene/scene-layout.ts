// The scene's layout, as pure functions: the office scene view and the render page both use them.
import {
  EMPTY_LAYOUT_MEMORY,
  layoutOffice,
  type LayoutMemory,
  type OfficeLayout,
} from "../layout.js";
import type { OfficeModel } from "../model.js";
import { gridColumns } from "./grid.js";
import type { ScenePlan } from "./scene-plan.js";

/** What the host keeps of its container's size. */
export interface ContainerShape {
  /** False until the container first had a size. No scene is created before that. */
  sized: boolean;
  /** The last size that was a view, in CSS pixels; 0 x 0 until there was one. */
  width: number;
  height: number;
}

export const UNMEASURED: ContainerShape = { sized: false, width: 0, height: 0 };

/**
 * The shape after the container measured `width` x `height`. A hidden workspace tab is
 * `display: none` and measures 0 x 0, which is no view to count columns for: it keeps the last
 * shape instead, so showing the tab again does not move the rooms or the camera. The same size
 * again returns `previous` itself.
 */
export function shapeAfterResize(
  previous: ContainerShape,
  width: number,
  height: number,
): ContainerShape {
  if (width <= 0 || height <= 0) return previous;
  const same = previous.sized && previous.width === width && previous.height === height;
  return same ? previous : { sized: true, width, height };
}

/**
 * The columns of rooms for a container of this shape and an office of `rooms` rooms
 * (`gridColumns`); undefined until the container has a size. `held` is the count the last
 * layout was dealt for: a size or an office that is little different keeps it, so nothing is
 * laid out again.
 */
export function columnsNow(
  shape: ContainerShape,
  rooms: number,
  held: number | undefined,
): number | undefined {
  return shape.sized ? gridColumns(shape, rooms, held) : undefined;
}

/** The layout the scene draws, with what it was made from. */
export interface SceneLayout {
  model: OfficeModel | null;
  columns: number | undefined;
  /** Null while the office has no rooms. */
  layout: OfficeLayout | null;
  memory: LayoutMemory;
}

export const NO_LAYOUT: SceneLayout = {
  model: null,
  columns: undefined,
  layout: null,
  memory: EMPTY_LAYOUT_MEMORY,
};

/** Where the surface keeps the scene's layout between two lives of the view (a React ref). */
export interface SceneLayoutKeeper {
  current: SceneLayout;
}

/**
 * Lays the office out again only for a new model or a new grid. An office with no rooms is not
 * laid out and the memory stays as it was, so the rooms return to their cells and seats.
 */
export function nextLayout(
  previous: SceneLayout,
  model: OfficeModel,
  columns: number | undefined,
): SceneLayout {
  if (previous.model === model && previous.columns === columns) return previous;
  if (model.rooms.length === 0) return { model, columns, layout: null, memory: previous.memory };
  const { layout, memory } = layoutOffice(model, previous.memory, columns);
  return { model, columns, layout, memory };
}

/** What the scene draws for an office with no rooms. */
export const NO_ROOMS: ScenePlan = {
  rooms: [],
  robots: [],
  bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
  columns: 0,
  notes: [],
  mentions: [],
};
