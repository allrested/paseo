import { describe, expect, test } from "vitest";
import { EMPTY_LAYOUT_MEMORY, ROOM_WIDTH, layoutOffice, type Point } from "../layout.js";
import { buildOfficeModel } from "../model.js";
import { fakeOffice } from "./fake-office.js";
import { LIGHT_THEME_COLORS } from "./fake-theme.js";
import { scenePalette } from "./palette.js";
import {
  WALK_MS,
  buildScenePlan,
  type RobotPlan,
  type RoomPlan,
  type ScenePlan,
} from "./scene-plan.js";
import {
  MAX_WALK_MS,
  WALK_CLEARANCE,
  WALK_CLIP,
  createWalkTracker,
  walkBetween,
  walkClipFrame,
  walkDirection,
  walkFrame,
  walkIn,
  walkPlace,
  type Walk,
} from "./walk.js";

function room(roomId: string, x: number, z: number, depth = 6): RoomPlan {
  return {
    roomId,
    label: roomId,
    overflow: 0,
    center: { x, z },
    rows: 1,
    depth,
    board: { x, z: z - depth / 2 + 0.35 },
    door: { x, z: z + depth / 2 },
    labelAt: { x, z },
  };
}

function robot(
  agentId: string,
  at: RoomPlan,
  seat: Point,
  extra: Partial<RobotPlan> = {},
): RobotPlan {
  return {
    agentId,
    roomId: at.roomId,
    seat,
    seatIndex: 0,
    door: at.door,
    side: false,
    pose: "idle",
    visor: "#fff",
    lamp: "off",
    lampColor: "#aaa",
    screenLit: false,
    ...extra,
  };
}

function plan(rooms: RoomPlan[], robots: RobotPlan[], columns = 1): ScenePlan {
  return {
    rooms,
    robots,
    bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
    columns,
    notes: [],
    mentions: [],
  };
}

/** True when some part of the leg lies inside the room, walls included. */
function cuts(from: Point, to: Point, at: RoomPlan): boolean {
  const steps = 200;
  for (let step = 1; step < steps; step += 1) {
    const x = from.x + ((to.x - from.x) * step) / steps;
    const z = from.z + ((to.z - from.z) * step) / steps;
    if (
      Math.abs(x - at.center.x) < ROOM_WIDTH / 2 + 0.2 &&
      Math.abs(z - at.center.z) < at.depth / 2 + 0.2
    ) {
      return true;
    }
  }
  return false;
}

const BACK = room("back", 0, 0);
// In front of `BACK`, three units of floor between them, and stepped to the right as a column is.
const FRONT = room("front", 4, 9);
const BESIDE = room("beside", 15, -7);
const SEAT_BACK = { x: -2, z: -1 };
const SEAT_FRONT = { x: 5, z: 8 };

function walked(walk: Walk | null): Walk {
  if (walk === null) throw new Error("no way was found");
  return walk;
}

