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
  RETRY_MS,
  keptSprites,
  pivotedRotation,
  shouldAsk,
  stepRanges,
  wavesOwed,
  zoomLimits,
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
const LIMITS = zoomLimits(SHEET, PHONE);

test("stepped ranges show frame n for every value in [n, n + 1) and the last frame at the end", () => {
  // The picture was drawn at another resolution: it steps by the sheet's frame, not its own.
  const picture = {
    frames: 5,
    columns: 2,
    frameWidth: 30,
    frameHeight: 40,
  } as SpritePicture;
  const { input, x, y } = stepRanges(picture, { width: 60, height: 80 });
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
  const result = pinched(start, { spread: 50, middle }, { spread: 75, middle }, LIMITS);
  expect(result.zoom).toBeCloseTo(1.5);
  const under = (transform: typeof start) => ({
    x: (middle.x - transform.x) / transform.zoom,
    y: (middle.y - transform.y) / transform.zoom,
  });
  expect(under(result).x).toBeCloseTo(under(start).x);
  expect(under(result).y).toBeCloseTo(under(start).y);

  // The point moves with the fingers' middle.
  const moved = pinched(
    start,
    { spread: 50, middle },
    { spread: 50, middle: { x: 130, y: 140 } },
    LIMITS,
  );
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

test("zoom limits are the whole picture and 2", () => {
  expect(zoomLimits(SHEET, PHONE)).toEqual({ min: 0.75, max: 2 });
  expect(zoomLimits(SHEET, { width: 600, height: 1000 })).toEqual({ min: 1, max: 2 });
});

test("a pinch past a zoom limit keeps the fingers' point where it is", () => {
  const middle = { x: 200, y: 100 };
  const atMax = { x: -100, y: -50, zoom: 2 };
  const out = pinched(atMax, { spread: 100, middle }, { spread: 110, middle }, LIMITS);
  expect(out).toEqual(atMax);

  const atMin = { x: 0, y: 0, zoom: 0.75 };
  const inward = pinched(atMin, { spread: 100, middle }, { spread: 60, middle }, LIMITS);
  expect(inward).toEqual(atMin);

  // Reaching the limit part-way keeps the point too.
  const near = { x: -100, y: -50, zoom: 1.9 };
  const reached = pinched(near, { spread: 100, middle }, { spread: 150, middle }, LIMITS);
  expect(reached.zoom).toBe(2);
  const under = (t: typeof near) => (middle.x - t.x) / t.zoom;
  expect(under(reached)).toBeCloseTo(under(near));
});

test("a sprite is asked for when there is none or it is for another scale, and a failure only after a while", () => {
  const picture = { scale: 40 } as SpritePicture;
  const asked = (askedScale: number, askedAt: number, pending = false) => ({
    askedScale,
    askedAt,
    pending,
  });
  expect(shouldAsk(undefined, undefined, 40, 0)).toBe(true);
  expect(shouldAsk(asked(40, 0, true), undefined, 40, 99_999)).toBe(false);
  expect(shouldAsk(asked(40, 0), picture, 40, 99_999)).toBe(false);
  // A picture for another scale stays in use and is asked for again at once, once.
  expect(shouldAsk(asked(40, 1000), picture, 50, 1001)).toBe(true);
  expect(shouldAsk(asked(50, 1000), picture, 50, 1001)).toBe(false);
  // A failed or null answer is asked again, but not within RETRY_MS.
  expect(shouldAsk(asked(40, 1000), undefined, 40, 1000 + RETRY_MS - 1)).toBe(false);
  expect(shouldAsk(asked(40, 1000), undefined, 40, 1000 + RETRY_MS)).toBe(true);
});

test("sprites are kept up to 60, then only those a robot of the shown sheet uses stay", () => {
  const keys = Array.from({ length: 61 }, (_, index) => `k${index}`);
  expect(keptSprites(keys.slice(0, 60), new Set(["k1"]))).toEqual(keys.slice(0, 60));
  expect(keptSprites(keys, new Set(["k1", "k2"]))).toEqual(["k1", "k2"]);
});

test("a wave is owed to a robot whose key changed or that is new and fresh, until its key changes again or it leaves", () => {
  const before = { ...SHEET, robots: [robot("a", 0, 0), robot("b", 0, 0, { key: "idle" })] };
  const next = {
    ...SHEET,
    robots: [
      robot("a", 0, 0, { key: "raised" }),
      robot("b", 0, 0, { key: "idle" }),
      robot("c", 0, 0, { fresh: true }),
      robot("d", 0, 0),
    ],
  };
  const owed = wavesOwed(new Set(), before, next);
  expect([...owed].sort()).toEqual(["a", "c"]);

  // The same sheet again (the sprite is still on its way) owes the same.
  const again = { ...next, robots: next.robots.map((entry) => ({ ...entry })) };
  expect([...wavesOwed(owed, next, again)].sort()).toEqual(["a", "c"]);

  // Its key changes again, or it leaves.
  const later = {
    ...SHEET,
    robots: [robot("a", 0, 0, { key: "typing" }), robot("d", 0, 0)],
  };
  expect([...wavesOwed(owed, next, later)].sort()).toEqual(["a"]);
  const gone = { ...SHEET, robots: [robot("d", 0, 0)] };
  expect([...wavesOwed(owed, next, gone)]).toEqual([]);

  // The first sheet owes a wave to a fresh robot only.
  expect([...wavesOwed(new Set(), null, next)].sort()).toEqual(["c"]);
});

test("a plane turns about its chest point", () => {
  const frame = { width: 60, height: 80 };
  const chest = { x: 30, y: 60 };
  const steps = pivotedRotation(chest, frame, 90);
  // React Native turns about the middle of the box; carry a point through the steps, last first.
  const through = (point: { x: number; y: number }) => {
    let p = { x: point.x - frame.width / 2, y: point.y - frame.height / 2 };
    for (const step of steps.toReversed()) {
      if ("translateX" in step) p = { x: p.x + step.translateX, y: p.y };
      else if ("translateY" in step) p = { x: p.x, y: p.y + step.translateY };
      else {
        const angle = (Number.parseFloat(step.rotate) * Math.PI) / 180;
        p = {
          x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
          y: p.x * Math.sin(angle) + p.y * Math.cos(angle),
        };
      }
    }
    return { x: p.x + frame.width / 2, y: p.y + frame.height / 2 };
  };
  expect(through(chest).x).toBeCloseTo(chest.x);
  expect(through(chest).y).toBeCloseTo(chest.y);
  // A point to the right of the chest ends below it after a quarter turn.
  expect(through({ x: 50, y: 60 }).x).toBeCloseTo(30);
  expect(through({ x: 50, y: 60 }).y).toBeCloseTo(80);
});
