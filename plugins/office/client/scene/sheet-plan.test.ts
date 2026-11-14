import { describe, expect, test } from "vitest";
import { createRenderPipeline } from "../../render/pipeline.js";
import {
  MAX_BACKDROP_PIXELS,
  MAX_SPRITE_SIDE,
  MOST_BACKDROP_PIXELS,
  TILE_SIDE,
} from "../../shared/sheet.js";
import { FIRST_MARGINS, firstView, groundSpan, screenPoint } from "./camera.js";
import { fakeOffice } from "./fake-office.js";
import { LIGHT_THEME_COLORS } from "./fake-theme.js";
import { scenePalette } from "./palette.js";
import { roomFootprint, type RobotPlan, type ScenePlan } from "./scene-plan.js";
import { NO_ROOMS } from "./scene-layout.js";
import {
  SPRITE_CLIPS,
  buildSheet,
  clipMotion,
  picturePixels,
  pictureScale,
  sheetFrame,
  spriteBox,
  spriteFrame,
  spriteGrid,
  spriteKey,
  spriteLook,
  stillSignature,
  tileRects,
  typingPhase,
} from "./sheet-plan.js";

const PHONE = { width: 390, height: 700 };

function planFor(viewer = PHONE): ScenePlan {
  const pipeline = createRenderPipeline(scenePalette({ colors: LIGHT_THEME_COLORS }));
  pipeline.resize(viewer.width, viewer.height);
  const plan = pipeline.apply({ type: "snapshot", state: fakeOffice() });
  if (plan === null) throw new Error("no plan");
  return plan;
}

const spanOf = (plan: ScenePlan) => groundSpan(plan.rooms.map(roomFootprint));

function sheetOf(plan: ScenePlan, viewer = PHONE, pixelRatio = 2) {
  const frame = sheetFrame(spanOf(plan), viewer, pixelRatio);
  const sheet = buildSheet({
    plan,
    frame,
    version: 1,
    tiles: tileRects(picturePixels(frame).width, picturePixels(frame).height).length,
    fresh: new Set(),
    plates: new Map(plan.rooms.map((room) => [room.roomId, { width: 80, height: 20 }])),
  });
  return { frame, sheet };
}

function robotWith(plan: ScenePlan, pose: RobotPlan["pose"]): RobotPlan {
  const robot = plan.robots.find((candidate) => candidate.pose === pose);
  if (!robot) throw new Error(`no ${pose} robot`);
  return robot;
}

