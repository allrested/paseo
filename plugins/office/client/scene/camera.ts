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
/**
 * How far out and how close the camera goes, in CSS pixels per world unit: a robot is from 13 px
 * to 116 px tall. They are sizes on screen, not zooms, so a short screen (a phone on its side)
 * gets as close as a tall one.
 */
export const SCALE_LIMITS = { min: 10, max: 90 };
/** A focus on a robot comes at least this close, in CSS pixels per world unit. */
export const FOCUS_SCALE = 45;
export const CAMERA_EASE_MS = 450;
/** A pointer that moved less than this between down and up is a tap. */
export const TAP_SLOP_PX = 8;
/** Ground distance towards the camera per unit of screen height (1 / sin of the tilt). */
export const GROUND_SCALE = CAMERA_REACH / CAMERA_HEIGHT;
/** World height per unit of screen height (1 / cos of the tilt). */
export const RISE_SCALE = CAMERA_REACH / CAMERA_BACK;
/**
 * The first view, in CSS pixels per world unit. A robot's body is 1.29 units tall on screen, so
 * at `legible` it is 28 px, the least it reads at. An office that fits at `legible` or more is
 * shown whole, and no larger than `most`. A deeper one fills the width, but no larger than
 * `partial`, and shows its far end first. One room that the camera was asked for (`partView`)
 * comes closer, up to `room`: on a tablet it fills the width, and a robot is 82 px at most.
 */
export const FIRST_VIEW = { legible: 22, partial: 28, most: 44, room: 64 };

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

/**
 * What the first view keeps clear: the whiteboard stands at the back of the first rooms and the
 * name plates above their walls, and on a phone every pixel at the sides is scale.
 */
export const FIRST_MARGINS: FrameMargins = { rise: 2.2, top: 10, side: 8, bottom: 12 };

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

/** The zoom that draws a world unit `scale` CSS pixels long. */
function zoomFor(scale: number, viewport: Viewport): number {
  return (scale * VIEW_HEIGHT) / Math.max(1, viewport.height);
}