describe("walkBetween", () => {
  const rooms = [BACK, FRONT, BESIDE];
  const walk = walked(
    walkBetween({ seat: SEAT_BACK, room: BACK }, { seat: SEAT_FRONT, room: FRONT }, rooms),
  );

  test("goes from the old seat out of its door, and in at the new door to the new seat", () => {
    const first = walk.legs[0]!;
    const last = walk.legs.at(-1)!;
    expect(first.from).toEqual(SEAT_BACK);
    expect(first.to).toEqual(BACK.door);
    expect(first.inside).toBe(true);
    expect(last.from).toEqual(FRONT.door);
    expect(last.to).toEqual(SEAT_FRONT);
    expect(last.inside).toBe(true);
    // Between the two doors it is on the open floor.
    expect(walk.legs.slice(1, -1).every((leg) => !leg.inside)).toBe(true);
    // Each leg starts where the one before it ended.
    for (let index = 1; index < walk.legs.length; index += 1) {
      expect(walk.legs[index]!.from).toEqual(walk.legs[index - 1]!.to);
    }
  });

  test("steps straight out of the door and straight in, clear of the wall", () => {
    expect(walk.legs[1]!.to).toEqual({ x: BACK.door.x, z: BACK.door.z + WALK_CLEARANCE });
    expect(walk.legs.at(-2)!.from).toEqual({ x: FRONT.door.x, z: FRONT.door.z + WALK_CLEARANCE });
  });

  test("goes round the rooms on the open floor, never through one", () => {
    const outside = walk.legs.slice(2, -2);
    expect(outside.length).toBeGreaterThan(1);
    for (const leg of outside) {
      for (const each of rooms) expect(cuts(leg.from, leg.to, each)).toBe(false);
    }
  });

  test("takes the shorter way round", () => {
    // `FRONT` stands to the right of `BACK`'s door: its left side is the near one.
    const turns = walk.legs.slice(2, -2).map((leg) => leg.to.x);
    expect(Math.min(...turns)).toBeLessThan(FRONT.center.x - ROOM_WIDTH / 2);
    expect(Math.max(...turns)).toBeLessThan(FRONT.center.x + ROOM_WIDTH / 2);
  });

  test("knows each leg's length and heading, and its own length", () => {
    for (const leg of walk.legs) {
      expect(leg.length).toBeCloseTo(Math.hypot(leg.to.x - leg.from.x, leg.to.z - leg.from.z));
      expect(leg.heading).toBeCloseTo(Math.atan2(leg.to.x - leg.from.x, leg.to.z - leg.from.z));
      expect(leg.length).toBeGreaterThan(0);
    }
    expect(walk.length).toBeCloseTo(walk.legs.reduce((sum, leg) => sum + leg.length, 0));
  });

  test("reaches a room in the next column", () => {
    const across = walked(
      walkBetween({ seat: SEAT_BACK, room: BACK }, { seat: { x: 14, z: -8 }, room: BESIDE }, rooms),
    );
    for (const leg of across.legs.slice(2, -2)) {
      for (const each of rooms) expect(cuts(leg.from, leg.to, each)).toBe(false);
    }
    expect(across.legs.at(-1)!.to).toEqual({ x: 14, z: -8 });
  });

  test("has no way when the new room's door is walled in", () => {
    // A room right in front of `FRONT`'s door, nearer than a robot needs.
    const blocking = room("blocking", 4, 12 + 0.5 + 3, 6);
    expect(
      walkBetween({ seat: SEAT_BACK, room: BACK }, { seat: SEAT_FRONT, room: FRONT }, [
        BACK,
        FRONT,
        blocking,
      ]),
    ).toBeNull();
  });
});

describe("in an office as it is laid out", () => {
  const model = buildOfficeModel(fakeOffice());

  test.each([1, 2, 3])("every room is reached from every other, in %i columns", (columns) => {
    const { layout } = layoutOffice(model, EMPTY_LAYOUT_MEMORY, columns);
    const { rooms } = buildScenePlan(model, layout, scenePalette({ colors: LIGHT_THEME_COLORS }));
    expect(rooms.length).toBeGreaterThan(3);
    for (const from of rooms) {
      for (const to of rooms) {
        if (from === to) continue;
        const walk = walked(
          walkBetween({ seat: from.center, room: from }, { seat: to.center, room: to }, rooms),
        );
        for (const leg of walk.legs.filter((each) => !each.inside).slice(1, -1)) {
          for (const each of rooms) expect(cuts(leg.from, leg.to, each)).toBe(false);
        }
      }
    }
  });
});

describe("a walk's time", () => {
  test("is its length at a walking pace, but never shorter than the walk in from the door", () => {
    const short = walkIn(robot("a", BACK, { x: 0, z: 2 }));
    expect(short.ms).toBe(WALK_MS);
    expect(short.legs).toHaveLength(1);
    expect(short.legs[0]).toMatchObject({ from: BACK.door, to: { x: 0, z: 2 }, inside: true });

    const walk = walked(
      walkBetween({ seat: SEAT_BACK, room: BACK }, { seat: SEAT_FRONT, room: FRONT }, [
        BACK,
        FRONT,
      ]),
    );
    expect(walk.ms).toBeCloseTo((walk.length / 5) * 1000);
  });

  test("is capped, so a robot crossing a large office hurries", () => {
    const far = room("far", 300, 0);
    const walk = walked(
      walkBetween({ seat: SEAT_BACK, room: BACK }, { seat: { x: 300, z: 0 }, room: far }, [
        BACK,
        far,
      ]),
    );
    expect(walk.ms).toBe(MAX_WALK_MS);
  });
});

