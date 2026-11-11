import { expect, test } from "vitest";
import type { OfficeSnapshot } from "../../shared/contracts.js";
import { EMPTY_LAYOUT_MEMORY, VIEW_TURN, layoutOffice, type Point } from "../layout.js";
import { buildOfficeModel } from "../model.js";
import {
  CAMERA_BACK,
  CAMERA_HEIGHT,
  CAMERA_TILT,
  FIRST_VIEW,
  FOCUS_ZOOM,
  GROUND_SCALE,
  RISE_SCALE,
  VIEW_HEIGHT,
  ZOOM_MAX,
  ZOOM_MIN,
  cameraPosition,
  easeView,
  focusOn,
  frameBounds,
  firstView,
  frustumFor,
  groundSpan,
  panBy,
  pixelRatioFor,
  pixelsPerUnit,
  screenPoint,
  shiftOnScreen,
  wheelFactor,
  zoomBy,
  type CameraView,
  type FrameMargins,
  type GroundSpan,
  type Viewport,
} from "./camera.js";

const SIN = Math.sin(VIEW_TURN);
const COS = Math.cos(VIEW_TURN);
const BOUNDS = { minX: -8, maxX: 8, minZ: -7.5, maxZ: 7.5 };
/** What the turned camera sees of BOUNDS: how wide across the screen, how deep down it. */
const ACROSS = 16 * COS + 15 * SIN;
const DEEP = 16 * SIN + 15 * COS;
const SPAN = groundSpan([BOUNDS]);
const PHONE: Viewport = { width: 390, height: 844 };
const DESKTOP: Viewport = { width: 1440, height: 900 };
const NO_MARGINS: FrameMargins = { rise: 0, top: 0, side: 0, bottom: 0 };

/** The ground point `across` to the right of the screen and `toward` the camera from the origin. */
function ground(across: number, toward: number): Point {
  return { x: across * COS + toward * SIN, z: toward * COS - across * SIN };
}

function drawn(view: CameraView, viewport: Viewport, point: Point, height = 0) {
  return screenPoint(view, viewport, { x: point.x, y: height, z: point.z });
}

function span(width: number, depth: number): GroundSpan {
  return { left: -width / 2, right: width / 2, far: 0, near: depth };
}

test("pixel ratio is capped at 1.5 on touch and 2 elsewhere", () => {
  expect(pixelRatioFor(3, true)).toBe(1.5);
  expect(pixelRatioFor(3, false)).toBe(2);
  expect(pixelRatioFor(1, true)).toBe(1);
});

test("the frustum keeps the viewport's aspect", () => {
  expect(frustumFor({ width: 800, height: 400 })).toEqual({
    left: -VIEW_HEIGHT,
    right: VIEW_HEIGHT,
    top: VIEW_HEIGHT / 2,
    bottom: -VIEW_HEIGHT / 2,
  });
});

test("the camera stands above the point it looks at, back from it and round to the right", () => {
  expect(VIEW_TURN).toBeGreaterThan(0);
  expect(cameraPosition({ x: 3, z: 4, zoom: 1 })).toEqual({
    x: 3 + CAMERA_BACK * SIN,
    y: CAMERA_HEIGHT,
    z: 4 + CAMERA_BACK * COS,
  });
  expect(CAMERA_HEIGHT / CAMERA_BACK).toBeCloseTo(Math.tan(CAMERA_TILT), 9);
  expect(GROUND_SCALE).toBeCloseTo(1 / Math.sin(CAMERA_TILT), 9);
  expect(RISE_SCALE).toBeCloseTo(1 / Math.cos(CAMERA_TILT), 9);
});

test("a world point lands on the pixel it is drawn at", () => {
  const view = { x: 2, z: 3, zoom: 0.5 };
  const perUnit = (844 * 0.5) / VIEW_HEIGHT;
  expect(pixelsPerUnit(view, PHONE)).toBe(perUnit);
  expect(screenPoint(view, PHONE, { x: 2, y: 0, z: 3 })).toEqual({ x: 195, y: 422 });
  // One unit to the camera's right is one unit across the screen, at the same height on it.
  const right = screenPoint(view, PHONE, { x: 2 + COS, y: 0, z: 3 - SIN });
  expect(right.x).toBeCloseTo(195 + perUnit, 9);
  expect(right.y).toBeCloseTo(422, 9);
  // Towards the camera is down the screen, by 1 / GROUND_SCALE of the distance.
  const nearer = screenPoint(view, PHONE, {
    x: 2 + SIN * GROUND_SCALE,
    y: 0,
    z: 3 + COS * GROUND_SCALE,
  });
  expect(nearer.x).toBeCloseTo(195, 9);
  expect(nearer.y).toBeCloseTo(422 + perUnit, 9);
  // Height is up the screen, shortened by the camera looking down.
  const raised = screenPoint(view, PHONE, { x: 2, y: RISE_SCALE, z: 3 });
  expect(raised.x).toBeCloseTo(195, 9);
  expect(raised.y).toBeCloseTo(422 - perUnit, 9);
});

