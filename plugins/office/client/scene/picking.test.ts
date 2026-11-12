import { expect, test } from "vitest";
import { VIEW_TURN } from "../layout.js";
import {
  GROUND_SCALE,
  panBy,
  pixelsPerUnit,
  screenPoint,
  zoomBy,
  zoomLimits,
  type CameraView,
  type GroundSpan,
  type ScreenPoint,
  type Viewport,
} from "./camera.js";
import {
  boardUnder,
  canvasPoint,
  labelUnder,
  pinchView,
  robotNear,
  targetAt,
  zoomAbout,
  type BoardFace,
  type NoteSpot,
  type Plate,
  type RobotSpot,
  type Screen,
  type WorldPoint,
} from "./picking.js";

const PHONE: Viewport = { width: 390, height: 844 };
const VIEW: CameraView = { x: 0, z: 0, zoom: 1 };
const SCREEN: Screen = { view: VIEW, viewport: PHONE };
/** Wide enough that no pan in these tests is clamped. */
const OPEN: GroundSpan = { left: -1000, right: 1000, far: -1000, near: 1000 };
const NO_PLATES: ReadonlyMap<string, Plate> = new Map();

function offset(at: ScreenPoint, dx: number, dy: number): ScreenPoint {
  return { x: at.x + dx, y: at.y + dy };
}

