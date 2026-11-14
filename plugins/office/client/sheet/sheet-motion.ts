// The sheet view's geometry and animation maths, with no React. Sheet coordinates are picture
// pixels from the backdrop's top left; a `Transform` and every point passed in are screen points.
import { TAP_SLOP_PX } from "../../shared/render.js";
import type {
  Sheet,
  SheetPoint,
  SheetRect,
  SheetRobot,
  SpritePicture,
} from "../../shared/sheet.js";
import { TAP_RADIUS_PX } from "../scene/picking.js";

export { TAP_SLOP_PX };

/** Zoom 1 is the size the host drew the picture for. */
const MAX_ZOOM = 2;
/** A robot is brought to at least this zoom when it is focused. */
const FOCUS_ZOOM = 1.5;
/** Frames switch within this much of a frame's end, so the value steps and never slides. */
const STEP_GAP = 0.001;
/** The plane's arc: a third of its distance, but no more than this many world units. */
const PLANE_ARC_UNITS = 2;

export interface Viewer {
  width: number;
  height: number;
}

/** The picture's top left is drawn at (x, y); one picture point is `zoom` screen points. */
export interface Transform {
  x: number;
  y: number;
  zoom: number;
}

export interface Fingers {
  /** The distance between the two fingers. */
  spread: number;
  middle: SheetPoint;
}

export type Target = { roomId: string } | { agentId: string } | { boardId: string };