/** `SCALE_LIMITS` as zooms of this viewport. */
export function zoomLimits(viewport: Viewport): { min: number; max: number } {
  return { min: zoomFor(SCALE_LIMITS.min, viewport), max: zoomFor(SCALE_LIMITS.max, viewport) };
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

/** CSS pixels per world unit at which the width of `span` fills the view between its margins. */
function scaleByWidth(span: GroundSpan, viewport: Viewport, margins: FrameMargins): number {
  const roomAcross = Math.max(1, viewport.width - 2 * margins.side);
  return roomAcross / Math.max(1, span.right - span.left);
}

/** CSS pixels per world unit at which the whole of `span` shows in the view, inside its margins. */
export function wholeScale(span: GroundSpan, viewport: Viewport, margins: FrameMargins): number {
  const roomDown = Math.max(1, Math.max(1, viewport.height) - margins.top - margins.bottom);
  // What the office covers on screen, in world units: its ground, and what stands at the back.
  const down = (span.near - span.far) / GROUND_SCALE + margins.rise / RISE_SCALE;
  return Math.min(scaleByWidth(span, viewport, margins), roomDown / Math.max(1, down));
}

/** CSS pixels per world unit of the first view, whole no larger than `most`: see `FIRST_VIEW`. */
function firstScale(byWidth: number, whole: number, most: number): number {
  if (whole >= FIRST_VIEW.legible) return Math.min(whole, most);
  return Math.min(byWidth, FIRST_VIEW.partial);
}

/** `value` held in `min` to `max`, and half-way between them when they are the wrong way round. */
function heldBetween(value: number, min: number, max: number): number {
  return min <= max ? clamp(value, min, max) : (min + max) / 2;
}

/**
 * Where a camera at `zoom` that wants to look at `at` may look, so that it shows no ground past
 * `span` beyond the margins. Along a side where `span` is larger than the screen it stops at the
 * edge; along one where it is smaller, `span` is in the middle. What stands `margins.rise` high
 * on the far edge is drawn above the ground there and stays below the top margin.
 */
function insideOf(
  at: { across: number; toward: number },
  zoom: number,
  span: GroundSpan,
  viewport: Viewport,
  margins: FrameMargins,
): { across: number; toward: number } {
  const perUnit = pixelsPerUnit({ x: 0, z: 0, zoom }, viewport);
  const side = (viewport.width / 2 - margins.side) / perUnit;
  const up = (viewport.height / 2 - margins.top) / perUnit - margins.rise / RISE_SCALE;
  const down = (viewport.height / 2 - margins.bottom) / perUnit;
  return {
    across: heldBetween(at.across, span.left + side, span.right - side),
    toward: heldBetween(at.toward, span.far + up * GROUND_SCALE, span.near - down * GROUND_SCALE),
  };
}

/** The view that shows `span` as `firstScale` says, from its far end when it does not fit. */
function framed(
  span: GroundSpan,
  viewport: Viewport,
  margins: FrameMargins,
  most: number,
): CameraView {
  const byWidth = scaleByWidth(span, viewport, margins);
  const wanted = firstScale(byWidth, wholeScale(span, viewport, margins), most);
  const limits = zoomLimits(viewport);
  const zoom = clamp(zoomFor(wanted, viewport), limits.min, limits.max);
  const start = { across: (span.left + span.right) / 2, toward: -Infinity };
  const at = insideOf(start, zoom, span, viewport, margins);
  return { ...unseen(at.across, at.toward), zoom };
}

/**
 * The first view of an office that covers `span`. One that fits with legible robots is shown
 * whole, in the middle. A deeper one fills the width and starts at its far end, the top of the
 * screen, and the user pans down it: shrunk to fit, its robots would be dots.
 */
export function firstView(span: GroundSpan, viewport: Viewport, margins: FrameMargins): CameraView {
  return framed(span, viewport, margins, FIRST_VIEW.most);
}

/**
 * `view` moved so that it shows no more empty ground past the office than its first view does:
 * an office larger than the screen fills it, a smaller one stays in the middle. A view that
 * already does is returned as it is. The user's own pan is not held to this (`panBy`).
 */
export function keptInside(
  view: CameraView,
  span: GroundSpan,
  viewport: Viewport,
  margins: FrameMargins,
): CameraView {
  const at = seen(view.x, view.z);
  const held = insideOf(at, view.zoom, span, viewport, margins);
  if (held.across === at.across && held.toward === at.toward) return view;
  return { ...unseen(held.across, held.toward), zoom: view.zoom };
}

/**
 * The view on one part of an office, a room: framed as an office of that part alone is at first
 * but closer (`FIRST_VIEW.room`), so it fills the width it can, then kept inside the office, so
 * a room at either end is not shown under empty ground.
 */
export function partView(
  part: GroundSpan,
  office: GroundSpan,
  viewport: Viewport,
  margins: FrameMargins,
): CameraView {
  return keptInside(framed(part, viewport, margins, FIRST_VIEW.room), office, viewport, margins);
}

/** `point` kept over `span`, as the camera sees it; a point already over it is returned as is. */
function heldOver<T extends Point>(point: T, span: GroundSpan): T | Point {
  const at = seen(point.x, point.z);
  const across = clamp(at.across, span.left, span.right);
  const toward = clamp(at.toward, span.far, span.near);
  return across === at.across && toward === at.toward ? point : unseen(across, toward);
}

/**
 * `view` with the point it looks at brought back over `span`: an office that lost a room is
 * smaller than the one the camera was left over. A view over it is returned as it is.
 */
export function keptOver(view: CameraView, span: GroundSpan): CameraView {
  const held = heldOver(view, span);
  return held === view ? view : { x: held.x, z: held.z, zoom: view.zoom };
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

export function zoomBy(view: CameraView, factor: number, viewport: Viewport): CameraView {
  const limits = zoomLimits(viewport);
  return { x: view.x, z: view.z, zoom: clamp(view.zoom * factor, limits.min, limits.max) };
}

/** A wheel step down (positive deltaY) zooms out. */
export function wheelFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.0015);
}

export function focusOn(view: CameraView, point: Point, viewport: Viewport): CameraView {
  return { x: point.x, z: point.z, zoom: Math.max(view.zoom, zoomFor(FOCUS_SCALE, viewport)) };
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
