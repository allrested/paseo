import { expect, test } from "vitest";
import type { Bounds } from "../layout.js";
import {
  CAMERA_BACK,
  CAMERA_HEIGHT,
  panBy,
  pixelsPerUnit,
  screenPoint,
  zoomBy,
  type CameraView,
  type ScreenPoint,
  type Viewport,
} from "./camera.js";
import {
  labelUnder,
  robotNear,
  targetAt,
  zoomAbout,
  type Plate,
  type RobotSpot,
  type Screen,
  type WorldPoint,
} from "./picking.js";

const PHONE: Viewport = { width: 390, height: 844 };
const VIEW: CameraView = { x: 0, z: 0, zoom: 1 };
const SCREEN: Screen = { view: VIEW, viewport: PHONE };
/** Wide enough that no pan in these tests is clamped. */
const OPEN: Bounds = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };
const NO_PLATES: ReadonlyMap<string, Plate> = new Map();

function offset(at: ScreenPoint, dx: number, dy: number): ScreenPoint {
  return { x: at.x + dx, y: at.y + dy };
}

/** The ground point (height 0) drawn at `at` by `screen`: the inverse of `screenPoint`. */
function groundAt(screen: Screen, at: ScreenPoint): WorldPoint {
  const perUnit = pixelsPerUnit(screen.view, screen.viewport);
  const reach = Math.hypot(CAMERA_HEIGHT, CAMERA_BACK);
  return {
    x: screen.view.x + (at.x - screen.viewport.width / 2) / perUnit,
    y: 0,
    z: screen.view.z + ((at.y - screen.viewport.height / 2) / perUnit) * (reach / CAMERA_HEIGHT),
  };
}

function robotAt(agentId: string, at: ScreenPoint): RobotSpot {
  return { agentId, chest: groundAt(SCREEN, at) };
}

/** A 60 x 20 plate whose left edge, at mid height, is drawn at `left`. */
function plateAt(left: ScreenPoint): ReadonlyMap<string, Plate> {
  return new Map([["w-main", { anchor: groundAt(SCREEN, left), width: 60, height: 20 }]]);
}

const TAP: ScreenPoint = { x: 200, y: 500 };
const ROBOT: RobotSpot = { agentId: "robot", chest: { x: 2, y: 1, z: 1 } };

test("a tap on a robot picks it", () => {
  const at = screenPoint(VIEW, PHONE, ROBOT.chest);
  expect(targetAt(SCREEN, NO_PLATES, [ROBOT], at)).toEqual({ agentId: "robot" });
});

test("a tap 22 px from a robot picks it, 23 px picks nothing", () => {
  const robots = [robotAt("robot", TAP)];
  expect(robotNear(SCREEN, robots, offset(TAP, 22, 0))).toBe("robot");
  expect(robotNear(SCREEN, robots, offset(TAP, 23, 0))).toBeNull();
  expect(targetAt(SCREEN, NO_PLATES, robots, offset(TAP, 0, 23))).toBeNull();
});

test("of two robots within reach a tap picks the nearer, whatever their order", () => {
  const near = robotAt("near", TAP);
  const far = robotAt("far", offset(TAP, 14, 0));
  expect(robotNear(SCREEN, [near, far], offset(TAP, 4, 0))).toBe("near");
  expect(robotNear(SCREEN, [far, near], offset(TAP, 4, 0))).toBe("near");
  expect(robotNear(SCREEN, [near, far], offset(TAP, 10, 0))).toBe("far");
});

test("a tap on a name plate picks its room", () => {
  const named = plateAt(TAP);
  expect(labelUnder(SCREEN, named, offset(TAP, 30, 0), 0)).toBe("w-main");
  expect(labelUnder(SCREEN, named, offset(TAP, 59, 9), 0)).toBe("w-main");
  expect(labelUnder(SCREEN, named, offset(TAP, 61, 0), 0)).toBeNull();
  expect(labelUnder(SCREEN, named, offset(TAP, 30, 11), 0)).toBeNull();
  expect(targetAt(SCREEN, named, [], offset(TAP, 30, 0))).toEqual({ roomId: "w-main" });
});

test("a plate under the finger wins over a robot right there", () => {
  const named = plateAt(offset(TAP, -14, 0));
  expect(targetAt(SCREEN, named, [robotAt("robot", TAP)], TAP)).toEqual({ roomId: "w-main" });
});

test("a plate within 12 px of the finger loses to a robot in reach, and wins over nothing", () => {
  // The plate's lower edge is 5 px above the tap.
  const named = plateAt(offset(TAP, -14, -15));
  expect(targetAt(SCREEN, named, [robotAt("robot", offset(TAP, 0, 20))], TAP)).toEqual({
    agentId: "robot",
  });
  expect(targetAt(SCREEN, named, [], TAP)).toEqual({ roomId: "w-main" });
  // 13 px below the edge is out of the plate's reach.
  expect(targetAt(SCREEN, plateAt(offset(TAP, -14, -23)), [], TAP)).toBeNull();
});

test("after a pan a tap picks the robot where it is drawn now", () => {
  const panned = panBy(VIEW, -80, 40, PHONE, OPEN);
  const screen: Screen = { view: panned, viewport: PHONE };
  const before = screenPoint(VIEW, PHONE, ROBOT.chest);
  const after = screenPoint(panned, PHONE, ROBOT.chest);
  expect(after.x).toBeCloseTo(before.x - 80, 6);
  expect(after.y).toBeCloseTo(before.y + 40, 6);
  expect(targetAt(screen, NO_PLATES, [ROBOT], after)).toEqual({ agentId: "robot" });
  expect(targetAt(screen, NO_PLATES, [ROBOT], before)).toBeNull();
});

test("after a zoom a tap picks the robot where it is drawn now", () => {
  const zoomed = zoomBy(VIEW, 2);
  const screen: Screen = { view: zoomed, viewport: PHONE };
  const before = screenPoint(VIEW, PHONE, ROBOT.chest);
  const after = screenPoint(zoomed, PHONE, ROBOT.chest);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(23);
  expect(targetAt(screen, NO_PLATES, [ROBOT], after)).toEqual({ agentId: "robot" });
  expect(targetAt(screen, NO_PLATES, [ROBOT], before)).toBeNull();
});

test("zooming about a point keeps the ground under it where it is on screen", () => {
  const ground: WorldPoint = { x: 4, y: 0, z: -3 };
  const at = screenPoint(VIEW, PHONE, ground);
  const zoomed = zoomAbout(VIEW, 1.5, at, PHONE, OPEN);
  expect(zoomed.zoom).toBeCloseTo(1.5, 9);
  const after = screenPoint(zoomed, PHONE, ground);
  expect(after.x).toBeCloseTo(at.x, 6);
  expect(after.y).toBeCloseTo(at.y, 6);
});

test("a zoom already at its limit does not move the camera", () => {
  const atMax: CameraView = { x: 1, z: 2, zoom: 3 };
  expect(zoomAbout(atMax, 2, { x: 10, y: 10 }, PHONE, OPEN)).toEqual(atMax);
});