describe("sheetFrame", () => {
  test("gives whole picture sizes for a fractional viewer", () => {
    const viewer = { width: 411.43, height: 866.29 };
    const plan = planFor(viewer);
    const frame = sheetFrame(spanOf(plan), viewer, 2.625);
    const { width, height } = picturePixels(frame);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
    expect(frame.viewport.width * frame.ratio).toBeCloseTo(width, 6);
    expect(frame.viewport.height * frame.ratio).toBeCloseTo(height, 6);
    expect(frame.ratio).toBeLessThanOrEqual(2);
    expect(frame.ratio).toBeGreaterThanOrEqual(1);
    expect(width * height).toBeLessThanOrEqual(MAX_BACKDROP_PIXELS * 1.001);
  });

  test("a deep office is taller than the viewer and starts at the first view's top", () => {
    const plan = planFor();
    const span = spanOf(plan);
    const frame = sheetFrame(span, PHONE, 2);
    expect(frame.viewport.height).toBeGreaterThan(PHONE.height);
    expect(frame.viewport.width).toBeCloseTo(PHONE.width, 0);
    const first = firstView(span, PHONE, FIRST_MARGINS);
    const board = plan.rooms[0]!.board;
    const point = { x: board.x, y: 1, z: board.z };
    const inFirst = screenPoint(first, PHONE, point);
    const inFrame = screenPoint(frame.view, frame.viewport, point);
    expect(inFrame.y).toBeCloseTo(inFirst.y, 3);
    expect(Math.abs(inFrame.x - inFirst.x)).toBeLessThan(0.5);
    // The whole office is in it: the nearest robot's seat is above the bottom edge.
    const lowest = Math.max(
      ...plan.robots.map(
        (robot) => screenPoint(frame.view, frame.viewport, { ...robot.seat, y: 0 }).y,
      ),
    );
    expect(lowest).toBeLessThan(frame.viewport.height);
  });

  test("is no sharper than the viewer and never under one pixel per point", () => {
    const plan = planFor();
    expect(sheetFrame(spanOf(plan), PHONE, 1.5).ratio).toBeCloseTo(1.5, 6);
    expect(sheetFrame(spanOf(plan), PHONE, 0.5).ratio).toBe(1);
    expect(sheetFrame(spanOf(plan), PHONE, 3).ratio).toBe(2);
  });

  test("no backdrop passes the hard limit, whatever the viewer says", () => {
    const viewer = { width: 4096, height: 4096 };
    const plan = planFor(viewer);
    const frame = sheetFrame(spanOf(plan), viewer, 8);
    const { width, height } = picturePixels(frame);
    expect(width * height).toBeLessThanOrEqual(MOST_BACKDROP_PIXELS * 1.001);
    expect(frame.ratio).toBeLessThan(1);
  });

  test("an office without rooms is an empty picture of the viewer's size", () => {
    const frame = sheetFrame(spanOf(NO_ROOMS), PHONE, 2);
    const { width, height } = picturePixels(frame);
    expect([width, height]).toEqual([780, 1400]);
    expect(tileRects(width, height)).toHaveLength(2);
    const sheet = buildSheet({
      plan: NO_ROOMS,
      frame,
      version: 1,
      tiles: 2,
      fresh: new Set(),
      plates: new Map(),
    });
    expect(sheet.robots).toEqual([]);
    expect(sheet.rooms).toEqual([]);
  });
});

