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

export type PickTarget = { roomId: string } | { agentId: string };

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

/** The robot whose chest is nearest `at`, within a touch target's reach. */
export function robotNear(
  screen: Screen,
  robots: readonly RobotSpot[],
  at: ScreenPoint,
): string | null {
  let nearest: string | null = null;
  let best = TAP_RADIUS_PX;
  for (const robot of robots) {
    const gap = distance(at, screenPoint(screen.view, screen.viewport, robot.chest));
    if (gap <= best) {
      best = gap;
      nearest = robot.agentId;
    }
  }
  return nearest;
}

/**
 * What a tap or a click at `at` means. Zoomed out, a robot is a few pixels wide, so a tap takes
 * the nearest robot within a touch target's reach. A plate under the finger wins, since it is
 * drawn over everything; a plate merely nearby loses to a robot.
 */
export function targetAt(
  screen: Screen,
  plates: ReadonlyMap<string, Plate>,
  robots: readonly RobotSpot[],
  at: ScreenPoint,
): PickTarget | null {
  const plate = labelUnder(screen, plates, at, 0);
  if (plate !== null) return { roomId: plate };
  const robot = robotNear(screen, robots, at);
  if (robot !== null) return { agentId: robot };
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
  const zoomed = zoomBy(from, factor);
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
