import { describe, expect, it } from "vitest";
import { createClickCounter, createPressTracker, isStaleFrame } from "./press-tracker";

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

describe("stale frame", () => {
  const claimed = { width: 390, height: 723, deviceScaleFactor: 2 };

  it("a frame of the claimed size is fresh, whatever the scale factor", () => {
    expect(isStaleFrame({ width: 390, height: 723 }, claimed)).toBe(false);
    expect(isStaleFrame({ width: 390, height: 723 }, { ...claimed, deviceScaleFactor: 1 })).toBe(
      false,
    );
  });

  it("a frame of another size is stale", () => {
    expect(isStaleFrame({ width: 524, height: 245 }, claimed)).toBe(true);
    expect(isStaleFrame({ width: 390, height: 245 }, claimed)).toBe(true);
  });

  it("1 px off on each axis is the same size, 2 px is not", () => {
    expect(isStaleFrame({ width: 391, height: 722 }, claimed)).toBe(false);
    expect(isStaleFrame({ width: 389.4, height: 723.6 }, claimed)).toBe(false);
    expect(isStaleFrame({ width: 392, height: 723 }, claimed)).toBe(true);
    expect(isStaleFrame({ width: 390, height: 721 }, claimed)).toBe(true);
  });

  it("is never stale before a frame or a measured pane", () => {
    expect(isStaleFrame({ width: 0, height: 0 }, claimed)).toBe(false);
    expect(isStaleFrame({ width: 390, height: 723 }, null)).toBe(false);
  });

  it("compares with the size the daemon clamps the claim to", () => {
    expect(isStaleFrame({ width: 320, height: 240 }, { ...claimed, width: 300, height: 200 })).toBe(
      false,
    );
    expect(
      isStaleFrame({ width: 1920, height: 1080 }, { ...claimed, width: 2400, height: 1300 }),
    ).toBe(false);
  });

  it("a frame at an agent's browser_resize size is stale for a pane that claims its own", () => {
    expect(isStaleFrame({ width: 1280, height: 720 }, claimed)).toBe(true);
  });
});

describe("press tracker on a stale frame", () => {
  it("sends a press on a frame of the claimed size", () => {
    const tracker = createPressTracker();
    expect(tracker.press(mouse("down"), false)).toBe(true);
    expect(tracker.dragAllowed()).toBe(true);
    expect(tracker.release(mouse("up"))).toEqual([mouse("up")]);
  });

  it("drops a press on a stale frame, its drag and its release", () => {
    const tracker = createPressTracker();
    expect(tracker.press(mouse("down"), true)).toBe(false);
    expect(tracker.dragAllowed()).toBe(false);
    expect(tracker.release(mouse("up"))).toEqual([]);
    expect(tracker.dragAllowed()).toBe(true);
  });

  it("keeps the press dropped when a fresh frame arrives before its release", () => {
    const tracker = createPressTracker();
    tracker.press(mouse("down"), true);
    // Nothing tells the tracker the frame is fresh now: the up is still the stale press's.
    expect(tracker.release(mouse("up"))).toEqual([]);
    expect(tracker.releaseAll()).toEqual([]);
  });

  it("sends the next press once the frame is fresh", () => {
    const tracker = createPressTracker();
    tracker.press(mouse("down"), true);
    tracker.release(mouse("up"));
    expect(tracker.press(mouse("down"), false)).toBe(true);
    expect(tracker.release(mouse("up"))).toEqual([mouse("up")]);
  });

  it("releaseAll sends no up for a press dropped as stale", () => {
    const tracker = createPressTracker();
    tracker.press(mouse("down"), true);
    expect(tracker.releaseAll()).toEqual([]);
    expect(tracker.dragAllowed()).toBe(true);
  });

  it("does not hold back keys", () => {
    const tracker = createPressTracker();
    expect(tracker.press(key("down", "a", "KeyA"))).toBe(true);
    expect(tracker.release(key("up", "a", "KeyA"))).toEqual([key("up", "a", "KeyA")]);
  });
});