test("rooms in one column are drawn one under the other, and the columns start level", () => {
  const state: OfficeSnapshot = {
    agents: [],
    workspaces: ["w1", "w2", "w3"].map((id) => ({ id, name: id, projectName: "p" })),
    activity: {},
    boards: {},
    wake: { paused: false, queued: {} },
  };
  const { layout } = layoutOffice(buildOfficeModel(state), EMPTY_LAYOUT_MEMORY, 2);
  const view = { x: 0, z: 0, zoom: 1 };
  const backs = new Map(
    layout.rooms.map((room) => [
      `${room.cell.gx},${room.cell.gz}`,
      drawn(view, PHONE, { x: room.center.x, z: room.center.z - room.depth / 2 }),
    ]),
  );
  const at = (key: string) => backs.get(key) ?? { x: Number.NaN, y: Number.NaN };
  expect(at("0,1").x).toBeCloseTo(at("0,0").x, 9);
  expect(at("1,1").x).toBeCloseTo(at("1,0").x, 9);
  expect(at("1,0").y).toBeCloseTo(at("0,0").y, 9);
  expect(at("1,0").x).toBeGreaterThan(at("0,0").x);
  expect(at("0,1").y).toBeGreaterThan(at("0,0").y);
});

test("what the camera sees of a box is its corners' reach across and down the screen", () => {
  const seen = groundSpan([BOUNDS]);
  expect(seen.left).toBeCloseTo(-ACROSS / 2, 9);
  expect(seen.right).toBeCloseTo(ACROSS / 2, 9);
  expect(seen.far).toBeCloseTo(-DEEP / 2, 9);
  expect(seen.near).toBeCloseTo(DEEP / 2, 9);
  const moved = { minX: 92, maxX: 108, minZ: -7.5, maxZ: 7.5 };
  const both = groundSpan([BOUNDS, moved]);
  expect(both.left).toBeCloseTo(seen.left, 9);
  expect(both.right).toBeCloseTo(seen.right + 100 * COS, 9);
  expect(both.near).toBeCloseTo(seen.near + 100 * SIN, 9);
});

test("boxes that are no boxes are left out, and no box at all is a point at the origin", () => {
  const empty = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const notANumber = { minX: Number.NaN, maxX: 5, minZ: 0, maxZ: 5 };
  const nothing = { left: 0, right: 0, far: 0, near: 0 };
  expect(groundSpan([])).toEqual(nothing);
  expect(groundSpan([empty, notANumber])).toEqual(nothing);
  expect(groundSpan([empty, BOUNDS])).toEqual(SPAN);
});

test("framing fits a box into a phone screen, centred", () => {
  const view = frameBounds(BOUNDS, PHONE);
  expect([view.x, view.z]).toEqual([0, 0]);
  expect(view.zoom).toBeCloseTo((VIEW_HEIGHT * (390 / 844)) / ACROSS, 6);
  const wide = frameBounds(BOUNDS, DESKTOP);
  expect([wide.x, wide.z]).toEqual([0, 0]);
  expect(wide.zoom).toBeCloseTo((VIEW_HEIGHT * GROUND_SCALE) / DEEP, 6);
  expect(frameBounds({ minX: -500, maxX: 500, minZ: -500, maxZ: 500 }, PHONE).zoom).toBe(ZOOM_MIN);
  const off = frameBounds({ minX: 10, maxX: 30, minZ: 5, maxZ: 9 }, PHONE);
  expect(off.x).toBeCloseTo(20, 9);
  expect(off.z).toBeCloseTo(7, 9);
});

test("dragging moves the office with the finger", () => {
  const start = { x: 0, z: 0, zoom: 1 };
  const point = ground(3, -2);
  const before = drawn(start, PHONE, point);
  const sideways = drawn(panBy(start, 100, 0, PHONE, SPAN), PHONE, point);
  expect(sideways.x).toBeCloseTo(before.x + 100, 9);
  expect(sideways.y).toBeCloseTo(before.y, 9);
  const down = drawn(panBy(start, 0, 40, PHONE, SPAN), PHONE, point);
  expect(down.x).toBeCloseTo(before.x, 9);
  expect(down.y).toBeCloseTo(before.y + 40, 9);
});

