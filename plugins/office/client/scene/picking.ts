// Screen-space picking and zoom maths for the office scene: pure functions of the camera view,
// the viewport and what is drawn where. No DOM and no three.js, so they are unit tested.
import {
  panBy,
  screenPoint,
  zoomBy,
  type CameraView,
  type GroundSpan,
  type ScreenPoint,
  type Viewport,
} from "./camera.js";

/** Half of the app's 44 px touch target (packages/app/src/components/ui/control-geometry.ts). */
export const TAP_RADIUS_PX = 22;
/** A room's name plate is this tall on screen, in CSS pixels, at every zoom. */
export const PLATE_HEIGHT_PX = 20;

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

/** What the camera shows: the view and the size it is drawn at, in CSS pixels. */
export interface Screen {
  view: CameraView;
  viewport: Viewport;
}

/** A name plate as drawn: its size on screen and the world point its left edge hangs from. */
export interface Plate {
  anchor: WorldPoint;
  width: number;
  height: number;
}

/** A robot's chest, where a tap is measured from, at its current position. */
export interface RobotSpot {
  agentId: string;
  chest: WorldPoint;
}

/** A whiteboard's face: upright and turned to +z, `width` by `height` about `center`. */
export interface BoardFace {
  roomId: string;
  center: WorldPoint;
  width: number;
  height: number;
}

/** The middle of a note on a desk. It is small, so a tap takes the nearest in reach, as a robot. */
export interface NoteSpot {
  roomId: string;
  at: WorldPoint;
}

/** What opens a room's board: its whiteboard, and its notes on desks. */
export interface Boards {
  faces: readonly BoardFace[];
  notes: readonly NoteSpot[];
}

const NO_BOARDS: Boards = { faces: [], notes: [] };

/** A room to look at, an agent's card to open, or a room's board to open. */
export type PickTarget = { roomId: string } | { agentId: string } | { boardId: string };

/** Two fingers on the screen: how far apart they are and the point between them. */
export interface PinchState {
  spread: number;
  middle: ScreenPoint;
}

/** The pointer's position relative to the page, and the canvas's box on the page. */
export interface ClientPoint {
  clientX: number;
  clientY: number;
}