/** The ground point (height 0) drawn at `at` by `screen`: the inverse of `screenPoint`. */
function groundAt(screen: Screen, at: ScreenPoint): WorldPoint {
  const perUnit = pixelsPerUnit(screen.view, screen.viewport);
  const across = (at.x - screen.viewport.width / 2) / perUnit;
  const toward = ((at.y - screen.viewport.height / 2) / perUnit) * GROUND_SCALE;
  return {
    x: screen.view.x + across * Math.cos(VIEW_TURN) + toward * Math.sin(VIEW_TURN),
    y: 0,
    z: screen.view.z + toward * Math.cos(VIEW_TURN) - across * Math.sin(VIEW_TURN),
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

/** A whiteboard at the back of a room: 4 by 1.6, its middle 1.3 above the floor. */
const FACE: BoardFace = {
  roomId: "w-main",
  center: { x: 3, y: 1.3, z: -2 },
  width: 4,
  height: 1.6,
};

/** Where the point of the face `dx` right of and `dy` above its middle is drawn. */
function onFace(dx: number, dy: number): ScreenPoint {
  const { x, y, z } = FACE.center;
  return screenPoint(VIEW, PHONE, { x: x + dx, y: y + dy, z });
}

function noteAt(at: ScreenPoint): NoteSpot {
  return { roomId: "w-main", at: groundAt(SCREEN, at) };
}

test("a tap on a whiteboard's face picks its board, up to its edges and not past them", () => {
  const inside = [onFace(0, 0), onFace(-1.95, 0.75), onFace(1.95, 0.75), onFace(-1.95, -0.75)];
  const outside = [onFace(-2.05, 0), onFace(2.05, 0), onFace(0, 0.85), onFace(0, -0.85)];
  expect(inside.map((at) => boardUnder(SCREEN, [FACE], at))).toEqual([
    "w-main",
    "w-main",
    "w-main",
    "w-main",
  ]);
  expect(outside.map((at) => boardUnder(SCREEN, [FACE], at))).toEqual([null, null, null, null]);
  const boards = { faces: [FACE], notes: [] };
  expect(targetAt(SCREEN, NO_PLATES, [], onFace(1, 0.5), boards)).toEqual({ boardId: "w-main" });
  expect(targetAt(SCREEN, NO_PLATES, [], onFace(2.05, 0), boards)).toBeNull();
});

test("the whiteboard is drawn slanted: the corners of the upright box around it are off it", () => {
  // The view is turned, so the face is a parallelogram on screen that falls to the right.
  const [lowLeft, lowRight] = [onFace(-2, -0.8), onFace(2, -0.8)];
  const [highLeft, highRight] = [onFace(-2, 0.8), onFace(2, 0.8)];
  expect(lowRight.y).toBeGreaterThan(lowLeft.y + 4);
  const aboveRight: ScreenPoint = { x: highRight.x - 2, y: highLeft.y + 2 };
  const belowLeft: ScreenPoint = { x: lowLeft.x + 2, y: lowRight.y - 2 };
  expect([aboveRight, belowLeft].map((at) => boardUnder(SCREEN, [FACE], at))).toEqual([null, null]);
  // Just inside the same two edges, it is the board.
  const underTop: ScreenPoint = { x: highRight.x - 2, y: highRight.y + 2 };
  const overBottom: ScreenPoint = { x: lowLeft.x + 2, y: lowLeft.y - 2 };
  expect([underTop, overBottom].map((at) => boardUnder(SCREEN, [FACE], at))).toEqual([
    "w-main",
    "w-main",
  ]);
});

test("a robot within reach wins over the whiteboard behind it", () => {
  const at = onFace(0, 0);
  const boards = { faces: [FACE], notes: [] };
  expect(targetAt(SCREEN, NO_PLATES, [robotAt("robot", offset(at, 10, 0))], at, boards)).toEqual({
    agentId: "robot",
  });
});

test("a plate under the finger wins over the whiteboard; a plate that is only near loses to it", () => {
  const at = onFace(0, 0);
  const boards = { faces: [FACE], notes: [] };
  expect(targetAt(SCREEN, plateAt(offset(at, -14, 0)), [], at, boards)).toEqual({
    roomId: "w-main",
  });
  // The plate's lower edge is 5 px above the tap.
  expect(targetAt(SCREEN, plateAt(offset(at, -14, -15)), [], at, boards)).toEqual({
    boardId: "w-main",
  });
});

test("a tap within 22 px of a note on a desk picks its board; of a note and a robot the nearer wins", () => {
  const boards = { faces: [], notes: [noteAt(TAP)] };
  expect(targetAt(SCREEN, NO_PLATES, [], offset(TAP, 22, 0), boards)).toEqual({
    boardId: "w-main",
  });
  expect(targetAt(SCREEN, NO_PLATES, [], offset(TAP, 23, 0), boards)).toBeNull();
  const robots = [robotAt("robot", offset(TAP, 30, 0))];
  expect(targetAt(SCREEN, NO_PLATES, robots, offset(TAP, 10, 0), boards)).toEqual({
    boardId: "w-main",
  });
  expect(targetAt(SCREEN, NO_PLATES, robots, offset(TAP, 20, 0), boards)).toEqual({
    agentId: "robot",
  });
});

test("a robot and a note equally near: the robot", () => {
  // Both 15 px from the tap, to either side, so neither sum rounds the other way.
  const boards = { faces: [], notes: [noteAt(offset(TAP, 0, -15))] };
  const robots = [robotAt("robot", offset(TAP, 0, 15))];
  const [toNote, toRobot] = [
    Math.hypot(0, screenPoint(VIEW, PHONE, boards.notes[0]?.at ?? ROBOT.chest).y - TAP.y),
    Math.hypot(0, screenPoint(VIEW, PHONE, robots[0]?.chest ?? ROBOT.chest).y - TAP.y),
  ];
  expect(toNote).toBeCloseTo(toRobot, 9);
  expect(targetAt(SCREEN, NO_PLATES, robots, TAP, boards)).toEqual({ agentId: "robot" });
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
  const zoomed = zoomBy(VIEW, 2, PHONE);
  const screen: Screen = { view: zoomed, viewport: PHONE };
  const before = screenPoint(VIEW, PHONE, ROBOT.chest);
  const after = screenPoint(zoomed, PHONE, ROBOT.chest);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(23);
  expect(targetAt(screen, NO_PLATES, [ROBOT], after)).toEqual({ agentId: "robot" });
  expect(targetAt(screen, NO_PLATES, [ROBOT], before)).toBeNull();
});

test("a canvas drawn at half its size maps the pointer back to canvas pixels", () => {
  const rect = { left: 10, top: 20, width: 195, height: 422 };
  expect(canvasPoint({ clientX: 60, clientY: 120 }, rect, PHONE)).toEqual({ x: 100, y: 200 });
  const chest = screenPoint(VIEW, PHONE, ROBOT.chest);
  const client = { clientX: rect.left + chest.x / 2, clientY: rect.top + chest.y / 2 };
  const at = canvasPoint(client, rect, PHONE);
  expect(targetAt(SCREEN, NO_PLATES, [ROBOT], at)).toEqual({ agentId: "robot" });
});

test("a canvas at its own size, or with no size, only moves the pointer by the offset", () => {
  const sized = { left: 10, top: 20, width: 390, height: 844 };
  expect(canvasPoint({ clientX: 60, clientY: 120 }, sized, PHONE)).toEqual({ x: 50, y: 100 });
  const empty = { left: 10, top: 20, width: 0, height: 0 };
  expect(canvasPoint({ clientX: 60, clientY: 120 }, empty, PHONE)).toEqual({ x: 50, y: 100 });
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
  // The limit is a size on screen (camera.ts, SCALE_LIMITS), so its zoom depends on the view.
  const atMax: CameraView = { x: 1, z: 2, zoom: zoomLimits(PHONE).max };
  expect(zoomAbout(atMax, 2, { x: 10, y: 10 }, PHONE, OPEN)).toEqual(atMax);
});

test("a pinch keeps the ground under the fingers between them as they move", () => {
  const ground: WorldPoint = { x: -3, y: 0, z: 2 };
  const middle = screenPoint(VIEW, PHONE, ground);
  const before = { spread: 100, middle };
  const after = { spread: 130, middle: offset(middle, 30, -20) };
  const pinched = pinchView(VIEW, before, after, PHONE, OPEN);
  expect(pinched.zoom).toBeCloseTo(1.3, 9);
  const drawn = screenPoint(pinched, PHONE, ground);
  expect(drawn.x).toBeCloseTo(after.middle.x, 6);
  expect(drawn.y).toBeCloseTo(after.middle.y, 6);
});
