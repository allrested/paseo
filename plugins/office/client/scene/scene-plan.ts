import type { OfficeAgent, Post } from "../../shared/contracts.js";
import { orderBoardPosts } from "../board-text.js";
import {
  CELL_COLUMNS,
  ROOM_WIDTH,
  WALL_HEIGHT,
  seatPosition,
  type Bounds,
  type OfficeLayout,
  type Point,
} from "../layout.js";
import type { OfficeModel, OfficeRoom } from "../model.js";
import { sceneVisor, type ScenePalette } from "./palette.js";

export type RobotPose = "typing" | "idle" | "raised" | "slumped" | "walking";

/**
 * The lamp on a robot's antenna, the dot of the list view: off while it rests or arrives, steady
 * while it works, the warning colour while it waits for an answer, the danger colour after an error.
 */
export type LampState = "off" | "steady" | "warning" | "danger";

/** A desk stands this far in front (+z) of its seat; robots at their desks face +z. */
export const DESK_OFFSET_Z = 0.55;
export const DESK_SIZE = { width: 1, height: 0.7, depth: 0.6 };
/** The whiteboard's face, upright and turned to +z, and how high its middle stands. */
export const BOARD_SIZE = { width: 4, height: 1.6, depth: 0.06 };
export const BOARD_CENTER_Y = 1.3;
/** A note is a slip of this size, upright like the face it is stuck to. */
export const NOTE_SIZE = { width: 0.62, height: 0.5, depth: 0.02 };
/** A whiteboard holds this many notes, in rows of `NOTE_COLUMNS`. */
export const NOTE_SLOTS = 8;
const NOTE_COLUMNS = 4;
/** A note's middle stands this far off the face it is stuck to. */
const NOTE_STANDOFF = 0.03;
/**
 * Each further note on one desk lies this far right, down and forward of the one before, so
 * two notes never share a plane and a second one shows. From the third on only forward: the
 * desk's front is no wider.
 */
const DESK_FAN = { x: 0.12, y: 0.05, z: 0.03, steps: 2 };
/** A removed note fades for this long; a paper plane flies for `PLANE_MS`. */
export const NOTE_FADE_MS = 800;
export const PLANE_MS = 1400;
/**
 * A plane leaves and lands at this height, over the walls. On the way it rises by a third of
 * the distance it has to go, `PLANE_ARC` at most: a hop to the next desk is a low arc, and only a
 * flight to another room goes high. From the camera's side a high arc on a short hop reads as a
 * plane that hangs in place.
 */
export const PLANE_Y = 1.4;
const PLANE_ARC = 2;
const PLANE_RISE = 1 / 3;

export const WALL_THICKNESS = 0.12;
/**
 * A note on a desk is drawn at this share of its size on the whiteboard: the desk's front then
 * shows around it, as the whiteboard does, and it reads as a slip stuck there and not as a panel.
 */
export const DESK_NOTE_SCALE = 0.75;
/** A name plate's middle stands this far above the top of its room's back wall. */
const PLATE_RISE = 0.45;

export interface RobotPlan {
  agentId: string;
  roomId: string;
  seat: Point;
  seatIndex: number;
  door: Point;
  side: boolean;
  pose: RobotPose;
  visor: string;
  lamp: LampState;
  lampColor: string;
  /** The desk is lit while the robot types, and only then. */
  screenLit: boolean;
}

export interface RoomPlan {
  roomId: string;
  /** The name, then `overflowTail(overflow)`. */
  label: string;
  /** Agents of the room that have no desk. */
  overflow: number;
  center: Point;
  /** Rows of desks the room has. */
  rows: number;
  /** From the back wall to the front wall. */
  depth: number;
  board: Point;
  door: Point;
  labelAt: Point;
}

export interface NotePlan {
  postId: string;
  /** The room whose board the post is on, wherever its note is. */
  roomId: string;
  x: number;
  y: number;
  z: number;
  color: string;
  /** On the front of its claimer's desk; otherwise on the whiteboard. */
  onDesk: boolean;
}

/** A post that names an agent: a paper plane flies it from `from` to `to`. */
export interface MentionPlan {
  postId: string;
  from: Point;
  to: Point;
}

export interface ScenePlan {
  rooms: RoomPlan[];
  robots: RobotPlan[];
  bounds: Bounds;
  /** The column count the rooms were dealt for; another count is a new arrangement. */
  columns: number;
  notes: NotePlan[];
  mentions: MentionPlan[];
}

