import { expect, test } from "vitest";
import {
  createStreamGesture,
  gestureToDevice,
  letterbox,
  toDevice,
  type GestureAction,
} from "./stream-gesture.js";

const DEVICE = { width: 720, height: 1280 };

test("a press and release in place is a tap at the press point", () => {
  const gesture = createStreamGesture();
  expect(gesture.touch({ type: "start", x: 100, y: 200, at: 0 })).toBeNull();
  expect(gesture.touch({ type: "end", x: 100, y: 200, at: 80 })).toEqual({
    type: "tap",
    at: { x: 100, y: 200 },
  });
});

test("a release within 8 px is a tap, and 9 px is a swipe", () => {
  const gesture = createStreamGesture();
  gesture.touch({ type: "start", x: 100, y: 200, at: 0 });
  gesture.touch({ type: "move", x: 105, y: 204, at: 30 });
  expect(gesture.touch({ type: "end", x: 106, y: 205, at: 60 })?.type).toBe("tap");

  gesture.touch({ type: "start", x: 100, y: 200, at: 0 });
  expect(gesture.touch({ type: "end", x: 109, y: 200, at: 300 })?.type).toBe("swipe");
});

test("a swipe runs from press to release with the gesture's own duration", () => {
  const gesture = createStreamGesture();
  gesture.touch({ type: "start", x: 10, y: 20, at: 1000 });
  expect(gesture.touch({ type: "end", x: 10, y: 220, at: 1400 })).toEqual({
    type: "swipe",
    from: { x: 10, y: 20 },
    to: { x: 10, y: 220 },
    durationMs: 400,
  });
});

test("the duration is clamped to 50..3000 ms", () => {
  const gesture = createStreamGesture();
  gesture.touch({ type: "start", x: 0, y: 0, at: 0 });
  expect(gesture.touch({ type: "end", x: 0, y: 100, at: 5 })).toMatchObject({ durationMs: 50 });
  gesture.touch({ type: "start", x: 0, y: 0, at: 0 });
  expect(gesture.touch({ type: "end", x: 0, y: 100, at: 9000 })).toMatchObject({
    durationMs: 3000,
  });
});

test("a cancelled touch, and an end with no start, do nothing", () => {
  const gesture = createStreamGesture();
  expect(gesture.touch({ type: "end", x: 1, y: 1, at: 0 })).toBeNull();
  gesture.touch({ type: "start", x: 0, y: 0, at: 0 });
  expect(gesture.touch({ type: "cancel", x: 90, y: 90, at: 10 })).toBeNull();
  expect(gesture.touch({ type: "end", x: 90, y: 90, at: 20 })).toBeNull();
});

test("a picture in a wide view is letterboxed left and right", () => {
  const rect = letterbox({ width: 800, height: 640 }, DEVICE);
  expect(rect).toEqual({ left: 220, top: 0, width: 360, height: 640 });
});

test("a picture in a tall view is letterboxed above and below", () => {
  const rect = letterbox({ width: 360, height: 1000 }, DEVICE);
  expect(rect).toEqual({ left: 0, top: 180, width: 360, height: 640 });
});

test("view pixels map to device pixels through the letterboxed rectangle, on both axes", () => {
  const wide = letterbox({ width: 800, height: 640 }, DEVICE);
  expect(toDevice(wide, DEVICE, { x: 220, y: 0 })).toEqual({ x: 0, y: 0 });
  expect(toDevice(wide, DEVICE, { x: 400, y: 320 })).toEqual({ x: 360, y: 640 });
  expect(toDevice(wide, DEVICE, { x: 580, y: 640 })).toEqual({ x: 719, y: 1279 });

  const tall = letterbox({ width: 360, height: 1000 }, DEVICE);
  expect(toDevice(tall, DEVICE, { x: 180, y: 500 })).toEqual({ x: 360, y: 640 });
});

test("a touch outside the picture is ignored", () => {
  const wide = letterbox({ width: 800, height: 640 }, DEVICE);
  expect(toDevice(wide, DEVICE, { x: 100, y: 300 })).toBeNull();
  const tall = letterbox({ width: 360, height: 1000 }, DEVICE);
  expect(toDevice(tall, DEVICE, { x: 100, y: 100 })).toBeNull();
});

test("gestureToDevice maps taps and swipes, ignores a press outside, and clamps a release", () => {
  const view = { width: 360, height: 1000 };
  const tap: GestureAction = { type: "tap", at: { x: 180, y: 500 } };
  expect(gestureToDevice(tap, view, DEVICE)).toEqual({ tap: { x: 360, y: 640 } });
  expect(gestureToDevice({ type: "tap", at: { x: 180, y: 50 } }, view, DEVICE)).toBeNull();

  const swipe: GestureAction = {
    type: "swipe",
    from: { x: 180, y: 600 },
    to: { x: 180, y: 100 },
    durationMs: 300,
  };
  expect(gestureToDevice(swipe, view, DEVICE)).toEqual({
    swipe: { from: { x: 360, y: 840 }, to: { x: 360, y: 0 }, durationMs: 300 },
  });
  expect(gestureToDevice({ ...swipe, from: { x: 180, y: 50 } }, view, DEVICE)).toBeNull();
});
