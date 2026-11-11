import { VIEW_TURN, type Bounds, type Point } from "../layout.js";

/** How far above the horizon the camera stands, in radians. */
export const CAMERA_TILT = (40 * Math.PI) / 180;
/** From the camera to the point it looks at. The view is orthographic, so this sets no scale. */
const CAMERA_REACH = 34;
export const CAMERA_HEIGHT = CAMERA_REACH * Math.sin(CAMERA_TILT);
/** Level distance from the camera to the point it looks at. */
export const CAMERA_BACK = CAMERA_REACH * Math.cos(CAMERA_TILT);
/** World units shown from top to bottom at zoom 1. */
export const VIEW_HEIGHT = 30;
export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 3;
export const FOCUS_ZOOM = 1.6;
export const CAMERA_EASE_MS = 450;
/** A pointer that moved less than this between down and up is a tap. */
export const TAP_SLOP_PX = 8;
/** Ground distance towards the camera per unit of screen height (1 / sin of the tilt). */
export const GROUND_SCALE = CAMERA_REACH / CAMERA_HEIGHT;
/** World height per unit of screen height (1 / cos of the tilt). */
export const RISE_SCALE = CAMERA_REACH / CAMERA_BACK;
/**
 * The first view, in CSS pixels per world unit; a robot is about a unit and a half tall on
 * screen. An office that fits at `legible` or more is shown whole, and no larger than `most`. A
 * deeper one fills the width, but no larger than `partial`, and shows its far end first.
 */
export const FIRST_VIEW = { legible: 20, partial: 28, most: 44 };

const TURN_SIN = Math.sin(VIEW_TURN);
const TURN_COS = Math.cos(VIEW_TURN);

