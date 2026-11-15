// A robot on foot: from the door to its desk when its agent starts, and from desk to desk when
// its agent moves to another room. Pure: the web scene and the sheet page both walk by it.
import { ROOM_WIDTH, type Bounds, type Point } from "../layout.js";
import {
  WALK_MS,
  type RobotFrame,
  type RobotPlan,
  type RoomPlan,
  type ScenePlan,
} from "./scene-plan.js";

/**
 * On the open floor a robot keeps this far from every wall. Two rooms that overlap on screen are
 * never nearer than 1.2 (layout.ts deals them 3 apart along the camera's directions), so a way
 * between any two rooms stays open.
 */
export const WALK_CLEARANCE = 0.55;
/** World units a second. */
const WALK_SPEED = 5;
/** No walk takes longer: a robot that crosses a large office hurries. */
export const MAX_WALK_MS = 7000;
/** The arms swing once, and the robot bobs twice, in this many units of the clock. */
const SWING_MS = 2 * Math.PI * 150;
const EPSILON = 1e-6;

export interface WalkLeg {
  from: Point;
  to: Point;
  length: number;
  /** As `RobotFrame.heading`: 0 faces +z. */
  heading: number;
  /** Inside a room, behind its near walls; otherwise on the open floor. */
  inside: boolean;
}

export interface Walk {
  legs: WalkLeg[];
  length: number;
  ms: number;
}

function leg(from: Point, to: Point, inside: boolean): WalkLeg {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return { from, to, length: Math.hypot(dx, dz), heading: Math.atan2(dx, dz), inside };
}

function walkOf(legs: WalkLeg[]): Walk {
  const walked = legs.filter((each) => each.length > EPSILON);
  const length = walked.reduce((sum, each) => sum + each.length, 0);
  const ms = Math.min(MAX_WALK_MS, Math.max(WALK_MS, (length / WALK_SPEED) * 1000));
  return { legs: walked, length, ms };
}

/** The ground a robot on the open floor stays out of: the room and `WALK_CLEARANCE` around it. */
function keptClear(room: RoomPlan): Bounds {
  return {
    minX: room.center.x - ROOM_WIDTH / 2 - WALK_CLEARANCE,
    maxX: room.center.x + ROOM_WIDTH / 2 + WALK_CLEARANCE,
    minZ: room.center.z - room.depth / 2 - WALK_CLEARANCE,
    maxZ: room.center.z + room.depth / 2 + WALK_CLEARANCE,
  };
}

/** Just outside a room's door: where a robot steps out to, and where it steps in from. */
function doorstep(room: RoomPlan): Point {
  return { x: room.door.x, z: room.door.z + WALK_CLEARANCE };
}

function within(point: Point, box: Bounds): boolean {
  return (
    point.x > box.minX + EPSILON &&
    point.x < box.maxX - EPSILON &&
    point.z > box.minZ + EPSILON &&
    point.z < box.maxZ - EPSILON
  );
}

/** Whether the line from `a` to `b` goes through the box. Along its edge is not through it. */
function crosses(a: Point, b: Point, box: Bounds): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  // Each side of the box as "p * t <= q" for the points a + t (b - a) that are on its inner side.
  const sides: [number, number][] = [
    [-dx, a.x - box.minX - EPSILON],
    [dx, box.maxX - EPSILON - a.x],
    [-dz, a.z - box.minZ - EPSILON],
    [dz, box.maxZ - EPSILON - a.z],
  ];
  let enters = 0;
  let leaves = 1;
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q <= 0) return false;
    } else if (p < 0) {
      enters = Math.max(enters, q / p);
    } else {
      leaves = Math.min(leaves, q / p);
    }
  }
  return leaves - enters > EPSILON;
}

/**
 * The shortest way over the open floor from `start` to `goal`, both outside every room: straight
 * lines from one room's corner to the next, each `WALK_CLEARANCE` off the walls. Null when a room
 * stands in every way, or over one of the two ends.
 */