describe("buildSheet", () => {
  test("robots are ordered far to near", () => {
    const plan = planFor();
    const { sheet } = sheetOf(plan);
    expect(sheet.robots).toHaveLength(plan.robots.length);
    // Further from the camera is higher on the picture, row by row; within a room no robot is
    // drawn after one that stands in front of it.
    const seats = new Map(plan.robots.map((robot) => [robot.agentId, robot]));
    for (let index = 1; index < sheet.robots.length; index += 1) {
      const before = seats.get(sheet.robots[index - 1]!.agentId)!;
      const after = seats.get(sheet.robots[index]!.agentId)!;
      const depth = (robot: RobotPlan) =>
        robot.seat.x * Math.sin((26 * Math.PI) / 180) +
        robot.seat.z * Math.cos((26 * Math.PI) / 180);
      expect(depth(after)).toBeGreaterThanOrEqual(depth(before));
    }
  });

  test("a robot's frame puts its seat where the backdrop draws it, within half a pixel", () => {
    const plan = planFor();
    const { frame, sheet } = sheetOf(plan);
    const box = spriteBox(pictureScale(frame));
    expect(sheet.frame).toEqual({ width: box.width, height: box.height, chest: box.chest });
    for (const robot of plan.robots) {
      const placed = sheet.robots.find((candidate) => candidate.agentId === robot.agentId)!;
      const seat = screenPoint(frame.view, frame.viewport, { ...robot.seat, y: 0 });
      expect(Math.abs(placed.x + box.seat.x - seat.x * frame.ratio)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(placed.y + box.seat.y - seat.y * frame.ratio)).toBeLessThanOrEqual(0.5);
      expect(Number.isInteger(placed.x) && Number.isInteger(placed.y)).toBe(true);
    }
  });

  test("a sprite's camera draws the seat at the same place in every frame", () => {
    const scale = 47.4;
    const box = spriteBox(scale);
    const frame = spriteFrame(box, scale, 2);
    const seat = screenPoint(frame.view, frame.viewport, { x: 0, y: 0, z: 0 });
    expect(seat.x * 2).toBeCloseTo(box.seat.x, 6);
    expect(seat.y * 2).toBeCloseTo(box.seat.y, 6);
    expect(pictureScale(frame)).toBeCloseTo(scale, 6);
    expect(picturePixels(frame)).toEqual({ width: box.width, height: box.height });
  });

  test("a walking robot is joining; a typing one has its own phase", () => {
    const plan = planFor();
    const { sheet } = sheetOf(plan);
    const walking = robotWith(plan, "walking");
    const placed = sheet.robots.find((robot) => robot.agentId === walking.agentId)!;
    expect(placed.joining).toBe(true);
    expect(placed.key.startsWith("walking|")).toBe(true);
    const typing = sheet.robots.filter((robot) => robot.key.startsWith("typing|"));
    expect(new Set(typing.map((robot) => robot.phase)).size).toBeGreaterThan(1);
    for (const robot of typing) {
      expect(robot.phase).toBeGreaterThanOrEqual(0);
      expect(robot.phase).toBeLessThan(SPRITE_CLIPS.typing.frames);
    }
    expect(typingPhase(0)).toBe(0);
  });

  test("marks the robots whose pose is fresh, and places boards, plates, notes and mentions", () => {
    const plan = planFor();
    const frame = sheetFrame(spanOf(plan), PHONE, 2);
    const raised = robotWith(plan, "raised");
    const sheet = buildSheet({
      plan,
      frame,
      version: 3,
      tiles: 2,
      fresh: new Set([raised.agentId]),
      plates: new Map([[plan.rooms[0]!.roomId, { width: 60, height: 20 }]]),
    });
    expect(sheet.version).toBe(3);
    expect(sheet.tiles).toBe(2);
    expect(sheet.robots.filter((robot) => robot.fresh).map((robot) => robot.agentId)).toEqual([
      raised.agentId,
    ]);
    const room = sheet.rooms[0]!;
    expect(room.plate.width).toBe(120);
    expect(room.plate.height).toBe(40);
    expect(room.board.width).toBeGreaterThan(100);
    expect(room.board.x).toBeGreaterThan(0);
    expect(room.board.x + room.board.width).toBeLessThan(sheet.width);
    expect(sheet.rooms[1]!.plate.width).toBe(0);
    // The room's area holds its board, and is nearly as wide as the picture on a phone.
    expect(room.area.x).toBeLessThan(room.board.x);
    expect(room.area.y + room.area.height).toBeGreaterThan(room.board.y + room.board.height);
    expect(room.area.width).toBeGreaterThan(sheet.width * 0.8);
    expect(room.area.width).toBeLessThanOrEqual(sheet.width);
    expect(sheet.notes).toHaveLength(plan.notes.filter((note) => note.onDesk).length);
    expect(sheet.mentions).toHaveLength(plan.mentions.length);
  });
});

describe("sprites", () => {
  test("spriteLook reads back what spriteKey wrote", () => {
    const plan = planFor();
    for (const robot of plan.robots) {
      const look = spriteLook(spriteKey(robot));
      expect(look).toMatchObject({
        pose: robot.pose,
        visor: robot.visor,
        lamp: robot.lamp,
        lampColor: robot.lampColor,
        screenLit: robot.screenLit,
        side: robot.side,
        seat: { x: 0, z: 0 },
      });
      expect(spriteKey(look!)).toBe(spriteKey(robot));
    }
  });

  test("refuses a key it cannot read", () => {
    for (const key of [
      "",
      "plane",
      "dancing|#fff|off|#fff|0|0|0",
      "idle|#fff|bright|#fff|0|0|0",
      "idle|#fff|off|#fff|2|0|0",
      "idle|#fff|off|#fff|0|0|0|extra",
      "idle|url(javascript:1)<|off|#fff|0|0|0",
    ]) {
      expect(spriteLook(key)).toBeNull();
    }
  });

  test("an idle robot's key says which side its head lies to", () => {
    const base = spriteLook("idle|#fff|off|#aaa|0|0|0")!;
    const other = spriteLook("idle|#fff|off|#aaa|0|0|1")!;
    expect(clipMotion(base, 0).tilt).toBe(-clipMotion(other, 0).tilt);
  });

  test("typing loops without a jump", () => {
    const look = spriteLook("typing|#fff|steady|#aaa|1|0|0")!;
    const { frames } = SPRITE_CLIPS.typing;
    const first = clipMotion(look, 0);
    const again = clipMotion(look, frames);
    for (const part of ["armLeft", "armRight", "nod"] as const) {
      expect(again[part]).toBeCloseTo(first[part], 6);
    }
    expect(clipMotion(look, 3).armLeft).not.toBeCloseTo(first.armLeft, 3);
  });

  test("the wave ends on the still raised hand", () => {
    const look = spriteLook("raised|#fff|warning|#aaa|0|0|0")!;
    const { frames } = SPRITE_CLIPS.raised;
    expect(clipMotion(look, frames - 1).armSway).toBe(0);
    expect(clipMotion(look, 2).armSway).not.toBe(0);
    expect(clipMotion(look, 0).armRight).toBe(Math.PI);
  });

  test("a robot that arrives is drawn at its seat", () => {
    const look = spriteLook("walking|#fff|off|#aaa|0|0|0")!;
    expect(clipMotion(look, 0)).toMatchObject({ x: 0, z: 0, heading: 0, lift: 0 });
  });
});