/** The picture's size in screen points at zoom 1. */
function pictureSize(sheet: Sheet): Viewer {
  return { width: sheet.width / sheet.ratio, height: sheet.height / sheet.ratio };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Along one side: the picture's edges stop at the viewer's, or it is centred if it is smaller. */
function placed(offset: number, size: number, room: number): number {
  return size <= room ? (room - size) / 2 : clamp(offset, room - size, 0);
}

export function fitted(transform: Transform, sheet: Sheet, viewer: Viewer): Transform {
  const picture = pictureSize(sheet);
  const wholePicture = Math.min(1, viewer.width / picture.width, viewer.height / picture.height);
  const zoom = clamp(transform.zoom, wholePicture, MAX_ZOOM);
  return {
    zoom,
    x: placed(transform.x, picture.width * zoom, viewer.width),
    y: placed(transform.y, picture.height * zoom, viewer.height),
  };
}

export function panned(transform: Transform, dx: number, dy: number): Transform {
  return { ...transform, x: transform.x + dx, y: transform.y + dy };
}

/** Zoom about the fingers' middle; the picture point under the old middle follows the new one. */
export function pinched(transform: Transform, before: Fingers, after: Fingers): Transform {
  const factor = before.spread > 0 && after.spread > 0 ? after.spread / before.spread : 1;
  const zoom = transform.zoom * factor;
  const under = {
    x: (before.middle.x - transform.x) / transform.zoom,
    y: (before.middle.y - transform.y) / transform.zoom,
  };
  return { zoom, x: after.middle.x - under.x * zoom, y: after.middle.y - under.y * zoom };
}

/** Where a picture-pixel point is on screen. */
function onScreen(sheet: Sheet, transform: Transform, point: SheetPoint): SheetPoint {
  const scale = transform.zoom / sheet.ratio;
  return { x: transform.x + point.x * scale, y: transform.y + point.y * scale };
}

function inside(rect: SheetRect, point: SheetPoint): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * What a tap at `point` means, in the web's order: a name plate under it; else the nearest robot
 * chest or desk note within `reach`; else a board under it.
 */
export function targetAt(
  sheet: Sheet,
  transform: Transform,
  point: SheetPoint,
  reach = TAP_RADIUS_PX,
): Target | null {
  const scale = transform.zoom / sheet.ratio;
  const picture = { x: (point.x - transform.x) / scale, y: (point.y - transform.y) / scale };
  const plate = sheet.rooms.find((room) => inside(room.plate, picture));
  if (plate !== undefined) return { roomId: plate.roomId };

  const spots: Array<{ at: SheetPoint; target: Target }> = [
    ...sheet.robots.map((robot) => ({
      at: { x: robot.x + sheet.frame.chest.x, y: robot.y + sheet.frame.chest.y },
      target: { agentId: robot.agentId },
    })),
    ...sheet.notes.map(({ roomId, rect }) => ({
      at: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      target: { boardId: roomId },
    })),
  ];
  let nearest: Target | null = null;
  let nearestDistance = reach;
  for (const spot of spots) {
    const shown = onScreen(sheet, transform, spot.at);
    const distance = Math.hypot(shown.x - point.x, shown.y - point.y);
    if (distance <= nearestDistance && (nearest === null || distance < nearestDistance)) {
      nearest = spot.target;
      nearestDistance = distance;
    }
  }
  if (nearest !== null) return nearest;

  const board = sheet.rooms.find((room) => inside(room.board, picture));
  return board === undefined ? null : { boardId: board.roomId };
}

/** The transform that centres a robot's chest, or fits a room; null when it is not in the sheet. */
export function focusOn(
  sheet: Sheet,
  target: { agentId: string } | { roomId: string },
  viewer: Viewer,
  current: Transform,
): Transform | null {
  const ratio = sheet.ratio;
  if ("agentId" in target) {
    const robot = sheet.robots.find((candidate) => candidate.agentId === target.agentId);
    if (robot === undefined) return null;
    const zoom = Math.max(current.zoom, FOCUS_ZOOM);
    const scale = zoom / ratio;
    const chest = { x: robot.x + sheet.frame.chest.x, y: robot.y + sheet.frame.chest.y };
    return fitted(
      { zoom, x: viewer.width / 2 - chest.x * scale, y: viewer.height / 2 - chest.y * scale },
      sheet,
      viewer,
    );
  }
  const room = sheet.rooms.find((candidate) => candidate.roomId === target.roomId);
  if (room === undefined) return null;
  const { area } = room;
  const zoom = Math.min(
    MAX_ZOOM,
    viewer.width / (area.width / ratio),
    viewer.height / (area.height / ratio),
  );
  const scale = zoom / ratio;
  return fitted(
    {
      zoom,
      x: viewer.width / 2 - (area.x + area.width / 2) * scale,
      y: viewer.height / 2 - (area.y + area.height / 2) * scale,
    },
    sheet,
    viewer,
  );
}

/** The view's first transform: the picture's top at the top, or the focused room in view. */
export function firstTransform(
  sheet: Sheet,
  viewer: Viewer,
  focusRoomId?: string | null,
): Transform {
  const top = fitted({ x: 0, y: 0, zoom: 1 }, sheet, viewer);
  if (focusRoomId === undefined || focusRoomId === null) return top;
  return focusOn(sheet, { roomId: focusRoomId }, viewer, top) ?? top;
}

/** The three values that place the content layer, which React Native scales about its centre. */
export function layerStyleValues(transform: Transform, sheet: Sheet) {
  const scale = transform.zoom / sheet.ratio;
  return {
    scale,
    translateX: transform.x + (sheet.width * (scale - 1)) / 2,
    translateY: transform.y + (sheet.height * (scale - 1)) / 2,
  };
}

/**
 * What `Animated.interpolate` needs to step a grid of frames: frame n for every value from n to
 * just under n + 1, then a short slide to the next, so the value steps and never glides.
 */
export function stepRanges(picture: SpritePicture): { input: number[]; x: number[]; y: number[] } {
  const input: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  for (let frame = 0; frame < picture.frames; frame += 1) {
    const offsetX = -(frame % picture.columns) * picture.frameWidth;
    const offsetY = -Math.floor(frame / picture.columns) * picture.frameHeight;
    input.push(frame, frame + 1 - STEP_GAP);
    x.push(offsetX, offsetX);
    y.push(offsetY, offsetY);
  }
  return { input, x, y };
}

/** A once-only sprite plays when the robot's key changed to it, or a fresh robot arrived. */
export function playsOnce(
  previous: SheetRobot | undefined,
  next: SheetRobot,
  loop: boolean,
): boolean {
  if (loop) return false;
  return previous === undefined ? next.fresh : previous.key !== next.key;
}

/** A plane's flight: its length, its heading for a sprite that points right, and its arc. */
export function planePath(from: SheetPoint, to: SheetPoint, scale: number) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return {
    distance,
    angle: (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI,
    arc: Math.min(distance / 3, PLANE_ARC_UNITS * scale),
  };
}