function wayRound(start: Point, goal: Point, rooms: readonly RoomPlan[]): Point[] | null {
  const boxes = rooms.map(keptClear);
  const corners = boxes.flatMap((box) => [
    { x: box.minX, z: box.minZ },
    { x: box.maxX, z: box.minZ },
    { x: box.minX, z: box.maxZ },
    { x: box.maxX, z: box.maxZ },
  ]);
  const nodes = [start, goal, ...corners].filter((node) => !boxes.some((box) => within(node, box)));
  if (nodes[0] !== start || nodes[1] !== goal) return null;
  const open = (a: Point, b: Point) => !boxes.some((box) => crosses(a, b, box));
  // Dijkstra over a few dozen points: every pair is looked at, which is nothing at this size.
  const best = nodes.map((_, index) => (index === 0 ? 0 : Infinity));
  const from = nodes.map(() => -1);
  const done = nodes.map(() => false);
  for (;;) {
    let nearest = -1;
    for (let index = 0; index < nodes.length; index += 1) {
      if (!done[index] && (nearest < 0 || best[index]! < best[nearest]!)) nearest = index;
    }
    if (nearest < 0 || best[nearest] === Infinity) return null;
    if (nearest === 1) break;
    done[nearest] = true;
    const here = nodes[nearest]!;
    for (let index = 0; index < nodes.length; index += 1) {
      if (done[index]) continue;
      const there = nodes[index]!;
      const reach = best[nearest]! + Math.hypot(there.x - here.x, there.z - here.z);
      if (reach < best[index]! && open(here, there)) {
        best[index] = reach;
        from[index] = nearest;
      }
    }
  }
  const way: Point[] = [];
  for (let index = 1; index >= 0; index = from[index]!) way.unshift(nodes[index]!);
  return way;
}

export interface WalkEnd {
  seat: Point;
  room: RoomPlan;
}

/**
 * From a seat in one room to a seat in another: to the door, out, round the rooms between, in at
 * the other door and to the seat. Null when there is no way round.
 */
export function walkBetween(from: WalkEnd, to: WalkEnd, rooms: readonly RoomPlan[]): Walk | null {
  const out = doorstep(from.room);
  const way = wayRound(out, doorstep(to.room), rooms);
  if (way === null) return null;
  const legs = [leg(from.seat, from.room.door, true), leg(from.room.door, out, false)];
  for (let index = 1; index < way.length; index += 1) {
    legs.push(leg(way[index - 1]!, way[index]!, false));
  }
  legs.push(leg(way.at(-1)!, to.room.door, false), leg(to.room.door, to.seat, true));
  return walkOf(legs);
}

/** A robot whose agent starts: from its room's door to its desk. */
export function walkIn(robot: RobotPlan): Walk {
  return walkOf([leg(robot.door, robot.seat, true)]);
}

export interface WalkPlace extends Point {
  heading: number;
  /** The leg it is on. */
  leg: number;
}

/** Where the robot is `elapsed` milliseconds into its walk, at one pace over every leg. */
export function walkPlace(walk: Walk, elapsed: number): WalkPlace {
  const share = Math.min(1, Math.max(0, elapsed / walk.ms));
  const last = walk.legs.length - 1;
  // The end is the seat itself, not a rounding step short of it.
  if (share === 1 && last >= 0) {
    const { to, heading } = walk.legs[last]!;
    return { x: to.x, z: to.z, heading, leg: last };
  }
  let left = walk.length * share;
  for (let index = 0; index <= last; index += 1) {
    const each = walk.legs[index]!;
    if (left <= each.length || index === last) {
      const along = Math.min(1, left / each.length);
      return {
        x: each.from.x + (each.to.x - each.from.x) * along,
        z: each.from.z + (each.to.z - each.from.z) * along,
        heading: each.heading,
        leg: index,
      };
    }
    left -= each.length;
  }
  return { x: 0, z: 0, heading: 0, leg: 0 };
}

/** A robot in mid-step at `clock`: upright, its arms swinging, bobbing on its stand. */
function stride(at: Point, heading: number, clock: number): RobotFrame {
  const swing = Math.sin(clock / 150) * 0.5;
  return {
    x: at.x,
    z: at.z,
    lift: Math.abs(Math.sin(clock / 150)) * 0.05,
    heading,
    lean: 0.05,
    nod: 0,
    tilt: 0,
    armLeft: swing,
    armRight: -swing,
    armSway: 0,
  };
}

/** The robot `elapsed` milliseconds into its walk; `now` times its stride. */
export function walkFrame(walk: Walk, elapsed: number, now: number): RobotFrame {
  const place = walkPlace(walk, elapsed);
  return stride(place, place.heading, now);
}