test("the camera stays over the office: a drag too far stops at the edge the camera sees", () => {
  const moved = panBy({ x: 0, z: 0, zoom: 1 }, -1000, 1000, PHONE, SPAN);
  // The far right corner of what the camera sees.
  const corner = ground(ACROSS / 2, -DEEP / 2);
  expect(moved.x).toBeCloseTo(corner.x, 9);
  expect(moved.z).toBeCloseTo(corner.z, 9);
  expect(moved.zoom).toBe(1);
});

test("zoomed in, the same drag moves the office less", () => {
  const wide = { left: -100, right: 100, far: -100, near: 100 };
  const far = panBy({ x: 0, z: 0, zoom: 1 }, 100, 40, PHONE, wide);
  const close = panBy({ x: 0, z: 0, zoom: 2 }, 100, 40, PHONE, wide);
  expect(close.x).toBeCloseTo(far.x / 2, 9);
  expect(close.z).toBeCloseTo(far.z / 2, 9);
  expect(close.zoom).toBe(2);
});

test("an office with no rooms frames and pans to finite numbers", () => {
  const empty = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  expect(frameBounds(empty, PHONE)).toEqual({ x: 0, z: 0, zoom: ZOOM_MAX });
  expect(panBy({ x: 3, z: 4, zoom: 1 }, 10, 10, PHONE, groundSpan([empty]))).toEqual({
    x: 0,
    z: 0,
    zoom: 1,
  });
  const notANumber = { minX: Number.NaN, maxX: 5, minZ: 0, maxZ: 5 };
  expect(frameBounds(notANumber, PHONE)).toEqual({ x: 0, z: 0, zoom: ZOOM_MAX });
  expect(firstView(groundSpan([]), PHONE, NO_MARGINS)).toEqual({
    x: 0,
    z: 0,
    zoom: (FIRST_VIEW.most * VIEW_HEIGHT) / 844,
  });
});

test("a zero-size viewport gives a finite view with no negative zero", () => {
  const none = { width: 0, height: 0 };
  expect(frustumFor(none)).toEqual({
    left: -VIEW_HEIGHT / 2,
    right: VIEW_HEIGHT / 2,
    top: VIEW_HEIGHT / 2,
    bottom: -VIEW_HEIGHT / 2,
  });
  expect(frameBounds(BOUNDS, none)).toEqual({ x: 0, z: 0, zoom: VIEW_HEIGHT / ACROSS });
  expect(panBy({ x: 0, z: 0, zoom: 1 }, 0, 0, none, SPAN)).toEqual({ x: 0, z: 0, zoom: 1 });
  const first = firstView(SPAN, none, NO_MARGINS);
  expect([first.x, first.z, first.zoom].every(Number.isFinite)).toBe(true);
});

test("zoom stays within its limits; a wheel step up zooms out", () => {
  expect(zoomBy({ x: 0, z: 0, zoom: 2 }, 10).zoom).toBe(ZOOM_MAX);
  expect(zoomBy({ x: 0, z: 0, zoom: 1 }, 0.01).zoom).toBe(ZOOM_MIN);
  expect(wheelFactor(100)).toBeLessThan(1);
  expect(wheelFactor(-100)).toBeGreaterThan(1);
  expect(wheelFactor(0)).toBe(1);
});

test("focusing centres the point and zooms in, never out", () => {
  expect(focusOn({ x: 0, z: 0, zoom: 1 }, { x: 15, z: 14 })).toEqual({
    x: 15,
    z: 14,
    zoom: FOCUS_ZOOM,
  });
  expect(focusOn({ x: 0, z: 0, zoom: 2.5 }, { x: 15, z: 14 }).zoom).toBe(2.5);
});

test("easing starts at the old view, ends at the new one, and is half-way in the middle", () => {
  const from = { x: 0, z: 0, zoom: 1 };
  const to = { x: 10, z: -4, zoom: 2 };
  expect(easeView(from, to, 0)).toEqual(from);
  expect(easeView(from, to, 1)).toEqual(to);
  expect(easeView(from, to, 0.5)).toEqual({ x: 5, z: -2, zoom: 1.5 });
  expect(easeView(from, to, 3)).toEqual(to);
});

test("easing ends exactly on the target view", () => {
  const from = { x: 0.1, z: 0.3, zoom: 0.35 };
  const to = { x: 0.7, z: -0.1, zoom: 2.9 };
  expect(easeView(from, to, 1)).toEqual(to);
});