export interface ClientRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function distance(left: ScreenPoint, right: ScreenPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

/** The room whose plate is under `at`, or within `reach` CSS pixels of it. */
export function labelUnder(
  screen: Screen,
  plates: ReadonlyMap<string, Plate>,
  at: ScreenPoint,
  reach: number,
): string | null {
  for (const [roomId, plate] of plates) {
    const left = screenPoint(screen.view, screen.viewport, plate.anchor);
    const inX = at.x >= left.x - reach && at.x <= left.x + plate.width + reach;
    const inY = Math.abs(at.y - left.y) <= plate.height / 2 + reach;
    if (inX && inY) return roomId;
  }
  return null;
}

/** The item drawn nearest `at`, within a touch target's reach, and how far from it. */
function nearestInReach<Item>(
  screen: Screen,
  items: readonly Item[],
  point: (item: Item) => WorldPoint,
  at: ScreenPoint,
): { item: Item; gap: number } | null {
  let nearest: { item: Item; gap: number } | null = null;
  for (const item of items) {
    const gap = distance(at, screenPoint(screen.view, screen.viewport, point(item)));
    if (gap <= (nearest?.gap ?? TAP_RADIUS_PX)) nearest = { item, gap };
  }
  return nearest;
}

/** The robot whose chest is nearest `at`, within a touch target's reach. */
export function robotNear(
  screen: Screen,
  robots: readonly RobotSpot[],
  at: ScreenPoint,
): string | null {
  return nearestInReach(screen, robots, (robot) => robot.chest, at)?.item.agentId ?? null;
}

/**
 * The room whose whiteboard is drawn under `at`. The view is turned, so a face is a
 * parallelogram on screen: the tap is measured along its lower edge and up its left one.
 */
export function boardUnder(
  screen: Screen,
  faces: readonly BoardFace[],
  at: ScreenPoint,
): string | null {
  for (const face of faces) {
    const { x, y, z } = face.center;
    const drawn = (dx: number, dy: number) =>
      screenPoint(screen.view, screen.viewport, { x: x + dx, y: y + dy, z });
    const corner = drawn(-face.width / 2, -face.height / 2);
    const right = drawn(face.width / 2, -face.height / 2);
    const up = drawn(-face.width / 2, face.height / 2);
    const along = { x: right.x - corner.x, y: right.y - corner.y };
    const rise = { x: up.x - corner.x, y: up.y - corner.y };
    const tap = { x: at.x - corner.x, y: at.y - corner.y };
    const area = along.x * rise.y - along.y * rise.x;
    if (area === 0) continue;
    const across = (tap.x * rise.y - tap.y * rise.x) / area;
    const height = (along.x * tap.y - along.y * tap.x) / area;
    if (across >= 0 && across <= 1 && height >= 0 && height <= 1) return face.roomId;
  }
  return null;
}

/** The robot or the note on a desk nearest `at`, within reach; equally near, the robot. */
function nearestSmall(
  screen: Screen,
  robots: readonly RobotSpot[],
  notes: readonly NoteSpot[],
  at: ScreenPoint,
): PickTarget | null {
  const robot = nearestInReach(screen, robots, (item) => item.chest, at);
  const note = nearestInReach(screen, notes, (item) => item.at, at);
  if (note !== null && (robot === null || note.gap < robot.gap)) {
    return { boardId: note.item.roomId };
  }
  return robot === null ? null : { agentId: robot.item.agentId };
}

/**
 * What a tap or a click at `at` means. Zoomed out, a robot is a few pixels wide, so a tap takes
 * the nearest robot within a touch target's reach, or the nearest note on a desk if that is
 * nearer. A plate under the finger wins, since it is drawn over everything. A whiteboard is
 * large and stands behind its room, so it loses to a robot in reach; a plate merely nearby loses
 * to all of them.
 */
export function targetAt(
  screen: Screen,
  plates: ReadonlyMap<string, Plate>,
  robots: readonly RobotSpot[],
  at: ScreenPoint,
  boards: Boards = NO_BOARDS,
): PickTarget | null {
  const plate = labelUnder(screen, plates, at, 0);
  if (plate !== null) return { roomId: plate };
  const small = nearestSmall(screen, robots, boards.notes, at);
  if (small !== null) return small;
  const board = boardUnder(screen, boards.faces, at);
  if (board !== null) return { boardId: board };
  const nearby = labelUnder(screen, plates, at, TAP_RADIUS_PX - PLATE_HEIGHT_PX / 2);
  return nearby === null ? null : { roomId: nearby };
}

/** Canvas pixels per page pixel along one side; 1 while either size is unknown. */
function scaleOf(canvasSize: number, pageSize: number): number {
  if (canvasSize <= 0 || pageSize <= 0) return 1;
  return canvasSize / pageSize;
}

/**
 * A pointer event's position in the canvas's CSS pixels. A CSS transform on an ancestor (a sheet
 * sliding in at `scale()`) draws the canvas at another size than its own, so the offset from its
 * box is scaled back.
 */
export function canvasPoint(
  client: ClientPoint,
  rect: ClientRect,
  viewport: Viewport,
): ScreenPoint {
  return {
    x: (client.clientX - rect.left) * scaleOf(viewport.width, rect.width),
    y: (client.clientY - rect.top) * scaleOf(viewport.height, rect.height),
  };
}

/** Zooms by `factor` and keeps the ground under `at` where it is on screen. */
export function zoomAbout(
  from: CameraView,
  factor: number,
  at: ScreenPoint,
  viewport: Viewport,
  span: GroundSpan,
): CameraView {
  const zoomed = zoomBy(from, factor, viewport);
  const applied = zoomed.zoom / from.zoom - 1;
  const dx = (at.x - viewport.width / 2) * applied;
  const dy = (at.y - viewport.height / 2) * applied;
  return panBy(zoomed, -dx, -dy, viewport, span);
}

/**
 * One move of a two-finger pinch: the ground under the old midpoint follows the fingers to the
 * new one, then the zoom keeps it there. Zooming first would leave it off by the midpoint's move
 * times the zoom change.
 */
export function pinchView(
  view: CameraView,
  before: PinchState,
  after: PinchState,
  viewport: Viewport,
  span: GroundSpan,
): CameraView {
  const dx = after.middle.x - before.middle.x;
  const dy = after.middle.y - before.middle.y;
  const panned = panBy(view, dx, dy, viewport, span);
  return zoomAbout(panned, after.spread / before.spread, after.middle, viewport, span);
}
