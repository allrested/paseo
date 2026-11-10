import { describe, expect, it, vi } from "vitest";
import { createInputCoalescer, createTouchGesture } from "./touch-gesture";

describe("touch gesture", () => {
  it("a tap is a move, a press and a release at the touch point", () => {
    const gesture = createTouchGesture();
    gesture.start({ x: 100, y: 200 });
    expect(gesture.move({ x: 102, y: 203 })).toEqual([]);
    expect(gesture.end()).toEqual([
      {
        kind: "mouse",
        type: "move",
        x: 100,
        y: 200,
        button: "none",
        buttons: 0,
        clickCount: 0,
        modifiers: 0,
      },
      {
        kind: "mouse",
        type: "down",
        x: 100,
        y: 200,
        button: "left",
        buttons: 1,
        clickCount: 1,
        modifiers: 0,
      },
      {
        kind: "mouse",
        type: "up",
        x: 100,
        y: 200,
        button: "left",
        buttons: 0,
        clickCount: 1,
        modifiers: 0,
      },
    ]);
  });

  it("a drag scrolls the page the way the finger moves it, and ends without a click", () => {
    const gesture = createTouchGesture();
    gesture.start({ x: 100, y: 200 });
    expect(gesture.move({ x: 100, y: 180 })).toEqual([
      { kind: "wheel", x: 100, y: 200, deltaX: 0, deltaY: 20, modifiers: 0 },
    ]);
    expect(gesture.move({ x: 90, y: 150 })).toEqual([
      { kind: "wheel", x: 100, y: 200, deltaX: 10, deltaY: 30, modifiers: 0 },
    ]);
    expect(gesture.end()).toEqual([]);
  });

  it("ignores a move or an end with no touch in progress", () => {
    const gesture = createTouchGesture();
    expect(gesture.move({ x: 1, y: 1 })).toEqual([]);
    expect(gesture.end()).toEqual([]);
  });

  it("cancel drops the touch without a click", () => {
    const gesture = createTouchGesture();
    gesture.start({ x: 1, y: 1 });
    gesture.cancel();
    expect(gesture.end()).toEqual([]);
  });
});

function mouseMove(x: number, y: number) {
  return {
    kind: "mouse" as const,
    type: "move" as const,
    x,
    y,
    button: "none" as const,
    buttons: 0,
    clickCount: 0,
    modifiers: 0,
  };
}

function wheel(x: number, y: number, deltaX: number, deltaY: number) {
  return { kind: "wheel" as const, x, y, deltaX, deltaY, modifiers: 0 };
}

function setup() {
  const send = vi.fn();
  const frames: Array<() => void> = [];
  const schedule = vi.fn((callback: () => void) => frames.push(callback));
  const cancel = vi.fn();
  const coalescer = createInputCoalescer(send, schedule, cancel);
  const runFrame = () => frames.splice(0).forEach((callback) => callback());
  return { send, schedule, cancel, coalescer, runFrame };
}

describe("input coalescer", () => {
  it("sends only the latest pointer move once per frame", () => {
    const { send, schedule, coalescer, runFrame } = setup();
    coalescer.push(mouseMove(1, 1));
    coalescer.push(mouseMove(2, 2));
    coalescer.push(mouseMove(3, 3));
    expect(send).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledTimes(1);
    runFrame();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(mouseMove(3, 3));
  });

  it("sums wheel deltas within a frame and keeps the latest position", () => {
    const { send, coalescer, runFrame } = setup();
    coalescer.push(wheel(5, 5, 1, 10));
    coalescer.push(wheel(6, 7, 2, 20));
    runFrame();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(wheel(6, 7, 3, 30));
  });

  it("flushes a pending move before an input that must keep its order", () => {
    const { send, coalescer, runFrame } = setup();
    const down = { ...mouseMove(4, 4), type: "down" as const, button: "left" as const };
    coalescer.push(mouseMove(3, 3));
    coalescer.push(down);
    expect(send).toHaveBeenNthCalledWith(1, mouseMove(3, 3));
    expect(send).toHaveBeenNthCalledWith(2, down);
    runFrame();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("sends a key at once", () => {
    const { send, coalescer } = setup();
    const key = {
      kind: "key" as const,
      type: "down" as const,
      key: "a",
      code: "KeyA",
      modifiers: 0,
    };
    coalescer.push(key);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(key);
  });

  it("drops what is pending on dispose", () => {
    const { send, cancel, coalescer, runFrame } = setup();
    coalescer.push(wheel(1, 1, 0, 5));
    coalescer.dispose();
    runFrame();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });
});
