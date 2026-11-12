import { expect, test } from "vitest";
import type { OfficeAgent, OfficeSnapshot } from "../../shared/contracts.js";
import {
  EMPTY_LAYOUT_MEMORY,
  ROOM_WIDTH,
  VIEW_TURN,
  layoutOffice,
  type Bounds,
  type Point,
} from "../layout.js";
import { buildOfficeModel } from "../model.js";
import {
  CAMERA_BACK,
  CAMERA_HEIGHT,
  CAMERA_TILT,
  FIRST_VIEW,
  FOCUS_SCALE,
  GROUND_SCALE,
  RISE_SCALE,
  SCALE_LIMITS,
  VIEW_HEIGHT,
  cameraPosition,
  easeView,
  focusOn,
  firstView,
  frustumFor,
  groundSpan,
  keptInside,
  keptOver,
  panBy,
  partView,
  pixelRatioFor,
  pixelsPerUnit,
  screenPoint,
  shiftOnScreen,
  wheelFactor,
  zoomBy,
  zoomLimits,
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
/** A phone on its side, under the app's header and the office's own. */
const SHORT: Viewport = { width: 844, height: 200 };
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

/** A robot from the floor to the top of its head, in world units (office-scene.web.ts ROBOT). */
const ROBOT_HEIGHT = 1.68;
/** Margins like the scene's own: a whiteboard on the far edge, and a few pixels at each side. */
const MARGINS: FrameMargins = { rise: 2.2, top: 10, side: 8, bottom: 12 };

function resident(id: string, workspaceId: string | null): OfficeAgent {
  return {
    id,
    title: id,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId,
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-11T08:00:00.000Z",
  };
}

/**
 * The floors of an office laid out as the office is: the lobby with `crews[0]` agents, then one
 * room for each further entry, with that many agents.
 */
function floors(crews: readonly number[], columns: number): Bounds[] {
  const state: OfficeSnapshot = {
    agents: crews.flatMap((count, room) =>
      Array.from({ length: count }, (_, index) =>
        resident(`r${room}-${index}`, room === 0 ? null : `w${room}`),
      ),
    ),
    workspaces: crews.slice(1).map((_, index) => ({
      id: `w${index + 1}`,
      name: `w${index + 1}`,
      projectName: "p",
    })),
    activity: {},
    boards: {},
    wake: { paused: false, queued: {} },
  };
  const { layout } = layoutOffice(buildOfficeModel(state), EMPTY_LAYOUT_MEMORY, columns);
  return layout.rooms.map((room) => ({
    minX: room.center.x - ROOM_WIDTH / 2,
    maxX: room.center.x + ROOM_WIDTH / 2,
    minZ: room.center.z - room.depth / 2,
    maxZ: room.center.z + room.depth / 2,
  }));
}

function column(crews: readonly number[]): Bounds[] {
  return floors(crews, 1);
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

test("a part framed alone fits a phone screen, in the middle", () => {
  const view = partView(SPAN, SPAN, PHONE, NO_MARGINS);
  expect(view.x).toBeCloseTo(0, 9);
  expect(view.z).toBeCloseTo(0, 9);
  expect(view.zoom).toBeCloseTo((VIEW_HEIGHT * (390 / 844)) / ACROSS, 6);
  // A wide screen has room to draw it larger than a look at a room needs.
  const wide = partView(SPAN, SPAN, DESKTOP, NO_MARGINS);
  expect(wide.x).toBeCloseTo(0, 9);
  expect(wide.z).toBeCloseTo(0, 9);
  expect(pixelsPerUnit(wide, DESKTOP)).toBeCloseTo(FIRST_VIEW.room, 9);
  const huge = groundSpan([{ minX: -500, maxX: 500, minZ: -500, maxZ: 500 }]);
  expect(partView(huge, huge, PHONE, NO_MARGINS).zoom).toBe(zoomLimits(PHONE).min);
  const aside = groundSpan([{ minX: 10, maxX: 30, minZ: 5, maxZ: 9 }]);
  const off = partView(aside, aside, PHONE, NO_MARGINS);
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
  const nothing = groundSpan([empty]);
  const least = { x: 0, z: 0, zoom: (FIRST_VIEW.most * VIEW_HEIGHT) / 844 };
  const leastPart = { x: 0, z: 0, zoom: (FIRST_VIEW.room * VIEW_HEIGHT) / 844 };
  expect(partView(nothing, nothing, PHONE, NO_MARGINS)).toEqual(leastPart);
  expect(panBy({ x: 3, z: 4, zoom: 1 }, 10, 10, PHONE, groundSpan([empty]))).toEqual({
    x: 0,
    z: 0,
    zoom: 1,
  });
  const notANumber = groundSpan([{ minX: Number.NaN, maxX: 5, minZ: 0, maxZ: 5 }]);
  expect(partView(notANumber, notANumber, PHONE, NO_MARGINS)).toEqual(leastPart);
  expect(firstView(groundSpan([]), PHONE, NO_MARGINS)).toEqual(least);
});

test("a zero-size viewport gives a finite view with no negative zero", () => {
  const none = { width: 0, height: 0 };
  expect(frustumFor(none)).toEqual({
    left: -VIEW_HEIGHT / 2,
    right: VIEW_HEIGHT / 2,
    top: VIEW_HEIGHT / 2,
    bottom: -VIEW_HEIGHT / 2,
  });
  expect(panBy({ x: 0, z: 0, zoom: 1 }, 0, 0, none, SPAN)).toEqual({ x: 0, z: 0, zoom: 1 });
  for (const view of [firstView(SPAN, none, NO_MARGINS), partView(SPAN, SPAN, none, NO_MARGINS)]) {
    expect([view.x, view.z, view.zoom].every(Number.isFinite)).toBe(true);
    expect([view.x, view.z].some((value) => Object.is(value, -0))).toBe(false);
  }
});

test("zoom stays within its limits; a wheel step up zooms out", () => {
  expect(zoomBy({ x: 0, z: 0, zoom: 2 }, 10, PHONE).zoom).toBe(zoomLimits(PHONE).max);
  expect(zoomBy({ x: 0, z: 0, zoom: 1 }, 0.01, PHONE).zoom).toBe(zoomLimits(PHONE).min);
  expect(zoomBy({ x: 0, z: 0, zoom: 1 }, 1.5, PHONE).zoom).toBe(1.5);
  expect(wheelFactor(100)).toBeLessThan(1);
  expect(wheelFactor(-100)).toBeGreaterThan(1);
  expect(wheelFactor(0)).toBe(1);
});

test("focusing centres the point and zooms in, never out", () => {
  const near = focusOn({ x: 0, z: 0, zoom: 1 }, { x: 15, z: 14 }, PHONE);
  expect([near.x, near.z]).toEqual([15, 14]);
  expect(pixelsPerUnit(near, PHONE)).toBeCloseTo(FOCUS_SCALE, 9);
  expect(focusOn({ x: 0, z: 0, zoom: 2.5 }, { x: 15, z: 14 }, PHONE).zoom).toBe(2.5);
  // The same size on a short screen, where the same zoom would be a quarter of it.
  expect(
    pixelsPerUnit(focusOn({ x: 0, z: 0, zoom: 1 }, { x: 15, z: 14 }, SHORT), SHORT),
  ).toBeCloseTo(FOCUS_SCALE, 9);
});

test("the closest and the farthest view are sizes on screen, the same on every screen", () => {
  const start = { x: 0, z: 0, zoom: 1 };
  for (const viewport of [PHONE, SHORT, DESKTOP]) {
    expect(pixelsPerUnit(zoomBy(start, 1e6, viewport), viewport)).toBeCloseTo(SCALE_LIMITS.max, 9);
    expect(pixelsPerUnit(zoomBy(start, 1e-6, viewport), viewport)).toBeCloseTo(SCALE_LIMITS.min, 9);
  }
  expect(zoomLimits({ width: 0, height: 0 }).max).toBe(SCALE_LIMITS.max * VIEW_HEIGHT);
});

test("a robot is at least 28 px tall at first view on a phone on its side", () => {
  const tall = ROBOT_HEIGHT / RISE_SCALE;
  for (const crews of [[0], [0, 0, 0], [1, 5, 1, 1, 9]]) {
    const view = firstView(groundSpan(floors(crews, 2)), SHORT, MARGINS);
    expect(pixelsPerUnit(view, SHORT) * tall).toBeGreaterThanOrEqual(28);
  }
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

test("a robot is at least 28 px tall at first view on a phone, whatever the office", () => {
  const tall = ROBOT_HEIGHT / RISE_SCALE;
  expect(FIRST_VIEW.legible * tall).toBeGreaterThanOrEqual(28);
  // One, three, five and eight rooms of one row, then five rooms of one, two, one, one and three
  // rows: whole, that last office is drawn at about 21 px a unit.
  const offices = [[0], [0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0], [1, 5, 1, 1, 9]];
  for (const crews of offices) {
    const view = firstView(groundSpan(column(crews)), PHONE, MARGINS);
    expect(pixelsPerUnit(view, PHONE) * tall).toBeGreaterThanOrEqual(28);
  }
});

test("a view kept inside an office deeper than the screen stops at its two ends", () => {
  const deep = span(16, 200);
  const perUnit = 20;
  const zoom = (perUnit * VIEW_HEIGHT) / 844;
  const margins: FrameMargins = { rise: 2, top: 30, side: 10, bottom: 14 };
  const above = keptInside({ ...ground(0, -80), zoom }, deep, PHONE, margins);
  expect(above.zoom).toBe(zoom);
  // What stands 2 high on the far edge is drawn where the top margin ends.
  expect(drawn(above, PHONE, ground(0, 0), 2).y).toBeCloseTo(30, 6);
  const below = keptInside({ ...ground(0, 500), zoom }, deep, PHONE, margins);
  expect(drawn(below, PHONE, ground(0, 200)).y).toBeCloseTo(844 - 14, 6);
  // 16 units at 20 px are narrower than the screen: the office stays in the middle of it.
  const aside = keptInside({ ...ground(40, 100), zoom }, deep, PHONE, margins);
  expect(drawn(aside, PHONE, ground(0, 100)).x).toBeCloseTo(195, 6);
});

test("a view kept inside an office wider than the screen stops at its two sides", () => {
  const wide = span(60, 200);
  const zoom = (20 * VIEW_HEIGHT) / 844;
  const margins: FrameMargins = { rise: 0, top: 0, side: 10, bottom: 0 };
  const left = keptInside({ ...ground(-100, 100), zoom }, wide, PHONE, margins);
  expect(drawn(left, PHONE, ground(-30, 100)).x).toBeCloseTo(10, 6);
  const right = keptInside({ ...ground(100, 100), zoom }, wide, PHONE, margins);
  expect(drawn(right, PHONE, ground(30, 100)).x).toBeCloseTo(380, 6);
});

test("a view that is inside the office already is returned as it is", () => {
  const view = { ...ground(3, 90), zoom: (20 * VIEW_HEIGHT) / 844 };
  expect(keptInside(view, span(60, 200), PHONE, MARGINS)).toBe(view);
});

test("an office smaller than the screen is kept in the middle, as its first view shows it", () => {
  const small = span(16, 20);
  const first = firstView(small, PHONE, MARGINS);
  const kept = keptInside({ ...ground(5, 14), zoom: first.zoom }, small, PHONE, MARGINS);
  expect(kept.x).toBeCloseTo(first.x, 9);
  expect(kept.z).toBeCloseTo(first.z, 9);
  expect(kept.zoom).toBe(first.zoom);
});

test("a view with no size or no office to stay inside is kept finite", () => {
  const none = { width: 0, height: 0 };
  const kept = keptInside({ x: 3, z: 4, zoom: 1 }, groundSpan([]), none, MARGINS);
  expect([kept.x, kept.z, kept.zoom].every(Number.isFinite)).toBe(true);
});

test("a focused room fills the width of a phone", () => {
  const rooms = column([1, 1, 1, 1, 9]);
  const office = groundSpan(rooms);
  // The third of five: far enough from both ends to stand in the middle of the screen.
  const room = groundSpan(rooms.slice(2, 3));
  const view = partView(room, office, PHONE, MARGINS);
  expect(pixelsPerUnit(view, PHONE)).toBeCloseTo((390 - 16) / (room.right - room.left), 9);
  // Larger than the whole office is at first, where the deepest room sets the scale.
  expect(view.zoom).toBeGreaterThan(firstView(office, PHONE, MARGINS).zoom * 1.2);
  expect(drawn(view, PHONE, ground(room.left, room.far)).x).toBeCloseTo(8, 6);
  expect(drawn(view, PHONE, ground(room.right, room.far)).x).toBeCloseTo(382, 6);
  // As much room above its whiteboard as below its front wall.
  const above = drawn(view, PHONE, ground(0, room.far), MARGINS.rise).y - MARGINS.top;
  const below = 844 - MARGINS.bottom - drawn(view, PHONE, ground(0, room.near)).y;
  expect(above).toBeCloseTo(below, 6);
});

test("a focused room fills the width of a tablet held upright", () => {
  const upright: Viewport = { width: 820, height: 1000 };
  const rooms = column([1, 1, 1, 1, 1]);
  const office = groundSpan(rooms);
  const room = groundSpan(rooms.slice(2, 3));
  const view = partView(room, office, upright, MARGINS);
  // 59 px a unit: closer than an office comes at first (FIRST_VIEW.most), which stops at 44.
  expect(pixelsPerUnit(view, upright)).toBeCloseTo((820 - 16) / (room.right - room.left), 9);
  expect(pixelsPerUnit(view, upright)).toBeGreaterThan(FIRST_VIEW.most);
  expect(drawn(view, upright, ground(room.left, room.far)).x).toBeCloseTo(8, 6);
  expect(drawn(view, upright, ground(room.right, room.far)).x).toBeCloseTo(812, 6);
});

test("a focused room on a wide screen comes no closer than a room is shown at most", () => {
  const rooms = column([1, 1, 1]);
  const room = groundSpan(rooms.slice(1, 2));
  const view = partView(room, groundSpan(rooms), DESKTOP, MARGINS);
  expect(pixelsPerUnit(view, DESKTOP)).toBeCloseTo(FIRST_VIEW.room, 9);
  // An office of that one room alone is still shown no larger than `most`.
  expect(pixelsPerUnit(firstView(room, DESKTOP, MARGINS), DESKTOP)).toBeCloseTo(FIRST_VIEW.most, 9);
});

test("a focused room at the end of an office is not shown under empty ground", () => {
  const rooms = column([1, 1, 1, 1, 1, 1, 1, 1]);
  const office = groundSpan(rooms);
  const first = partView(groundSpan(rooms.slice(0, 1)), office, PHONE, MARGINS);
  // The office's far edge, with what stands on it, starts where the top margin ends.
  expect(drawn(first, PHONE, ground(0, office.far), MARGINS.rise).y).toBeCloseTo(MARGINS.top, 6);
  const last = partView(groundSpan(rooms.slice(7)), office, PHONE, MARGINS);
  expect(drawn(last, PHONE, ground(0, office.near)).y).toBeCloseTo(844 - MARGINS.bottom, 6);
});

test("a view left outside an office that shrank comes back over it, and one over it stays", () => {
  const small = span(16, 20);
  const outside = { ...ground(3, 60), zoom: 1.4 };
  const back = keptOver(outside, small);
  const edge = ground(3, 20);
  expect(back.x).toBeCloseTo(edge.x, 9);
  expect(back.z).toBeCloseTo(edge.z, 9);
  expect(back.zoom).toBe(1.4);
  const inside = { ...ground(3, 12), zoom: 1.4 };
  expect(keptOver(inside, small)).toBe(inside);
});