export interface PlaneFrame {
  x: number;
  y: number;
  z: number;
  /** Rotation about the vertical axis; 0 points to +z. */
  heading: number;
  done: boolean;
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
  /** The head's own forward tilt, on top of the body's: positive looks down. */
  nod: number;
  /** The head laid over to one side. */
  tilt: number;
  armLeft: number;
  armRight: number;
  /** The right arm swung out to its side, on top of its splay: the wave of a waiting robot. */
  armSway: number;
}

/** "smooth" draws every frame; "typing" draws every TYPING_FRAME_MS. */
export type AnimationNeed = "none" | "smooth" | "typing";

export const WALK_MS = 1500;
/** A robot that starts to wait waves for this long, once, and then holds its hand still. */
export const WAVE_MS = 1400;
/** How far the hand swings to each side at first, in radians, and how many times it goes over. */
const WAVE_REACH = 0.42;
const WAVE_SWINGS = 2.5;
export const TYPING_FRAME_MS = 50;
const ARM_TYPING = -1.2;
const ARM_UP = Math.PI;
/** How far a robot that stands up rises on its stand. */
const STAND_LIFT = 0.32;
/** Each seat starts its typing stroke this much later in the cycle (radians). */
export const SEAT_PHASE = 2.4;
/** A typing robot looks down at its desk by this much, and its head sways by `HEAD_SWAY`. */
const NOD_TYPING = 0.2;
const HEAD_SWAY = 0.07;
/** How far a resting head lies over. */
const REST_TILT = 0.16;

/** Which side a resting head lies to: the same for a desk and its side desk, the other next door. */
function restSide(seatIndex: number): number {
  return Math.floor(seatIndex / 2) % 2 === 0 ? 1 : -1;
}

export function robotPose(agent: OfficeAgent): RobotPose {
  if (agent.permissions.length > 0) return "raised";
  if (agent.status === "error") return "slumped";
  if (agent.status === "initializing") return "walking";
  if (agent.status === "running") return "typing";
  return "idle";
}

/** What a room's label adds for `overflow` agents without a desk; nothing for none. */
export function overflowTail(overflow: number): string {
  return overflow > 0 ? `, ${overflow} more` : "";
}

export function roomLabel(name: string, overflow: number): string {
  return `${name}${overflowTail(overflow)}`;
}

const LAMPS: Record<RobotPose, LampState> = {
  typing: "steady",
  idle: "off",
  walking: "off",
  raised: "warning",
  slumped: "danger",
};

function lampColor(lamp: LampState, palette: ScenePalette): string {
  const colors: Record<LampState, string> = {
    off: palette.lampOff,
    steady: palette.lampOn,
    warning: palette.lightWarning,
    danger: palette.lightDanger,
  };
  return colors[lamp];
}

function boardSlot(board: Point, index: number): { x: number; y: number; z: number } {
  const column = index % NOTE_COLUMNS;
  const row = Math.floor(index / NOTE_COLUMNS);
  const rows = NOTE_SLOTS / NOTE_COLUMNS;
  return {
    x: board.x + (column - (NOTE_COLUMNS - 1) / 2) * (BOARD_SIZE.width / NOTE_COLUMNS),
    y: BOARD_CENTER_Y + ((rows - 1) / 2 - row) * (BOARD_SIZE.height / rows),
    z: board.z + (BOARD_SIZE.depth / 2 + NOTE_STANDOFF),
  };
}

/** The `index`th note on the front of the desk of the robot seated at `seat`. */
function deskSlot(seat: Point, index: number): { x: number; y: number; z: number } {
  const step = Math.min(index, DESK_FAN.steps);
  return {
    x: seat.x + step * DESK_FAN.x,
    y: DESK_SIZE.height / 2 - step * DESK_FAN.y,
    z: seat.z + DESK_OFFSET_Z + DESK_SIZE.depth / 2 + NOTE_STANDOFF + index * DESK_FAN.z,
  };
}

function noteColor(post: Post, palette: ScenePalette): string {
  if (post.kind === "note") return palette.noteNote;
  return post.state === "claimed" ? palette.noteClaimed : palette.noteTask;
}

/**
 * A room's posts as notes, in board order. A claimed task is on its claimer's desk, in whatever
 * room that is; everything else takes the whiteboard's places from the top left, and what does
 * not fit is left to the list view and the board sheet.
 */
