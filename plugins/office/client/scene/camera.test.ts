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
  pixelsPerUnit,
  screenPoint,
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
  expect(frameBounds(BOUNDS, { width: 1440, height: 900 })).toEqual({
    x: 0,
    z: 0,
    zoom: (VIEW_HEIGHT * GROUND_SCALE) / 15,
  });
  expect(frameBounds({ minX: -500, maxX: 500, minZ: -500, maxZ: 500 }, PHONE).zoom).toBe(ZOOM_MIN);
});

test("dragging moves the office with the finger and stays over the office", () => {
  const start = { x: 0, z: 0, zoom: 1 };
  const perPixel = VIEW_HEIGHT / 844;
  expect(panBy(start, 100, 0, PHONE, BOUNDS)).toEqual({ x: -100 * perPixel, z: 0, zoom: 1 });
  expect(panBy(start, 0, 40, PHONE, BOUNDS)).toEqual({
    x: 0,
    z: -40 * perPixel * GROUND_SCALE,
    zoom: 1,
  });
  expect(panBy(start, -1000, 1000, PHONE, BOUNDS)).toEqual({ x: 8, z: -7.5, zoom: 1 });
});

test("zoomed in, the same drag moves the office less", () => {
  const perPixel = VIEW_HEIGHT / 2 / 844;
  expect(panBy({ x: 0, z: 0, zoom: 2 }, 100, 40, PHONE, BOUNDS)).toEqual({
    x: -100 * perPixel,
    z: -40 * perPixel * GROUND_SCALE,
    zoom: 2,
  });
});

test("an office with no rooms frames and pans to finite numbers", () => {
  const empty = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  expect(frameBounds(empty, PHONE)).toEqual({ x: 0, z: 0, zoom: ZOOM_MAX });
  expect(panBy({ x: 3, z: 4, zoom: 1 }, 10, 10, PHONE, empty)).toEqual({ x: 0, z: 0, zoom: 1 });
  const notANumber = { minX: Number.NaN, maxX: 5, minZ: 0, maxZ: 5 };
  expect(frameBounds(notANumber, PHONE)).toEqual({ x: 0, z: 0, zoom: ZOOM_MAX });
});

test("a zero-size viewport gives a finite view with no negative zero", () => {
  const none = { width: 0, height: 0 };
  expect(frustumFor(none)).toEqual({
    left: -VIEW_HEIGHT / 2,
    right: VIEW_HEIGHT / 2,
    top: VIEW_HEIGHT / 2,
    bottom: -VIEW_HEIGHT / 2,
  });
  expect(frameBounds(BOUNDS, none)).toEqual({ x: 0, z: 0, zoom: VIEW_HEIGHT / 16 });
  expect(panBy({ x: 0, z: 0, zoom: 1 }, 0, 0, none, BOUNDS)).toEqual({ x: 0, z: 0, zoom: 1 });
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

test("easing ends exactly on the target view", () => {
  const from = { x: 0.1, z: 0.3, zoom: 0.35 };
  const to = { x: 0.7, z: -0.1, zoom: 2.9 };
  expect(easeView(from, to, 1)).toEqual(to);
});

test("a world point lands on the pixel it is drawn at", () => {
  const view = { x: 2, z: 3, zoom: 0.5 };
  const perUnit = (844 * 0.5) / VIEW_HEIGHT;
  expect(pixelsPerUnit(view, PHONE)).toBe(perUnit);
  expect(screenPoint(view, PHONE, { x: 2, y: 0, z: 3 })).toEqual({ x: 195, y: 422 });
  expect(screenPoint(view, PHONE, { x: 3, y: 0, z: 3 }).x).toBeCloseTo(195 + perUnit, 9);
  // Towards the camera is down the screen, by 1 / GROUND_SCALE of the distance.
  expect(screenPoint(view, PHONE, { x: 2, y: 0, z: 3 + GROUND_SCALE }).y).toBeCloseTo(
    422 + perUnit,
    9,
  );
  // Height is up the screen, shortened by the camera looking down.
  const lift = CAMERA_BACK / Math.hypot(CAMERA_HEIGHT, CAMERA_BACK);
  expect(screenPoint(view, PHONE, { x: 2, y: 1, z: 3 }).y).toBeCloseTo(422 - perUnit * lift, 9);
});

test("dragging a point to the middle of the screen makes it the point the camera looks at", () => {
  const view = { x: 2, z: 3, zoom: 0.5 };
  const wide = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
  const at = screenPoint(view, PHONE, { x: 5, y: 0, z: -4 });
  const moved = panBy(view, 195 - at.x, 422 - at.y, PHONE, wide);
  expect(moved.x).toBeCloseTo(5, 9);
  expect(moved.z).toBeCloseTo(-4, 9);
});
