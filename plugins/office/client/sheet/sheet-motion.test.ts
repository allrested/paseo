import { expect, test } from "vitest";
import type { Sheet, SheetRobot, SpritePicture } from "../../shared/sheet.js";
import {
  firstTransform,
  fitted,
  focusOn,
  layerStyleValues,
  panned,
  pinched,
  planePath,
  playsOnce,
  stepRanges,
  targetAt,
} from "./sheet-motion.js";

// 400 x 800 picture pixels at 2 per point: 200 x 400 points at zoom 1.
const robot = (agentId: string, x: number, y: number, extra: Partial<SheetRobot> = {}) => ({
  agentId,
  key: "typing",
  x,
  y,
  phase: 0,
  joining: false,
  fresh: false,
  ...extra,
});

const SHEET: Sheet = {
  version: 1,
  tiles: 1,
  width: 400,
  height: 800,
  ratio: 2,
  scale: 40,
  frame: { width: 60, height: 80, chest: { x: 30, y: 40 } },
  robots: [robot("a", 100, 300), robot("b", 200, 500)],
  rooms: [
    {
      roomId: "r1",
      area: { x: 50, y: 200, width: 300, height: 400 },
      board: { x: 80, y: 220, width: 100, height: 60 },
      plate: { x: 60, y: 600, width: 80, height: 30 },
    },
  ],
  notes: [{ roomId: "r1", rect: { x: 300, y: 700, width: 20, height: 20 } }],
  mentions: [],
};
const PHONE = { width: 200, height: 300 };

test("stepped ranges show frame n for every value in [n, n + 1) and the last frame at the end", () => {
  const picture = {
    frames: 5,
    columns: 2,
    frameWidth: 60,
    frameHeight: 80,
  } as SpritePicture;
  const { input, x, y } = stepRanges(picture);
  const at = (value: number, output: number[]) => {
    if (value <= input[0]!) return output[0]!;
    if (value >= input.at(-1)!) return output.at(-1)!;
    const upper = input.findIndex((point) => point >= value);
    const t = (value - input[upper - 1]!) / (input[upper]! - input[upper - 1]!);
    return output[upper - 1]! + t * (output[upper]! - output[upper - 1]!);
  };

  expect(input.every((point, index) => index === 0 || point > input[index - 1]!)).toBe(true);
  for (let frame = 0; frame < 5; frame += 1) {
    for (const part of [0, 0.5, 0.998]) {
      expect(at(frame + part, x)).toBeCloseTo(-(frame % 2) * 60);
      expect(at(frame + part, y)).toBeCloseTo(-Math.floor(frame / 2) * 80);
    }
  }
  expect(at(5, x)).toBeCloseTo(0);
  expect(at(5, y)).toBe(-160);
  expect(at(7, y)).toBe(-160);
});

test("a repeated key replays nothing", () => {
  const typing = robot("a", 0, 0, { key: "raised", fresh: true });
  expect(playsOnce(typing, typing, false)).toBe(false);
});

test("a once-only sprite plays for a key that changed to it, or a fresh robot not seen before", () => {
  const before = robot("a", 0, 0, { key: "typing" });
  const raised = robot("a", 0, 0, { key: "raised" });
  expect(playsOnce(before, raised, false)).toBe(true);
  expect(playsOnce(undefined, { ...raised, fresh: true }, false)).toBe(true);
  expect(playsOnce(undefined, raised, false)).toBe(false);
  expect(playsOnce(before, raised, true)).toBe(false);
});

test("pan stops with the picture's edges at the viewer's edges", () => {
  const zoomed = { x: 0, y: 0, zoom: 2 };
  expect(fitted(panned(zoomed, 50, 50), SHEET, PHONE)).toEqual({ x: 0, y: 0, zoom: 2 });
  // The picture is 400 x 800 points at zoom 2.
  expect(fitted(panned(zoomed, -900, -900), SHEET, PHONE)).toEqual({ x: -200, y: -500, zoom: 2 });
});

test("a picture smaller than the viewer is centred", () => {
  const wide = { width: 600, height: 1000 };
  expect(fitted({ x: 7, y: 9, zoom: 1 }, SHEET, wide)).toEqual({ x: 200, y: 300, zoom: 1 });
});

test("zoom stops at the whole picture and at 2", () => {
  expect(fitted({ x: 0, y: 0, zoom: 0.1 }, SHEET, PHONE).zoom).toBeCloseTo(0.75);
  expect(fitted({ x: 0, y: 0, zoom: 9 }, SHEET, PHONE).zoom).toBe(2);
});