function roomNotes(
  room: OfficeRoom,
  board: Point,
  robots: ReadonlyMap<string, RobotPlan>,
  onDesks: Map<string, number>,
  palette: ScenePalette,
): NotePlan[] {
  const notes: NotePlan[] = [];
  let slot = 0;
  for (const post of orderBoardPosts(room.posts)) {
    const base = { postId: post.id, roomId: room.id, color: noteColor(post, palette) };
    const claimer =
      post.state === "claimed" && post.claimedBy !== undefined
        ? robots.get(post.claimedBy)
        : undefined;
    if (claimer) {
      const before = onDesks.get(claimer.agentId) ?? 0;
      onDesks.set(claimer.agentId, before + 1);
      notes.push({ ...base, ...deskSlot(claimer.seat, before), onDesk: true });
    } else if (slot < NOTE_SLOTS) {
      notes.push({ ...base, ...boardSlot(board, slot), onDesk: false });
      slot += 1;
    }
  }
  return notes;
}

/**
 * The user has no seat: their post leaves from the room's whiteboard. An agent that names itself
 * has nowhere to send a plane.
 */
function roomMentions(
  room: OfficeRoom,
  board: Point,
  robots: ReadonlyMap<string, RobotPlan>,
): MentionPlan[] {
  const mentions: MentionPlan[] = [];
  for (const post of room.posts) {
    const target = post.to === undefined ? undefined : robots.get(post.to);
    if (!target || post.to === post.author) continue;
    const from = robots.get(post.author)?.seat ?? board;
    mentions.push({ postId: post.id, from, to: target.seat });
  }
  return mentions;
}

/** Where a plane is `now`: straight over the ground from start to end, up and down in one arc. */
export function planeFrame(mention: MentionPlan, startedAt: number, now: number): PlaneFrame {
  const t = Math.min(1, Math.max(0, (now - startedAt) / PLANE_MS));
  const dx = mention.to.x - mention.from.x;
  const dz = mention.to.z - mention.from.z;
  const arc = Math.min(PLANE_ARC, Math.hypot(dx, dz) * PLANE_RISE);
  return {
    x: mention.from.x + dx * t,
    y: PLANE_Y + Math.sin(Math.PI * t) * arc,
    z: mention.from.z + dz * t,
    heading: Math.atan2(dx, dz),
    done: t >= 1,
  };
}

/** Opacity of a removed note, 1 down to 0 over NOTE_FADE_MS. */
export function noteFade(startedAt: number, now: number): number {
  return 1 - Math.min(1, Math.max(0, (now - startedAt) / NOTE_FADE_MS));
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
      overflow: room.overflow,
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
      const lamp = LAMPS[pose];
      robots.push({
        agentId: agent.id,
        roomId: room.roomId,
        seat: { x: seat.x, z: seat.z },
        seatIndex: seat.index,
        door: room.door,
        side: seat.side,
        pose,
        // The provider's identity colour for a dark surface, muted near the state hues.
        visor: sceneVisor(agent.provider, palette),
        lamp,
        lampColor: lampColor(lamp, palette),
        // An agent that waits for an answer is not working: its amber lamp is the light there.
        screenLit: pose === "typing",
      });
    }
  }
  robots.sort((left, right) => left.agentId.localeCompare(right.agentId));
  const byAgent = new Map(robots.map((item) => [item.agentId, item]));
  const onDesks = new Map<string, number>();
  const notes: NotePlan[] = [];
  const mentions: MentionPlan[] = [];
  for (const room of model.rooms) {
    const placed = layout.roomById.get(room.id);
    if (!placed) continue;
    notes.push(...roomNotes(room, placed.board, byAgent, onDesks, palette));
    mentions.push(...roomMentions(room, placed.board, byAgent));
  }
  return { rooms, robots, bounds: layout.bounds, columns: layout.columns, notes, mentions };
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

/** At its seat, upright with its arms down, but for what `posture` says. */
function seated(
  robot: RobotPlan,
  posture: Partial<Omit<RobotFrame, "x" | "z" | "heading">>,
): RobotFrame {
  return {
    x: robot.seat.x,
    z: robot.seat.z,
    lift: 0,
    heading: 0,
    lean: 0,
    nod: 0,
    tilt: 0,
    armLeft: 0,
    armRight: 0,
    armSway: 0,
    ...posture,
  };
}

/**
 * How far the raised hand is out to its side `since` milliseconds after the robot began to
 * wait: over and back `WAVE_SWINGS` times, less each time, and still from `WAVE_MS` on.
 */
function waveSway(since: number): number {
  const progress = since / WAVE_MS;
  if (!(progress > 0) || progress >= 1) return 0;
  return Math.sin(progress * WAVE_SWINGS * 2 * Math.PI) * WAVE_REACH * (1 - progress);
}

