import type { Bounds, Point } from "../layout.js";

export const CAMERA_HEIGHT = 26;
export const CAMERA_BACK = 22;
/** World units shown from top to bottom at zoom 1. */
export const VIEW_HEIGHT = 30;
export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 3;
export const FOCUS_ZOOM = 1.6;
export const CAMERA_EASE_MS = 450;
/** A pointer that moved less than this between down and up is a tap. */
export const TAP_SLOP_PX = 8;
/** Ground distance along z per unit of screen height (1 / sin of the camera's elevation). */
export const GROUND_SCALE = Math.hypot(CAMERA_HEIGHT, CAMERA_BACK) / CAMERA_HEIGHT;

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

const ORIGIN_BOUNDS: Bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };

/** Inverted or non-finite bounds (an office with no rooms) count as zero-size bounds at the origin. */
function usableBounds(bounds: Bounds): Bounds {
  const { minX, maxX, minZ, maxZ } = bounds;
  const finite = [minX, maxX, minZ, maxZ].every(Number.isFinite);
  return finite && minX <= maxX && minZ <= maxZ ? bounds : ORIGIN_BOUNDS;
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

export function cameraPosition(view: CameraView): { x: number; y: number; z: number } {
  return { x: view.x, y: CAMERA_HEIGHT, z: view.z + CAMERA_BACK };
}

export function frameBounds(rawBounds: Bounds, viewport: Viewport): CameraView {
  const bounds = usableBounds(rawBounds);
  const aspect = aspectOf(viewport);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const depth = Math.max(1, bounds.maxZ - bounds.minZ);
  const zoom = Math.min((VIEW_HEIGHT * aspect) / width, (VIEW_HEIGHT * GROUND_SCALE) / depth);
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
    zoom: clamp(zoom, ZOOM_MIN, ZOOM_MAX),
  };
}

/** `dx`/`dy` are the pointer's movement in CSS pixels since the last call. */
export function panBy(
  view: CameraView,
  dx: number,
  dy: number,
  viewport: Viewport,
  rawBounds: Bounds,
): CameraView {
  const bounds = usableBounds(rawBounds);
  const perPixel = VIEW_HEIGHT / view.zoom / Math.max(1, viewport.height);
  return {
    x: clamp(view.x - dx * perPixel, bounds.minX, bounds.maxX),
    z: clamp(view.z - dy * perPixel * GROUND_SCALE, bounds.minZ, bounds.maxZ),
    zoom: view.zoom,
  };
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
  // The camera's up axis: height lifts a point on screen, distance from the camera lowers it.
  const reach = Math.hypot(CAMERA_HEIGHT, CAMERA_BACK);
  const up = (point.y * CAMERA_BACK - (point.z - view.z) * CAMERA_HEIGHT) / reach;
  return {
    x: viewport.width / 2 + (point.x - view.x) * perUnit,
    y: viewport.height / 2 - up * perUnit,
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