/** A picture strip of a walking robot: one swing of the arms, which closes on itself. */
export const WALK_CLIP = { frames: 12, frameMs: SWING_MS / 12, loop: true };
/** A walking robot is drawn facing one of this many ways. */
export const WALK_DIRECTIONS = 8;

/** The direction a walking robot is drawn in for a heading: the nearest of `WALK_DIRECTIONS`. */
export function walkDirection(heading: number): number {
  const turn = (2 * Math.PI) / WALK_DIRECTIONS;
  return ((Math.round(heading / turn) % WALK_DIRECTIONS) + WALK_DIRECTIONS) % WALK_DIRECTIONS;
}

/** Frame `index` of the strip for `direction`: the robot walks on the spot, at the origin. */
export function walkClipFrame(direction: number, index: number): RobotFrame {
  const heading = (direction * 2 * Math.PI) / WALK_DIRECTIONS;
  return stride({ x: 0, z: 0 }, heading, index * WALK_CLIP.frameMs);
}

export interface ActiveWalk {
  /** Another number for every walk, so a viewer can tell a new walk from one it has seen. */
  id: number;
  walk: Walk;
  startedAt: number;
}

export interface WalkTracker {
  /** Call with every new plan and the one before it. */
  update(previous: ScenePlan, next: ScenePlan, now: number): void;
  /** The robot's walk, while it lasts. */
  get(agentId: string, now: number): ActiveWalk | null;
  /** Whether anyone is on its way. */
  active(now: number): boolean;
}

export interface WalkTrackerOptions {
  /**
   * Whether an agent that starts walks in from the door by this tracker. The web scene has its own
   * walk for that (`robotFrame`), the sheet has none.
   */
  arrivals: boolean;
  reducedMotion: boolean;
}

/** Where a seat of `was` is now that its room stands at `now`: seats count from the back wall. */
function carried(seat: Point, was: RoomPlan, now: RoomPlan): Point {
  return {
    x: seat.x - was.center.x + now.center.x,
    z: seat.z - (was.center.z - was.depth / 2) + (now.center.z - now.depth / 2),
  };
}

/** Starts a walk for each robot whose room changed, and keeps it until its time is up. */
export function createWalkTracker({ arrivals, reducedMotion }: WalkTrackerOptions): WalkTracker {
  const walks = new Map<string, ActiveWalk>();
  let lastId = 0;

  function start(agentId: string, walk: Walk, now: number): void {
    lastId += 1;
    walks.set(agentId, { id: lastId, walk, startedAt: now });
  }

  function get(agentId: string, now: number): ActiveWalk | null {
    const walking = walks.get(agentId);
    if (walking === undefined) return null;
    if (now - walking.startedAt < walking.walk.ms) return walking;
    walks.delete(agentId);
    return null;
  }

  return {
    update(previous, next, now) {
      if (reducedMotion) return;
      // A new deal moves every room: the old seats are somewhere else, and so is every way.
      if (previous.rooms.length > 0 && next.rooms.length > 0 && previous.columns !== next.columns) {
        walks.clear();
        return;
      }
      const before = new Map(previous.robots.map((robot) => [robot.agentId, robot]));
      const oldRooms = new Map(previous.rooms.map((room) => [room.roomId, room]));
      const rooms = new Map(next.rooms.map((room) => [room.roomId, room]));
      const present = new Set<string>();
      for (const robot of next.robots) {
        present.add(robot.agentId);
        const was = before.get(robot.agentId);
        if (was === undefined) {
          if (arrivals && robot.pose === "walking") start(robot.agentId, walkIn(robot), now);
          continue;
        }
        if (was.roomId === robot.roomId) continue;
        const oldRoom = oldRooms.get(was.roomId);
        const from = rooms.get(was.roomId);
        const to = rooms.get(robot.roomId);
        const walk =
          oldRoom && from && to
            ? walkBetween(
                { seat: carried(was.seat, oldRoom, from), room: from },
                { seat: robot.seat, room: to },
                next.rooms,
              )
            : null;
        if (walk === null) walks.delete(robot.agentId);
        else start(robot.agentId, walk, now);
      }
      for (const agentId of walks.keys()) if (!present.has(agentId)) walks.delete(agentId);
    },
    get,
    active(now) {
      for (const agentId of walks.keys()) if (get(agentId, now) !== null) return true;
      return false;
    },
  };
}