test("a pinch keeps the point between the fingers in place", () => {
  const start = { x: -40, y: -60, zoom: 1 };
  const middle = { x: 100, y: 150 };
  const result = pinched(start, { spread: 50, middle }, { spread: 75, middle });
  expect(result.zoom).toBeCloseTo(1.5);
  const under = (transform: typeof start) => ({
    x: (middle.x - transform.x) / transform.zoom,
    y: (middle.y - transform.y) / transform.zoom,
  });
  expect(under(result).x).toBeCloseTo(under(start).x);
  expect(under(result).y).toBeCloseTo(under(start).y);

  // The point moves with the fingers' middle.
  const moved = pinched(start, { spread: 50, middle }, { spread: 50, middle: { x: 130, y: 140 } });
  expect(moved).toEqual({ zoom: 1, x: -10, y: -70 });
});

test("a tap picks a name plate, then a robot before the board behind it, then the board", () => {
  const still = { x: 0, y: 0, zoom: 1 };
  // Picture px / 2 = points at zoom 1. The plate is at (60..140, 600..630) px.
  expect(targetAt(SHEET, still, { x: 50, y: 307 })).toEqual({ roomId: "r1" });
  // Robot a's chest is at (130, 340) px = (65, 170) pt, and the board spans (40..90, 110..140) pt.
  expect(targetAt(SHEET, still, { x: 67, y: 172 })).toEqual({ agentId: "a" });
  // Robot b's chest is at (230, 540) px = (115, 270) pt; the note's centre is (155, 355) pt.
  expect(targetAt(SHEET, still, { x: 150, y: 350 })).toEqual({ boardId: "r1" });
  // A robot's chest on top of the board still wins.
  const onBoard = { ...SHEET, robots: [robot("c", 50, 180)] };
  expect(targetAt(onBoard, still, { x: 55, y: 125 })).toEqual({ agentId: "c" });
  expect(targetAt(SHEET, still, { x: 50, y: 125 })).toEqual({ boardId: "r1" });
});

test("a tap far from everything picks nothing", () => {
  expect(targetAt(SHEET, { x: 0, y: 0, zoom: 1 }, { x: 190, y: 20 })).toBeNull();
});

test("focusOn centres a robot and fits a room", () => {
  const current = { x: 0, y: 0, zoom: 1 };
  const onRobot = focusOn(SHEET, { agentId: "b" }, PHONE, current)!;
  expect(onRobot.zoom).toBe(1.5);
  // Zoom 1.5 makes the picture 300 x 600 pt. The chest (115, 270) pt would sit at (172.5, 405)
  // pt, so centring it in the 200 x 300 viewer puts the corner at (-72.5, -255).
  expect(onRobot.x).toBe(-72.5);
  expect(onRobot.y).toBe(-255);
  expect(focusOn(SHEET, { agentId: "nobody" }, PHONE, current)).toBeNull();

  const onRoom = focusOn(SHEET, { roomId: "r1" }, PHONE, current)!;
  // The room's area is 150 x 200 pt: it fits the 200 x 300 viewer at zoom 1.33.
  expect(onRoom.zoom).toBeCloseTo(4 / 3);
  expect(focusOn(SHEET, { roomId: "nowhere" }, PHONE, current)).toBeNull();
});

test("the first transform puts the picture's top at the top, or the focused room in view", () => {
  expect(firstTransform(SHEET, PHONE)).toEqual({ x: 0, y: 0, zoom: 1 });
  expect(firstTransform(SHEET, { width: 200, height: 400 })).toEqual({ x: 0, y: 0, zoom: 1 });
  expect(firstTransform(SHEET, PHONE, "r1").zoom).toBeCloseTo(4 / 3);
  expect(firstTransform(SHEET, PHONE, "missing")).toEqual(firstTransform(SHEET, PHONE));
});

test("the layer values scale about the top left corner", () => {
  const transform = { x: 30, y: -20, zoom: 1.5 };
  const { scale, translateX, translateY } = layerStyleValues(transform, SHEET);
  expect(scale).toBe(0.75);
  // React Native scales about the centre (200, 400); the top left corner must land on (30, -20).
  expect(200 + (0 - 200) * scale + translateX).toBeCloseTo(30);
  expect(400 + (0 - 400) * scale + translateY).toBeCloseTo(-20);
});

test("a plane flies at a third of its distance, at most 2 world units high", () => {
  expect(planePath({ x: 0, y: 0 }, { x: 30, y: 0 }, 40)).toEqual({
    distance: 30,
    angle: 0,
    arc: 10,
  });
  expect(planePath({ x: 0, y: 0 }, { x: 0, y: 900 }, 40)).toEqual({
    distance: 900,
    angle: 90,
    arc: 80,
  });
});
