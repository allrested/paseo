import { expect, test } from "vitest";
import {
  CAMERA_BACK,
  CAMERA_HEIGHT,
  FOCUS_ZOOM,
  GROUND_SCALE,
  VIEW_HEIGHT,
  ZOOM_MAX,
  ZOOM_MIN,
  cameraPosition,
  easeView,
  focusOn,
  frameBounds,
  frustumFor,
  panBy,
  pixelRatioFor,
  wheelFactor,
  zoomBy,
} from "./camera.js";

const BOUNDS = { minX: -8, maxX: 8, minZ: -7.5, maxZ: 7.5 };
const PHONE = { width: 390, height: 844 };

test("pixel ratio is capped at 1.5 on touch and 2 elsewhere", () => {
  expect(pixelRatioFor(3, true)).toBe(1.5);
  expect(pixelRatioFor(3, false)).toBe(2);
  expect(pixelRatioFor(1, true)).toBe(1);
});

test("the frustum keeps the viewport's aspect", () => {
  expect(frustumFor({ width: 800, height: 400 })).toEqual({
    left: -VIEW_HEIGHT,
    right: VIEW_HEIGHT,
    top: VIEW_HEIGHT / 2,
    bottom: -VIEW_HEIGHT / 2,
  });
});

test("the camera sits above and behind the point it looks at", () => {
  expect(cameraPosition({ x: 3, z: 4, zoom: 1 })).toEqual({
    x: 3,
    y: CAMERA_HEIGHT,
    z: 4 + CAMERA_BACK,
  });
});

test("framing fits the office into a phone screen, centred", () => {
  const view = frameBounds(BOUNDS, PHONE);
  expect([view.x, view.z]).toEqual([0, 0]);
  expect(view.zoom).toBeCloseTo((VIEW_HEIGHT * (390 / 844)) / 16, 6);
  expect(frameBounds({ minX: -500, maxX: 500, minZ: -500, maxZ: 500 }, PHONE).zoom).toBe(ZOOM_MIN);
});

test("dragging moves the office with the finger and stays over the office", () => {
  const start = { x: 0, z: 0, zoom: 1 };
  const viewport = { width: 600, height: 600 };
  const perPixel = VIEW_HEIGHT / 600;
  expect(panBy(start, 100, 0, viewport, BOUNDS)).toEqual({ x: -100 * perPixel, z: 0, zoom: 1 });
  const down = panBy(start, 0, 40, viewport, BOUNDS);
  expect(down.z).toBeCloseTo(-40 * perPixel * GROUND_SCALE, 6);
  expect(panBy(start, -1000, 1000, viewport, BOUNDS)).toEqual({ x: 8, z: -7.5, zoom: 1 });
});

test("zoom stays within its limits; a wheel step up zooms out", () => {
  expect(zoomBy({ x: 0, z: 0, zoom: 2 }, 10).zoom).toBe(ZOOM_MAX);
  expect(zoomBy({ x: 0, z: 0, zoom: 1 }, 0.01).zoom).toBe(ZOOM_MIN);
  expect(wheelFactor(100)).toBeLessThan(1);
  expect(wheelFactor(-100)).toBeGreaterThan(1);
  expect(wheelFactor(0)).toBe(1);
});

test("focusing centres the point and zooms in, never out", () => {
  expect(focusOn({ x: 0, z: 0, zoom: 1 }, { x: 15, z: 14 })).toEqual({
    x: 15,
    z: 14,
    zoom: FOCUS_ZOOM,
  });
  expect(focusOn({ x: 0, z: 0, zoom: 2.5 }, { x: 15, z: 14 }).zoom).toBe(2.5);
});

test("easing starts at the old view, ends at the new one, and is half-way in the middle", () => {
  const from = { x: 0, z: 0, zoom: 1 };
  const to = { x: 10, z: -4, zoom: 2 };
  expect(easeView(from, to, 0)).toEqual(from);
  expect(easeView(from, to, 1)).toEqual(to);
  expect(easeView(from, to, 0.5)).toEqual({ x: 5, z: -2, zoom: 1.5 });
  expect(easeView(from, to, 3)).toEqual(to);
});
