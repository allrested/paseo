import { expect, test } from "vitest";
import { MOVE_INTERVAL_MS, createStreamGesture } from "./stream-gesture.js";

test("a press and release in place is a down and an up at that point", () => {
  const gesture = createStreamGesture();

  expect(gesture.touch({ type: "start", x: 100, y: 200, at: 0 })).toEqual([
    { type: "down", x: 100, y: 200 },
  ]);
  expect(gesture.touch({ type: "end", x: 100, y: 200, at: 80 })).toEqual([
    { type: "up", x: 100, y: 200 },
  ]);
});

test("a move within 8 px sends nothing, and the release is still a tap at the press point", () => {
  const gesture = createStreamGesture();
  gesture.touch({ type: "start", x: 100, y: 200, at: 0 });

  expect(gesture.touch({ type: "move", x: 104, y: 203, at: 30 })).toEqual([]);
  expect(gesture.flush(500)).toEqual([]);
  // The finger wobbled: the release lands where the press was, so the scene sees a tap.
  expect(gesture.touch({ type: "end", x: 105, y: 204, at: 90 })).toEqual([
    { type: "up", x: 100, y: 200 },
  ]);
});

test("a drag sends its moves at most every 100 ms and keeps the latest for the flush", () => {
  const gesture = createStreamGesture();
  gesture.touch({ type: "start", x: 100, y: 200, at: 0 });

  expect(gesture.touch({ type: "move", x: 100, y: 180, at: 10 })).toEqual([
    { type: "move", x: 100, y: 180 },
  ]);
  expect(gesture.touch({ type: "move", x: 100, y: 160, at: 40 })).toEqual([]);
  expect(gesture.touch({ type: "move", x: 100, y: 150, at: 70 })).toEqual([]);
  expect(gesture.flush(90)).toEqual([]);
  expect(gesture.flush(10 + MOVE_INTERVAL_MS)).toEqual([{ type: "move", x: 100, y: 150 }]);
  expect(gesture.flush(400)).toEqual([]);
});

test("the release of a drag sends the held move before the up", () => {
  const gesture = createStreamGesture();
  gesture.touch({ type: "start", x: 100, y: 200, at: 0 });
  gesture.touch({ type: "move", x: 100, y: 180, at: 10 });
  gesture.touch({ type: "move", x: 100, y: 120, at: 50 });

  expect(gesture.touch({ type: "end", x: 100, y: 110, at: 60 })).toEqual([
    { type: "move", x: 100, y: 120 },
    { type: "up", x: 100, y: 110 },
  ]);
});

test("a cancelled touch sends a cancel, not an up", () => {
  const gesture = createStreamGesture();
  gesture.touch({ type: "start", x: 100, y: 200, at: 0 });
  gesture.touch({ type: "move", x: 100, y: 120, at: 10 });

  expect(gesture.touch({ type: "cancel", x: 100, y: 120, at: 20 })).toEqual([
    { type: "cancel", x: 100, y: 120 },
  ]);
});

test("moves and releases with no press send nothing", () => {
  const gesture = createStreamGesture();

  expect(gesture.touch({ type: "move", x: 1, y: 1, at: 0 })).toEqual([]);
  expect(gesture.touch({ type: "end", x: 1, y: 1, at: 1 })).toEqual([]);
  expect(gesture.touch({ type: "cancel", x: 1, y: 1, at: 2 })).toEqual([]);
});

test("says whether a move is waiting, so the view knows to set a timer", () => {
  const gesture = createStreamGesture();
  gesture.touch({ type: "start", x: 100, y: 200, at: 0 });
  gesture.touch({ type: "move", x: 100, y: 180, at: 10 });
  expect(gesture.waiting()).toBe(false);

  gesture.touch({ type: "move", x: 100, y: 160, at: 40 });

  expect(gesture.waiting()).toBe(true);
});