export interface CameraView {
  /** The ground point the camera looks at. */
  x: number;
  z: number;
  zoom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Frustum {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * A stretch of ground as the turned camera sees it, in world units from the world's origin:
 * `left` to `right` across the screen, `far` to `near` down it. Not a box in x and z.
 */
export interface GroundSpan {
  left: number;
  right: number;
  far: number;
  near: number;
}

/** What the first view keeps clear around the office. */
export interface FrameMargins {
  /** World height of the tallest thing on the far edge: it is drawn above the ground there. */
  rise: number;
  /** CSS pixels at the top, at each side and at the bottom. */
  top: number;
  side: number;
  bottom: number;
}

const NO_SPAN: GroundSpan = { left: 0, right: 0, far: 0, near: 0 };

/** How far a ground offset reaches across the screen and towards the camera. */
function seen(x: number, z: number): { across: number; toward: number } {
  return { across: x * TURN_COS - z * TURN_SIN, toward: x * TURN_SIN + z * TURN_COS };
}

/** The ground offset that reaches `across` the screen and `toward` the camera. */
function unseen(across: number, toward: number): Point {
  return { x: across * TURN_COS + toward * TURN_SIN, z: toward * TURN_COS - across * TURN_SIN };
}

/** Inverted or non-finite bounds (an office with no rooms) are no box. */
function isBox(bounds: Bounds): boolean {
  const { minX, maxX, minZ, maxZ } = bounds;
  return [minX, maxX, minZ, maxZ].every(Number.isFinite) && minX <= maxX && minZ <= maxZ;
}

/** A zero-size side counts as 1 px, so a hidden tab gives a finite, non-degenerate aspect. */
function aspectOf(viewport: Viewport): number {
  return Math.max(1, viewport.width) / Math.max(1, viewport.height);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Spec: at most 1.5 on a touch device, 2 elsewhere. */
export function pixelRatioFor(devicePixelRatio: number, coarsePointer: boolean): number {
  return Math.min(devicePixelRatio, coarsePointer ? 1.5 : 2);
}

export function frustumFor(viewport: Viewport): Frustum {
  const aspect = aspectOf(viewport);
  const halfHeight = VIEW_HEIGHT / 2;
  return {
    left: -halfHeight * aspect,
    right: halfHeight * aspect,
    top: halfHeight,
    bottom: -halfHeight,
  };
}

/** Above the point it looks at, back from it, and round to the right by the view's turn. */
export function cameraPosition(view: CameraView): { x: number; y: number; z: number } {
  return {
    x: view.x + CAMERA_BACK * TURN_SIN,
    y: CAMERA_HEIGHT,
    z: view.z + CAMERA_BACK * TURN_COS,
  };
}

/**
 * What the camera sees of the ground under `boxes`: the reach of their corners across the screen
 * and down it. Boxes that are no boxes are left out; with none left it is a point at the origin.
 */
export function groundSpan(boxes: readonly Bounds[]): GroundSpan {
  const corners = boxes
    .filter(isBox)
    .flatMap((box) => [
      seen(box.minX, box.minZ),
      seen(box.maxX, box.minZ),
      seen(box.minX, box.maxZ),
      seen(box.maxX, box.maxZ),
    ]);
  if (corners.length === 0) return NO_SPAN;
  const across = corners.map((corner) => corner.across);
  const toward = corners.map((corner) => corner.toward);
  return {
    left: Math.min(...across),
    right: Math.max(...across),
    far: Math.min(...toward),
    near: Math.max(...toward),
  };
}

/** The view that shows all of `bounds`, centred. */
export function frameBounds(bounds: Bounds, viewport: Viewport): CameraView {
  const span = groundSpan([bounds]);
  const width = Math.max(1, span.right - span.left);
  const depth = Math.max(1, span.near - span.far);
  const zoom = Math.min(
    (VIEW_HEIGHT * aspectOf(viewport)) / width,
    (VIEW_HEIGHT * GROUND_SCALE) / depth,
  );
  return {
    ...unseen((span.left + span.right) / 2, (span.far + span.near) / 2),
    zoom: clamp(zoom, ZOOM_MIN, ZOOM_MAX),
  };
}

/** CSS pixels per world unit of the first view: see `FIRST_VIEW`. */
function firstScale(byWidth: number, whole: number): number {
  if (whole >= FIRST_VIEW.legible) return Math.min(whole, FIRST_VIEW.most);
  return Math.min(byWidth, FIRST_VIEW.partial);
}

/**
 * The first view of an office that covers `span`. One that fits with legible robots is shown
 * whole, in the middle. A deeper one fills the width and starts at its far end, the top of the
 * screen, and the user pans down it: shrunk to fit, its robots would be dots.
 */
export function firstView(span: GroundSpan, viewport: Viewport, margins: FrameMargins): CameraView {
  const height = Math.max(1, viewport.height);
  const roomAcross = Math.max(1, viewport.width - 2 * margins.side);
  const roomDown = Math.max(1, height - margins.top - margins.bottom);
  // What the office covers on screen, in world units: its ground, and what stands at the back.
  const rise = margins.rise / RISE_SCALE;
  const across = span.right - span.left;
  const down = (span.near - span.far) / GROUND_SCALE + rise;
  const byWidth = roomAcross / Math.max(1, across);
  const wanted = firstScale(byWidth, Math.min(byWidth, roomDown / Math.max(1, down)));
  const zoom = clamp((wanted * VIEW_HEIGHT) / height, ZOOM_MIN, ZOOM_MAX);
  const perUnit = (zoom * height) / VIEW_HEIGHT;
  const spare = Math.max(0, roomDown - down * perUnit);
  // The far edge's ground line is drawn below the margin, the spare room and the rise.
  const farLine = margins.top + spare / 2 + rise * perUnit;
  const toward = span.far + ((height / 2 - farLine) / perUnit) * GROUND_SCALE;
  return { ...unseen((span.left + span.right) / 2, toward), zoom };
}

/** `point` kept over `span`, as the camera sees it; a point already over it is returned as is. */
function heldOver(point: Point, span: GroundSpan): Point {
  const at = seen(point.x, point.z);
  const across = clamp(at.across, span.left, span.right);
  const toward = clamp(at.toward, span.far, span.near);
  return across === at.across && toward === at.toward ? point : unseen(across, toward);
}

/**
 * `dx`/`dy` are the pointer's movement in CSS pixels since the last call. The ground follows
 * the finger, and the point the camera looks at stays over `span`.
 */
export function panBy(
  view: CameraView,
  dx: number,
  dy: number,
  viewport: Viewport,
  span: GroundSpan,
): CameraView {
  const perPixel = VIEW_HEIGHT / view.zoom / Math.max(1, viewport.height);
  const shift = unseen(dx * perPixel, dy * perPixel * GROUND_SCALE);
  return { ...heldOver({ x: view.x - shift.x, z: view.z - shift.z }, span), zoom: view.zoom };
}

export function zoomBy(view: CameraView, factor: number): CameraView {
  return { x: view.x, z: view.z, zoom: clamp(view.zoom * factor, ZOOM_MIN, ZOOM_MAX) };
}

/** A wheel step down (positive deltaY) zooms out. */
export function wheelFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.0015);
}

export function focusOn(view: CameraView, point: Point): CameraView {
  return { x: point.x, z: point.z, zoom: Math.max(view.zoom, FOCUS_ZOOM) };
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** CSS pixels that one world unit covers across the screen. */
export function pixelsPerUnit(view: CameraView, viewport: Viewport): number {
  return (Math.max(1, viewport.height) * view.zoom) / VIEW_HEIGHT;
}

/** Where a world point is drawn, in CSS pixels from the viewport's top left corner. */
export function screenPoint(
  view: CameraView,
  viewport: Viewport,
  point: { x: number; y: number; z: number },
): ScreenPoint {
  const perUnit = pixelsPerUnit(view, viewport);
  const ground = seen(point.x - view.x, point.z - view.z);
  // The camera's up axis: height lifts a point on screen, coming towards the camera lowers it.
  const up = (point.y * CAMERA_BACK - ground.toward * CAMERA_HEIGHT) / CAMERA_REACH;
  return {
    x: viewport.width / 2 + ground.across * perUnit,
    y: viewport.height / 2 - up * perUnit,
  };
}

/**
 * `point` moved so that it is drawn `dx`, `dy` CSS pixels away: sideways along the screen, and
 * up or down by its height, so it stays as far from the camera as it was.
 */
export function shiftOnScreen(
  view: CameraView,
  viewport: Viewport,
  point: { x: number; y: number; z: number },
  dx: number,
  dy: number,
): { x: number; y: number; z: number } {
  const perUnit = pixelsPerUnit(view, viewport);
  const sideways = unseen(dx / perUnit, 0);
  return {
    x: point.x + sideways.x,
    y: point.y - (dy / perUnit) * RISE_SCALE,
    z: point.z + sideways.z,
  };
}

export function easeView(from: CameraView, to: CameraView, progress: number): CameraView {
  const t = clamp(progress, 0, 1);
  const eased = t * t * (3 - 2 * t);
  return {
    x: from.x * (1 - eased) + to.x * eased,
    z: from.z * (1 - eased) + to.z * eased,
    zoom: from.zoom * (1 - eased) + to.zoom * eased,
  };
}
