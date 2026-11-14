// The office as positions on a picture: where the sheet page draws each still, and where the app
// lays it. Pure; nothing here touches the DOM.
import { VIEW_TURN } from "../layout.js";
import {
  MAX_BACKDROP_PIXELS,
  MAX_SPRITE_WIDTH,
  TILE_SIDE,
  type Sheet,
  type SheetPoint,
  type SheetRect,
  type SheetRobot,
} from "../../shared/sheet.js";
import {
  FIRST_MARGINS,
  GROUND_SCALE,
  RISE_SCALE,
  VIEW_HEIGHT,
  firstView,
  pixelsPerUnit,
  screenPoint,
  type CameraView,
  type GroundSpan,
  type Viewport,
} from "./camera.js";
import {
  BOARD_CENTER_Y,
  BOARD_SIZE,
  DESK_NOTE_SCALE,
  NOTE_SIZE,
  PLANE_Y,
  SEAT_PHASE,
  WALK_MS,
  WAVE_MS,
  labelAnchor,
  robotFrame,
  type LampState,
  type RobotFrame,
  type RobotPlan,
  type RobotPose,
  type ScenePlan,
} from "./scene-plan.js";

/** A still's camera and size: `StillFrame` of office-stills.web.ts. */
export interface SheetFrame {
  view: CameraView;
  /** Screen points. */
  viewport: Viewport;
  /** Picture pixels per screen point. */
  ratio: number;
}

const TURN_SIN = Math.sin(VIEW_TURN);
const TURN_COS = Math.cos(VIEW_TURN);
const MAX_RATIO = 2;
/** Chest height of a robot: where a tap is measured from. */
export const CHEST_Y = 1;
/**
 * The ground and height a robot's sprite covers around its seat: its shadow, its desk and the
 * desk's shadow, the light of a lit screen, a raised arm, a lamp grown to stay findable.
 */
const SPRITE_REACH = { minX: -1.15, maxX: 1.15, minZ: -0.95, maxZ: 1.55, top: 2.75 };
/** Clear pixels around a sprite, so no soft edge is cut. */
const SPRITE_PAD = 2;
/** A typing robot's arms go round once in this many units of `robotFrame`'s clock. */
const STROKE_MS = 2 * Math.PI * 110;
/** The head sways once in three strokes: a loop of three strokes has no jump. */
const TYPING_STROKES = 3;

export interface SpriteClip {
  frames: number;
  frameMs: number;
  loop: boolean;
}

const STILL: SpriteClip = { frames: 1, frameMs: 0, loop: false };
const TYPING_FRAMES = 24;
export const SPRITE_CLIPS: Record<RobotPose, SpriteClip> = {
  typing: {
    frames: TYPING_FRAMES,
    frameMs: (STROKE_MS * TYPING_STROKES) / TYPING_FRAMES,
    loop: true,
  },
  raised: { frames: 20, frameMs: WAVE_MS / 20, loop: false },
  idle: STILL,
  slumped: STILL,
  walking: STILL,
};

function whole(value: number): number {
  return Math.max(1, Math.round(value));
}

/** Screen points from the seen ground offset `across`, `toward` to the world. */
function unseen(across: number, toward: number): { x: number; z: number } {
  return { x: across * TURN_COS + toward * TURN_SIN, z: toward * TURN_COS - across * TURN_SIN };
}

/**
 * The backdrop's camera and size for a viewer: the first view at its scale and as wide as the
 * viewer, carried on downwards until the whole of `span` is in it. As sharp as the viewer, twice
 * at most, less for a picture over `MAX_BACKDROP_PIXELS`, and never under one pixel per point.
 */
export function sheetFrame(span: GroundSpan, viewer: Viewport, pixelRatio: number): SheetFrame {
  const first: Viewport = { width: whole(viewer.width), height: whole(viewer.height) };
  const view = firstView(span, first, FIRST_MARGINS);
  const perUnit = pixelsPerUnit(view, first);
  const nearEdge = unseen(0, span.near);
  const bottom = screenPoint(view, first, { x: nearEdge.x, y: 0, z: nearEdge.z }).y;
  const height = Math.max(first.height, Math.ceil(bottom + FIRST_MARGINS.bottom));
  const sharp = Math.min(MAX_RATIO, Math.max(1, pixelRatio));
  const fits = Math.sqrt(MAX_BACKDROP_PIXELS / (first.width * height));
  const ratio = Math.max(1, Math.min(sharp, fits));
  // Whole picture pixels, and one scale both ways: the size in points gives way by a fraction.
  const viewport = {
    width: whole(first.width * ratio) / ratio,
    height: whole(height * ratio) / ratio,
  };
  // The taller picture has its middle further down the office, at the same scale.
  const lower = ((viewport.height - first.height) / 2 / perUnit) * GROUND_SCALE;
  const shift = unseen(0, lower);
  return {
    view: {
      x: view.x + shift.x,
      z: view.z + shift.z,
      zoom: (perUnit * VIEW_HEIGHT) / viewport.height,
    },
    viewport,
    ratio,
  };
}