test("dragging a point to the middle of the screen makes it the point the camera looks at", () => {
  const view = { x: 2, z: 3, zoom: 0.5 };
  const wide = { left: -50, right: 50, far: -50, near: 50 };
  const at = screenPoint(view, PHONE, { x: 5, y: 0, z: -4 });
  const moved = panBy(view, 195 - at.x, 422 - at.y, PHONE, wide);
  expect(moved.x).toBeCloseTo(5, 9);
  expect(moved.z).toBeCloseTo(-4, 9);
});

test("a point shifted on screen is drawn that many pixels away", () => {
  const view = { x: 2, z: 3, zoom: 0.5 };
  const point = { x: 6, y: 1.2, z: -1 };
  const before = screenPoint(view, PHONE, point);
  const after = screenPoint(view, PHONE, shiftOnScreen(view, PHONE, point, 7.5, -3));
  expect(after.x).toBeCloseTo(before.x + 7.5, 9);
  expect(after.y).toBeCloseTo(before.y - 3, 9);
});

test("the first view shows an office that fits whole, in the middle, as large as it goes", () => {
  // 16 wide and 20 deep: the width of a phone decides.
  const view = firstView(span(16, 20), PHONE, NO_MARGINS);
  expect(pixelsPerUnit(view, PHONE)).toBeCloseTo(390 / 16, 9);
  expect(drawn(view, PHONE, ground(-8, 0)).x).toBeCloseTo(0, 6);
  expect(drawn(view, PHONE, ground(8, 0)).x).toBeCloseTo(390, 6);
  const top = drawn(view, PHONE, ground(0, 0)).y;
  const bottom = drawn(view, PHONE, ground(0, 20)).y;
  expect(top).toBeGreaterThan(0);
  expect(top).toBeCloseTo(844 - bottom, 6);
});

test("the first view does not blow a small office up", () => {
  const view = firstView(span(13, 6), DESKTOP, NO_MARGINS);
  expect(pixelsPerUnit(view, DESKTOP)).toBeCloseTo(FIRST_VIEW.most, 9);
  const middle = drawn(view, DESKTOP, ground(0, 3));
  expect(middle.x).toBeCloseTo(720, 6);
  expect(middle.y).toBeCloseTo(450, 6);
});

test("an office too deep for legible robots fills the width and starts at the top", () => {
  // 60 units down the screen: whole, it would be drawn at 844 / 60 px a unit, under legible.
  const deep = span(16, 60 * GROUND_SCALE);
  expect(844 / 60).toBeLessThan(FIRST_VIEW.legible);
  const view = firstView(deep, PHONE, NO_MARGINS);
  expect(pixelsPerUnit(view, PHONE)).toBeCloseTo(390 / 16, 9);
  expect(drawn(view, PHONE, ground(0, 0)).y).toBeCloseTo(0, 6);
  expect(drawn(view, PHONE, ground(0, 60 * GROUND_SCALE)).y).toBeGreaterThan(844);
  // 38 units down the screen still fit at a legible size, though that leaves room at the sides.
  const fits = firstView(span(16, 38 * GROUND_SCALE), PHONE, NO_MARGINS);
  expect(844 / 38).toBeGreaterThan(FIRST_VIEW.legible);
  expect(pixelsPerUnit(fits, PHONE)).toBeCloseTo(844 / 38, 9);
  expect(drawn(fits, PHONE, ground(0, 0)).y).toBeCloseTo(0, 6);
  expect(drawn(fits, PHONE, ground(0, 38 * GROUND_SCALE)).y).toBeCloseTo(844, 6);
});

test("a deep office in a wide view is not drawn larger than a first look can take in", () => {
  const view = firstView(span(16, 300), { width: 820, height: 1180 }, NO_MARGINS);
  expect(pixelsPerUnit(view, { width: 820, height: 1180 })).toBeCloseTo(FIRST_VIEW.partial, 9);
});

test("the first view keeps its margins clear, and room for what stands on the far edge", () => {
  const margins: FrameMargins = { rise: 2, top: 30, side: 10, bottom: 14 };
  const deep = firstView(span(16, 70 * GROUND_SCALE), PHONE, margins);
  expect(pixelsPerUnit(deep, PHONE)).toBeCloseTo(370 / 16, 9);
  expect(drawn(deep, PHONE, ground(-8, 0)).x).toBeCloseTo(10, 6);
  // The top of a wall 2 high on the far edge is drawn where the top margin ends.
  expect(drawn(deep, PHONE, ground(0, 0), 2).y).toBeCloseTo(30, 6);
  const whole = firstView(span(16, 20), PHONE, margins);
  const above = drawn(whole, PHONE, ground(0, 0), 2).y - 30;
  const below = 844 - 14 - drawn(whole, PHONE, ground(0, 20)).y;
  expect(above).toBeGreaterThan(0);
  expect(above).toBeCloseTo(below, 6);
});
