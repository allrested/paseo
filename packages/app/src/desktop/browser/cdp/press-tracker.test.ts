import { describe, expect, it } from "vitest";
import { createClickCounter, createPressTracker } from "./press-tracker";

function mouse(
  type: "down" | "up",
  x = 10,
  y = 20,
  button: "left" | "right" = "left",
  clickCount = 1,
) {
  return {
    kind: "mouse" as const,
    type,
    x,
    y,
    button,
    buttons: type === "down" ? 1 : 0,
    clickCount,
    modifiers: 0,
  };
}

function key(type: "down" | "up", name: string, code = name, modifiers = 0) {
  return { kind: "key" as const, type, key: name, code, modifiers };
}

describe("press tracker", () => {
  it("releases every pressed button and key on releaseAll", () => {
    const tracker = createPressTracker();
    tracker.press(mouse("down", 10, 20, "left", 2));
    tracker.press(key("down", "Control", "ControlLeft", 2));
    tracker.press(key("down", "a", "KeyA"));
    expect(tracker.releaseAll()).toEqual([
      { ...mouse("up", 10, 20, "left", 2), buttons: 0 },
      key("up", "Control", "ControlLeft"),
      key("up", "a", "KeyA"),
    ]);
  });

  it("sends a release only once", () => {
    const tracker = createPressTracker();
    tracker.press(key("down", "a", "KeyA"));
    expect(tracker.releaseAll()).toEqual([key("up", "a", "KeyA")]);
    expect(tracker.releaseAll()).toEqual([]);
    expect(tracker.release(key("up", "a", "KeyA"))).toEqual([]);
  });

  it("sends nothing for a key or button that was never pressed", () => {
    const tracker = createPressTracker();
    expect(tracker.releaseAll()).toEqual([]);
    expect(tracker.release(key("up", "v", "KeyV"))).toEqual([]);
    expect(tracker.release(mouse("up"))).toEqual([]);
  });

  it("passes a matching key up through and forgets the key", () => {
    const tracker = createPressTracker();
    tracker.press(key("down", "a", "KeyA"));
    expect(tracker.release(key("up", "a", "KeyA"))).toEqual([key("up", "a", "KeyA")]);
    expect(tracker.releaseAll()).toEqual([]);
  });

  it("releasing Meta also releases the other keys, whose keyup the OS drops", () => {
    const tracker = createPressTracker();
    tracker.press(key("down", "Meta", "MetaLeft", 4));
    tracker.press(key("down", "x", "KeyX", 4));
    expect(tracker.release(key("up", "Meta", "MetaLeft"))).toEqual([
      key("up", "x", "KeyX"),
      key("up", "Meta", "MetaLeft"),
    ]);
    expect(tracker.releaseAll()).toEqual([]);
  });

  it("sends the mouse up with the click count of its press", () => {
    const tracker = createPressTracker();
    tracker.press(mouse("down", 10, 20, "left", 2));
    expect(tracker.release(mouse("up", 12, 22, "left", 1))).toEqual([
      mouse("up", 12, 22, "left", 2),
    ]);
  });

  it("releases a button at the last known pointer position", () => {
    const tracker = createPressTracker();
    tracker.press(mouse("down", 10, 20));
    tracker.moved(30, 40);
    expect(tracker.releaseAll()).toEqual([mouse("up", 30, 40)]);
  });
});

describe("click counter", () => {
  const at = (time: { now: number }) => () => time.now;

  it("counts a single press as 1", () => {
    const time = { now: 1000 };
    const counter = createClickCounter(at(time));
    expect(counter.press("left", 10, 10)).toBe(1);
  });

  it("counts a second and a third press in time and place as 2 and 3", () => {
    const time = { now: 1000 };
    const counter = createClickCounter(at(time));
    expect(counter.press("left", 10, 10)).toBe(1);
    time.now = 1300;
    expect(counter.press("left", 12, 11)).toBe(2);
    time.now = 1600;
    expect(counter.press("left", 11, 10)).toBe(3);
  });

  it("starts over after more than 500 ms", () => {
    const time = { now: 1000 };
    const counter = createClickCounter(at(time));
    counter.press("left", 10, 10);
    time.now = 1501;
    expect(counter.press("left", 10, 10)).toBe(1);
  });

  it("starts over when the pointer moved more than 5 px", () => {
    const time = { now: 1000 };
    const counter = createClickCounter(at(time));
    counter.press("left", 10, 10);
    time.now = 1100;
    expect(counter.press("left", 16, 10)).toBe(1);
  });

  it("starts over for another button", () => {
    const time = { now: 1000 };
    const counter = createClickCounter(at(time));
    counter.press("left", 10, 10);
    time.now = 1100;
    expect(counter.press("right", 10, 10)).toBe(1);
  });
});