/** A frame's size in picture pixels. */
export function picturePixels(frame: SheetFrame): { width: number; height: number } {
  return {
    width: whole(frame.viewport.width * frame.ratio),
    height: whole(frame.viewport.height * frame.ratio),
  };
}

/** Picture pixels per world unit. */
export function pictureScale(frame: SheetFrame): number {
  return pixelsPerUnit(frame.view, frame.viewport) * frame.ratio;
}

export interface SpriteBox {
  /** Picture pixels. */
  width: number;
  height: number;
  /** Where the seat's place on the floor is in the frame. */
  seat: SheetPoint;
  chest: SheetPoint;
}

/** A sprite's frame at `scale` picture pixels per world unit: the same for every robot. */
export function spriteBox(scale: number): SpriteBox {
  const { minX, maxX, minZ, maxZ, top } = SPRITE_REACH;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const x of [minX, maxX]) {
    for (const z of [minZ, maxZ]) {
      for (const y of [0, top]) {
        xs.push((x * TURN_COS - z * TURN_SIN) * scale);
        ys.push(-(y / RISE_SCALE - (x * TURN_SIN + z * TURN_COS) / GROUND_SCALE) * scale);
      }
    }
  }
  const left = Math.floor(Math.min(...xs)) - SPRITE_PAD;
  const up = Math.floor(Math.min(...ys)) - SPRITE_PAD;
  const seat = { x: -left, y: -up };
  return {
    width: Math.ceil(Math.max(...xs)) + SPRITE_PAD - left,
    height: Math.ceil(Math.max(...ys)) + SPRITE_PAD - up,
    seat,
    chest: { x: seat.x, y: seat.y - (CHEST_Y / RISE_SCALE) * scale },
  };
}

/** The camera that draws a robot seated at the world's origin into `box`, at `ratio`. */
export function spriteFrame(box: SpriteBox, scale: number, ratio: number): SheetFrame {
  const viewport = { width: box.width / ratio, height: box.height / ratio };
  // The camera looks at the middle of the frame; the seat is off it by this much.
  const across = (box.width / 2 - box.seat.x) / scale;
  const toward = ((box.height / 2 - box.seat.y) / scale) * GROUND_SCALE;
  const at = unseen(across, toward);
  return {
    view: { x: at.x, z: at.z, zoom: ((scale / ratio) * VIEW_HEIGHT) / viewport.height },
    viewport,
    ratio,
  };
}