describe("walkPlace", () => {
  const walk = walked(
    walkBetween({ seat: SEAT_BACK, room: BACK }, { seat: SEAT_FRONT, room: FRONT }, [BACK, FRONT]),
  );

  test("starts at the old seat and ends at the new one, however late it is asked", () => {
    expect(walkPlace(walk, 0)).toMatchObject({ ...SEAT_BACK, leg: 0 });
    expect(walkPlace(walk, -50)).toMatchObject(SEAT_BACK);
    expect(walkPlace(walk, walk.ms)).toMatchObject({ ...SEAT_FRONT, leg: walk.legs.length - 1 });
    expect(walkPlace(walk, walk.ms * 3)).toMatchObject(SEAT_FRONT);
  });

  test("keeps one pace over every leg, and faces the way it goes", () => {
    const first = walk.legs[0]!;
    // Half of the first leg's time: half way along it.
    const half = walkPlace(walk, (first.length / 2 / walk.length) * walk.ms);
    expect(half.x).toBeCloseTo((first.from.x + first.to.x) / 2);
    expect(half.z).toBeCloseTo((first.from.z + first.to.z) / 2);
    expect(half.heading).toBeCloseTo(first.heading);
    expect(half.leg).toBe(0);
    const second = walk.legs[1]!;
    const later = walkPlace(walk, ((first.length + second.length / 2) / walk.length) * walk.ms);
    expect(later.leg).toBe(1);
    expect(later.heading).toBeCloseTo(second.heading);
  });
});

describe("walkFrame", () => {
  test("is the robot on its way: upright, arms swinging, a little off the floor", () => {
    const walk = walkIn(robot("a", BACK, { x: 2, z: 0 }));
    const frame = walkFrame(walk, WALK_MS / 2, 235);
    const place = walkPlace(walk, WALK_MS / 2);
    expect(frame).toMatchObject({ x: place.x, z: place.z, heading: place.heading, lean: 0.05 });
    expect(frame.armLeft).toBeCloseTo(-frame.armRight);
    expect(frame.armLeft).not.toBe(0);
    expect(frame.lift).toBeGreaterThan(0);
  });
});

describe("the walking sprite", () => {
  test("has eight directions, the nearest one to a heading", () => {
    expect(walkDirection(0)).toBe(0);
    expect(walkDirection(Math.PI / 4 + 0.1)).toBe(1);
    expect(walkDirection(Math.PI)).toBe(4);
    expect(walkDirection(-Math.PI / 2)).toBe(6);
    expect(walkDirection(2 * Math.PI - 0.05)).toBe(0);
  });

  test("is one swing of the arms that closes on itself, walked on the spot", () => {
    const first = walkClipFrame(2, 0);
    const again = walkClipFrame(2, WALK_CLIP.frames);
    expect(first).toMatchObject({ x: 0, z: 0, heading: Math.PI / 2 });
    expect(again.armLeft).toBeCloseTo(first.armLeft);
    expect(again.lift).toBeCloseTo(first.lift);
    const quarter = walkClipFrame(2, WALK_CLIP.frames / 4);
    expect(Math.abs(quarter.armLeft)).toBeCloseTo(0.5);
    expect(WALK_CLIP.loop).toBe(true);
  });
});

