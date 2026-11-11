import type { OfficeAgent } from "../../shared/contracts.js";
import {
  CELL_COLUMNS,
  seatPosition,
  type Bounds,
  type OfficeLayout,
  type Point,
} from "../layout.js";
import type { OfficeModel } from "../model.js";
import { visorColor, type ScenePalette } from "./palette.js";

export type RobotPose = "typing" | "idle" | "raised" | "slumped" | "walking";

/** A desk stands this far in front (+z) of its seat; robots at their desks face +z. */
export const DESK_OFFSET_Z = 0.55;

export interface RobotPlan {
  agentId: string;
  roomId: string;
  seat: Point;
  seatIndex: number;
  door: Point;
  side: boolean;
  pose: RobotPose;
  visor: string;
  /** Amber for a pending permission, red for an error, else none. */
  light: string | null;
  screenLit: boolean;
}

export interface RoomPlan {
  roomId: string;
  label: string;
  center: Point;
  /** Rows of desks the room has. */
  rows: number;
  /** From the back wall to the front wall. */
  depth: number;
  board: Point;
  door: Point;
  labelAt: Point;
}

export interface ScenePlan {
  rooms: RoomPlan[];
  robots: RobotPlan[];
  bounds: Bounds;
  /** The column count the rooms were dealt for; another count is a new arrangement. */
  columns: number;
}

export interface RobotFrame {
  x: number;
  z: number;
  /** Vertical offset of the whole robot. */
  lift: number;
  /** Rotation about the vertical axis; 0 faces +z (the camera). */
  heading: number;
  /** Forward tilt of the body; negative leans back. */
  lean: number;
  armLeft: number;
  armRight: number;
}

/** "smooth" draws every frame; "typing" draws every TYPING_FRAME_MS. */
export type AnimationNeed = "none" | "smooth" | "typing";

export const WALK_MS = 1500;
export const TYPING_FRAME_MS = 50;
const ARM_TYPING = -1.2;
const ARM_UP = Math.PI;
/** How far a standing robot rises. Its base stays just under the desk top, so no gap shows. */
const STAND_LIFT = 0.32;
/** Each seat starts its typing stroke this much later in the cycle (radians). */
const SEAT_PHASE = 2.4;

export function robotPose(agent: OfficeAgent): RobotPose {
  if (agent.permissions.length > 0) return "raised";
  if (agent.status === "error") return "slumped";
  if (agent.status === "initializing") return "walking";
  if (agent.status === "running") return "typing";
  return "idle";
}

export function roomLabel(name: string, overflow: number): string {
  return overflow > 0 ? `${name} +${overflow}` : name;
}

function lightFor(pose: RobotPose, palette: ScenePalette): string | null {
  if (pose === "raised") return palette.lightWarning;
  if (pose === "slumped") return palette.lightDanger;
  return null;
}

export function buildScenePlan(
  model: OfficeModel,
  layout: OfficeLayout,
  palette: ScenePalette,
): ScenePlan {
  const names = new Map(model.rooms.map((room) => [room.id, room.name]));
  const rooms = layout.rooms.map(
    (room): RoomPlan => ({
      roomId: room.roomId,
      label: roomLabel(names.get(room.roomId) ?? room.roomId, room.overflow),
      center: room.center,
      rows: room.rows,
      depth: room.depth,
      board: room.board,
      door: room.door,
      labelAt: room.label,
    }),
  );
  const robots: RobotPlan[] = [];
  for (const room of layout.rooms) {
    for (const seat of room.seats) {
      const agent = model.agents.get(seat.agentId);
      if (!agent) continue;
      const pose = robotPose(agent);
      robots.push({
        agentId: agent.id,
        roomId: room.roomId,
        seat: { x: seat.x, z: seat.z },
        seatIndex: seat.index,
        door: room.door,
        side: seat.side,
        pose,
        // The visor sits on the head, which is graphite in a light theme too
        // (palette.robotHead), so it takes the identity colour for a dark surface in both.
        visor: visorColor(agent.provider, true),
        light: lightFor(pose, palette),
        screenLit: agent.status === "running",
      });
    }
  }
  robots.sort((left, right) => left.agentId.localeCompare(right.agentId));
  return { rooms, robots, bounds: layout.bounds, columns: layout.columns };
}