const POSES: readonly RobotPose[] = ["typing", "idle", "raised", "slumped", "walking"];
const LAMPS: readonly LampState[] = ["off", "steady", "warning", "danger"];
const COLOR = /^[#a-zA-Z0-9(),.% ]{1,40}$/;

/** Which side a resting head lies to: `robotFrame` reads it off the seat's index. */
function restsLeft(robot: RobotPlan): boolean {
  return robot.pose === "idle" && Math.floor(robot.seatIndex / 2) % 2 !== 0;
}

/** Names what a robot looks like, wherever it sits: two robots with one key share a sprite. */
export function spriteKey(robot: RobotPlan): string {
  return [
    robot.pose,
    robot.visor,
    robot.lamp,
    robot.lampColor,
    robot.screenLit ? "1" : "0",
    robot.side ? "1" : "0",
    restsLeft(robot) ? "1" : "0",
  ].join("|");
}

function flag(value: string | undefined): boolean | null {
  if (value === "1") return true;
  return value === "0" ? false : null;
}

/** A robot seated at the world's origin that looks as `key` says; null for a key it cannot read. */
export function spriteLook(key: string): RobotPlan | null {
  const [pose, visor, lamp, lampColor, lit, side, left, ...rest] = key.split("|");
  const screenLit = flag(lit);
  const sideDesk = flag(side);
  const restLeft = flag(left);
  if (rest.length > 0 || screenLit === null || sideDesk === null || restLeft === null) return null;
  const knownPose = POSES.find((candidate) => candidate === pose);
  const knownLamp = LAMPS.find((candidate) => candidate === lamp);
  if (knownPose === undefined || knownLamp === undefined) return null;
  if (visor === undefined || lampColor === undefined) return null;
  if (!COLOR.test(visor) || !COLOR.test(lampColor)) return null;
  return {
    agentId: "",
    roomId: "",
    seat: { x: 0, z: 0 },
    seatIndex: restLeft ? 2 : 0,
    door: { x: 0, z: 0 },
    side: sideDesk,
    pose: knownPose,
    visor,
    lamp: knownLamp,
    lampColor,
    screenLit,
  };
}

/** How the robot of a sprite stands in frame `index` of its clip. */
export function clipMotion(look: RobotPlan, index: number): RobotFrame {
  const clip = SPRITE_CLIPS[look.pose];
  if (look.pose === "typing") return robotFrame(look, 0, index * clip.frameMs, false);
  // The wave is over at its last frame: the hand is held up, still.
  if (look.pose === "raised") return robotFrame(look, 0, (index + 1) * clip.frameMs, false, 0);
  // A robot that has arrived: at its seat, upright.
  if (look.pose === "walking") return robotFrame(look, 0, WALK_MS, false);
  return robotFrame(look, 0, 0, false);
}

/** The frame a typing robot at this seat starts its loop at: neighbours type out of step. */
export function typingPhase(seatIndex: number): number {
  const frames = SPRITE_CLIPS.typing.frames;
  const perRadian = frames / (TYPING_STROKES * 2 * Math.PI);
  return ((Math.round(seatIndex * SEAT_PHASE * perRadian) % frames) + frames) % frames;
}

/** Columns of a sprite's grid of frames: as many as fit `MAX_SPRITE_WIDTH`. */
export function spriteColumns(frames: number, frameWidth: number): number {
  return Math.max(1, Math.min(frames, Math.floor(MAX_SPRITE_WIDTH / frameWidth)));
}

/** Tiles of at most `TILE_SIDE` that cover a picture, row by row. */
export function tileRects(width: number, height: number): SheetRect[] {
  const tiles: SheetRect[] = [];
  for (let y = 0; y < height; y += TILE_SIDE) {
    for (let x = 0; x < width; x += TILE_SIDE) {
      tiles.push({
        x,
        y,
        width: Math.min(TILE_SIDE, width - x),
        height: Math.min(TILE_SIDE, height - y),
      });
    }
  }
  return tiles;
}

/** What the backdrop and the overlay show. They are drawn again when it changes, and only then. */
export function stillSignature(plan: ScenePlan, frame: SheetFrame): string {
  const rooms = plan.rooms.map((room) => [
    room.roomId,
    room.label,
    room.center.x,
    room.center.z,
    room.rows,
    room.depth,
  ]);
  const notes = plan.notes.map((note) => [note.x, note.y, note.z, note.color, note.onDesk]);
  return JSON.stringify({ rooms, notes, frame });
}

export interface SheetInput {
  plan: ScenePlan;
  frame: SheetFrame;
  version: number;
  tiles: number;
  /** Agents whose pose began less than a wave ago. */
  fresh: ReadonlySet<string>;
  /** Each room's name plate as drawn, in screen points. */
  plates: ReadonlyMap<string, { width: number; height: number }>;
}

function boundsOf(points: readonly SheetPoint[]): SheetRect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function buildSheet({ plan, frame, version, tiles, fresh, plates }: SheetInput): Sheet {
  const { view, viewport, ratio } = frame;
  const scale = pictureScale(frame);
  const at = (point: { x: number; y: number; z: number }): SheetPoint => {
    const screen = screenPoint(view, viewport, point);
    return { x: screen.x * ratio, y: screen.y * ratio };
  };
  /** An upright face turned to +z, as the board and every note are. */
  const face = (center: { x: number; y: number; z: number }, width: number, height: number) =>
    boundsOf(
      [-1, 1].flatMap((side) =>
        [-1, 1].map((up) =>
          at({ x: center.x + (side * width) / 2, y: center.y + (up * height) / 2, z: center.z }),
        ),
      ),
    );
  const box = spriteBox(scale);
  const depth = (robot: RobotPlan) => robot.seat.x * TURN_SIN + robot.seat.z * TURN_COS;
  const robots = [...plan.robots]
    .sort((a, b) => depth(a) - depth(b) || a.agentId.localeCompare(b.agentId))
    .map((robot): SheetRobot => {
      const seat = at({ x: robot.seat.x, y: 0, z: robot.seat.z });
      return {
        agentId: robot.agentId,
        key: spriteKey(robot),
        x: Math.round(seat.x - box.seat.x),
        y: Math.round(seat.y - box.seat.y),
        phase: robot.pose === "typing" ? typingPhase(robot.seatIndex) : 0,
        joining: robot.pose === "walking",
        fresh: fresh.has(robot.agentId),
      };
    });
  const rooms = plan.rooms.map((room) => {
    const hung = at(labelAnchor(room));
    const plate = plates.get(room.roomId) ?? { width: 0, height: 0 };
    return {
      roomId: room.roomId,
      board: face(
        { x: room.board.x, y: BOARD_CENTER_Y, z: room.board.z },
        BOARD_SIZE.width,
        BOARD_SIZE.height,
      ),
      plate: {
        x: hung.x,
        y: hung.y - (plate.height * ratio) / 2,
        width: plate.width * ratio,
        height: plate.height * ratio,
      },
    };
  });
  const notes = plan.notes
    .filter((note) => note.onDesk)
    .map((note) => ({
      roomId: note.roomId,
      rect: face(note, NOTE_SIZE.width * DESK_NOTE_SCALE, NOTE_SIZE.height * DESK_NOTE_SCALE),
    }));
  const mentions = plan.mentions.map((mention) => ({
    postId: mention.postId,
    from: at({ x: mention.from.x, y: PLANE_Y, z: mention.from.z }),
    to: at({ x: mention.to.x, y: PLANE_Y, z: mention.to.z }),
  }));
  return {
    version,
    tiles,
    ...picturePixels(frame),
    ratio,
    scale,
    frame: { width: box.width, height: box.height, chest: box.chest },
    robots,
    rooms,
    notes,
    mentions,
  };
}