function walkingFrame(
  robot: RobotPlan,
  enteredAt: number,
  now: number,
  reducedMotion: boolean,
): RobotFrame {
  const progress = reducedMotion ? 1 : Math.min(1, Math.max(0, (now - enteredAt) / WALK_MS));
  if (progress >= 1) return seated(robot, {});
  const dx = robot.seat.x - robot.door.x;
  const dz = robot.seat.z - robot.door.z;
  const swing = Math.sin(now / 150) * 0.5;
  return {
    x: robot.door.x + dx * progress,
    z: robot.door.z + dz * progress,
    lift: Math.abs(Math.sin(now / 150)) * 0.05,
    heading: Math.atan2(dx, dz),
    lean: 0.05,
    nod: 0,
    tilt: 0,
    armLeft: swing,
    armRight: -swing,
    armSway: 0,
  };
}

/**
 * The robot's transform at `now`; `enteredAt` is when the scene first saw the agent and
 * `posedAt` when it took its present pose (the same moment, unless the scene says otherwise).
 *
 * Seen from above, each pose is its own silhouette, so state reads without colour or motion:
 * typing sits upright with both arms on the desk and looks down at it; idle leans back with its
 * head laid to one side; raised stands taller than its neighbours with one arm straight up and
 * looks ahead, and waves that arm once when it starts to wait; slumped folds forward over its
 * desk with its arms hanging, its head on one side and its face still up to the room; a starting
 * robot crosses from the door, then sits upright with its arms down.
 */
export function robotFrame(
  robot: RobotPlan,
  enteredAt: number,
  now: number,
  reducedMotion: boolean,
  posedAt: number = enteredAt,
): RobotFrame {
  switch (robot.pose) {
    case "typing": {
      // Neighbours type out of step; in unison a room of typists reads as one looping clip.
      const stroke = now / 110 + robot.seatIndex * SEAT_PHASE;
      const bob = reducedMotion ? 0 : Math.sin(stroke) * 0.18;
      // The head follows the hands at a third of their pace.
      const sway = reducedMotion ? 0 : Math.sin(stroke / 3) * HEAD_SWAY;
      return seated(robot, {
        lean: 0.08,
        nod: NOD_TYPING + sway,
        armLeft: ARM_TYPING + bob,
        armRight: ARM_TYPING - bob,
      });
    }
    case "idle":
      return seated(robot, { lean: -0.3, nod: -0.1, tilt: restSide(robot.seatIndex) * REST_TILT });
    case "raised":
      return seated(robot, {
        lift: STAND_LIFT,
        armRight: ARM_UP,
        armSway: reducedMotion ? 0 : waveSway(now - posedAt),
      });
    case "slumped":
      return seated(robot, {
        lift: -0.08,
        lean: 0.5,
        nod: -0.4,
        tilt: 0.9,
        armLeft: -0.5,
        armRight: -0.5,
      });
    case "walking":
      return walkingFrame(robot, enteredAt, now, reducedMotion);
  }
}

export function animationNeed(
  robots: readonly RobotPlan[],
  enteredAt: ReadonlyMap<string, number>,
  now: number,
  reducedMotion: boolean,
  posedAt: ReadonlyMap<string, number> = enteredAt,
): AnimationNeed {
  if (reducedMotion) return "none";
  const walking = robots.some(
    (robot) => robot.pose === "walking" && now - (enteredAt.get(robot.agentId) ?? now) < WALK_MS,
  );
  const waving = robots.some((robot) => {
    const began = robot.pose === "raised" ? posedAt.get(robot.agentId) : undefined;
    return began !== undefined && now - began < WAVE_MS;
  });
  if (walking || waving) return "smooth";
  return robots.some((robot) => robot.pose === "typing") ? "typing" : "none";
}

/**
 * Where a room's name plate hangs: over the back left corner, the first point of the room on
 * screen. The plates of a column start on one line, each above the room it names.
 */
export function labelAnchor(room: RoomPlan): { x: number; y: number; z: number } {
  return {
    x: room.center.x - ROOM_WIDTH / 2,
    y: WALL_HEIGHT + PLATE_RISE,
    z: room.center.z - room.depth / 2,
  };
}

/** The ground a room's slab covers. */
export function roomFootprint(room: RoomPlan): Bounds {
  const halfWidth = (ROOM_WIDTH + WALL_THICKNESS) / 2;
  const halfDepth = (room.depth + WALL_THICKNESS) / 2;
  return {
    minX: room.center.x - halfWidth,
    maxX: room.center.x + halfWidth,
    minZ: room.center.z - halfDepth,
    maxZ: room.center.z + halfDepth,
  };
}