export interface DeskPlan {
  x: number;
  z: number;
  screenLit: boolean;
}

/** Every main seat of a room's rows gets a desk, so an empty room still reads as an office. */
export function deskPlans(plan: ScenePlan): DeskPlan[] {
  const lit = new Map(
    plan.robots.map((robot) => [`${robot.roomId}:${robot.seatIndex}`, robot.screenLit]),
  );
  const desks: DeskPlan[] = [];
  for (const room of plan.rooms) {
    for (let index = 0; index < room.rows * CELL_COLUMNS * 2; index += 2) {
      const seat = seatPosition(room, index);
      desks.push({
        x: seat.x,
        z: seat.z + DESK_OFFSET_Z,
        screenLit: lit.get(`${room.roomId}:${index}`) ?? false,
      });
    }
  }
  for (const robot of plan.robots) {
    if (!robot.side) continue;
    desks.push({ x: robot.seat.x, z: robot.seat.z + DESK_OFFSET_Z, screenLit: robot.screenLit });
  }
  return desks;
}

function seated(
  robot: RobotPlan,
  lean: number,
  armLeft: number,
  armRight: number,
  lift = 0,
): RobotFrame {
  return { x: robot.seat.x, z: robot.seat.z, lift, heading: 0, lean, armLeft, armRight };
}

function walkingFrame(
  robot: RobotPlan,
  enteredAt: number,
  now: number,
  reducedMotion: boolean,
): RobotFrame {
  const progress = reducedMotion ? 1 : Math.min(1, Math.max(0, (now - enteredAt) / WALK_MS));
  if (progress >= 1) return seated(robot, 0, 0, 0);
  const dx = robot.seat.x - robot.door.x;
  const dz = robot.seat.z - robot.door.z;
  const swing = Math.sin(now / 150) * 0.5;
  return {
    x: robot.door.x + dx * progress,
    z: robot.door.z + dz * progress,
    lift: Math.abs(Math.sin(now / 150)) * 0.05,
    heading: Math.atan2(dx, dz),
    lean: 0.05,
    armLeft: swing,
    armRight: -swing,
  };
}

/**
 * The robot's transform at `now`; `enteredAt` is when the scene first saw the agent.
 *
 * Seen from above, each pose is its own silhouette, so state reads without colour or motion:
 * typing sits upright with both arms on the desk; idle leans back from it; raised stands taller
 * than its neighbours with one arm straight up; slumped folds forward onto the desk; a starting
 * robot crosses from the door, then sits upright with its arms down. The light rides on the
 * body, so the amber one is the highest thing in the room and the red one hangs low over the desk.
 */
export function robotFrame(
  robot: RobotPlan,
  enteredAt: number,
  now: number,
  reducedMotion: boolean,
): RobotFrame {
  switch (robot.pose) {
    case "typing": {
      // Neighbours type out of step; in unison a room of typists reads as one looping clip.
      const stroke = now / 110 + robot.seatIndex * SEAT_PHASE;
      const bob = reducedMotion ? 0 : Math.sin(stroke) * 0.18;
      return seated(robot, 0.08, ARM_TYPING + bob, ARM_TYPING - bob);
    }
    case "idle":
      return seated(robot, -0.3, 0, 0);
    case "raised":
      return seated(robot, 0, 0, ARM_UP, STAND_LIFT);
    case "slumped":
      return seated(robot, 0.55, 0.25, 0.25, -0.08);
    case "walking":
      return walkingFrame(robot, enteredAt, now, reducedMotion);
  }
}

export function animationNeed(
  robots: readonly RobotPlan[],
  enteredAt: ReadonlyMap<string, number>,
  now: number,
  reducedMotion: boolean,
): AnimationNeed {
  if (reducedMotion) return "none";
  const walking = robots.some(
    (robot) => robot.pose === "walking" && now - (enteredAt.get(robot.agentId) ?? now) < WALK_MS,
  );
  if (walking) return "smooth";
  return robots.some((robot) => robot.pose === "typing") ? "typing" : "none";
}