describe("spriteGrid", () => {
  test("keeps both sides of a grid under Android's limit, as square as it can", () => {
    // A phone: 24 frames of 155 x 204 lie 6 across, not 12 across or 4 across.
    const phone = spriteGrid(24, 47.4);
    expect(phone.scale).toBe(47.4);
    expect(phone.box).toEqual(spriteBox(47.4));
    expect(phone.columns).toBe(6);
    // A tablet at the first view's largest scale: frames about 278 x 370.
    const tablet = spriteGrid(24, 88);
    expect(tablet.scale).toBe(88);
    expect(tablet.columns * tablet.box.width).toBeLessThanOrEqual(MAX_SPRITE_SIDE);
    expect(Math.ceil(24 / tablet.columns) * tablet.box.height).toBeLessThanOrEqual(MAX_SPRITE_SIDE);
    expect(spriteGrid(1, 88).columns).toBe(1);
  });

  test("draws the frames smaller when no grid of them fits", () => {
    const grid = spriteGrid(24, 200);
    expect(grid.scale).toBeLessThan(200);
    expect(grid.box).toEqual(spriteBox(grid.scale));
    expect(grid.columns * grid.box.width).toBeLessThanOrEqual(MAX_SPRITE_SIDE);
    expect(Math.ceil(24 / grid.columns) * grid.box.height).toBeLessThanOrEqual(MAX_SPRITE_SIDE);
  });
});

describe("tileRects", () => {
  test("tiles cover the picture without overlap, none over 1024", () => {
    const tiles = tileRects(1560, 2600);
    expect(tiles).toHaveLength(6);
    expect(tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0)).toBe(1560 * 2600);
    for (const tile of tiles) {
      expect(tile.width).toBeLessThanOrEqual(TILE_SIDE);
      expect(tile.height).toBeLessThanOrEqual(TILE_SIDE);
    }
    expect(tiles[1]).toEqual({ x: 1024, y: 0, width: 536, height: 1024 });
    expect(tileRects(780, 1000)).toEqual([{ x: 0, y: 0, width: 780, height: 1000 }]);
  });
});

describe("stillSignature", () => {
  test("ignores robots and follows rooms, notes and size", () => {
    const plan = planFor();
    const frame = sheetFrame(spanOf(plan), PHONE, 2);
    const base = stillSignature(plan, frame);
    const moved = plan.robots.map((robot) => ({ ...robot, pose: "slumped" as const }));
    expect(stillSignature({ ...plan, robots: moved }, frame)).toBe(base);
    expect(stillSignature({ ...plan, robots: [] }, frame)).toBe(base);
    expect(stillSignature({ ...plan, notes: plan.notes.slice(1) }, frame)).not.toBe(base);
    const renamed = plan.rooms.map((room, index) =>
      index === 0 ? { ...room, label: "Another" } : room,
    );
    expect(stillSignature({ ...plan, rooms: renamed }, frame)).not.toBe(base);
    const wider = sheetFrame(spanOf(plan), { width: 400, height: 700 }, 2);
    expect(stillSignature(plan, wider)).not.toBe(base);
  });
});