describe("the walk tracker", () => {
  const rooms = [BACK, FRONT];
  const seated = plan(rooms, [robot("a", BACK, SEAT_BACK), robot("b", BACK, { x: 2, z: -1 })]);
  const moved = plan(rooms, [robot("a", FRONT, SEAT_FRONT), robot("b", BACK, { x: 2, z: -1 })]);

  test("a robot whose room changed walks there, and only that robot", () => {
    const tracker = createWalkTracker({ arrivals: false, reducedMotion: false });
    tracker.update(plan([], []), seated, 1000);
    expect(tracker.get("a", 1000)).toBeNull();
    tracker.update(seated, moved, 2000);

    const walking = tracker.get("a", 2000)!;
    expect(walking.startedAt).toBe(2000);
    expect(walking.walk.legs[0]!.from).toEqual(SEAT_BACK);
    expect(walking.walk.legs.at(-1)!.to).toEqual(SEAT_FRONT);
    expect(tracker.get("b", 2000)).toBeNull();
    expect(tracker.active(2000)).toBe(true);
  });

  test("a walk is over when its time is up, and each walk has its own id", () => {
    const tracker = createWalkTracker({ arrivals: false, reducedMotion: false });
    tracker.update(seated, moved, 2000);
    const first = tracker.get("a", 2000)!;
    expect(tracker.get("a", 2000 + first.walk.ms - 1)).not.toBeNull();
    expect(tracker.get("a", 2000 + first.walk.ms)).toBeNull();
    expect(tracker.active(2000 + first.walk.ms)).toBe(false);

    tracker.update(moved, seated, 20_000);
    expect(tracker.get("a", 20_000)!.id).not.toBe(first.id);
  });

  test("a walk goes on while the office changes around it", () => {
    const tracker = createWalkTracker({ arrivals: false, reducedMotion: false });
    tracker.update(seated, moved, 2000);
    const walking = tracker.get("a", 2000)!;
    const typing = plan(rooms, [
      robot("a", FRONT, SEAT_FRONT, { pose: "typing" }),
      robot("b", BACK, { x: 2, z: -1 }),
    ]);
    tracker.update(moved, typing, 2500);
    expect(tracker.get("a", 2500)).toBe(walking);
  });

  test("the old seat is taken from where its room stands now", () => {
    const tracker = createWalkTracker({ arrivals: false, reducedMotion: false });
    // The old room moved 2 to the right and grew a row: its back wall is where seats count from.
    const grown = { ...room("back", 2, 1.25, 8.5), rows: 2 };
    const pushed = room("front", 6, 11.5);
    const after = plan([grown, pushed], [robot("a", pushed, { x: 7, z: 11 })]);
    tracker.update(seated, after, 0);
    expect(tracker.get("a", 0)!.walk.legs[0]!.from).toEqual({ x: 0, z: -1 });
  });

  test("an agent that starts walks in from the door only where arrivals are asked for", () => {
    const arriving = plan(rooms, [robot("n", BACK, SEAT_BACK, { pose: "walking" })]);
    const web = createWalkTracker({ arrivals: false, reducedMotion: false });
    web.update(plan(rooms, []), arriving, 0);
    expect(web.get("n", 0)).toBeNull();

    const sheet = createWalkTracker({ arrivals: true, reducedMotion: false });
    sheet.update(plan(rooms, []), arriving, 0);
    expect(sheet.get("n", 0)!.walk).toEqual(walkIn(arriving.robots[0]!));
    // An agent that was there before, or one that does not start, walks nowhere.
    sheet.update(arriving, arriving, 100);
    expect(sheet.get("n", 100)!.startedAt).toBe(0);
    const resting = plan(rooms, [robot("r", BACK, SEAT_BACK)]);
    sheet.update(plan(rooms, []), resting, 0);
    expect(sheet.get("r", 0)).toBeNull();
  });

  test("nothing walks with reduced motion, to a room that is gone, or after a new deal", () => {
    const still = createWalkTracker({ arrivals: true, reducedMotion: true });
    still.update(seated, moved, 0);
    expect(still.get("a", 0)).toBeNull();

    const tracker = createWalkTracker({ arrivals: false, reducedMotion: false });
    // The old room is not in the new office.
    tracker.update(seated, plan([FRONT], [robot("a", FRONT, SEAT_FRONT)]), 0);
    expect(tracker.get("a", 0)).toBeNull();

    tracker.update(seated, moved, 0);
    expect(tracker.get("a", 0)).not.toBeNull();
    // Two columns now: every room has a new place, and the old ways lead nowhere.
    tracker.update(moved, { ...seated, columns: 2 }, 100);
    expect(tracker.get("a", 100)).toBeNull();
    expect(tracker.active(100)).toBe(false);
  });

  test("a robot that left takes its walk with it", () => {
    const tracker = createWalkTracker({ arrivals: false, reducedMotion: false });
    tracker.update(seated, moved, 0);
    tracker.update(moved, plan(rooms, [robot("b", BACK, { x: 2, z: -1 })]), 100);
    expect(tracker.get("a", 100)).toBeNull();
    expect(tracker.active(100)).toBe(false);
  });
});
