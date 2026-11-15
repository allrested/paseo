/**
 * @vitest-environment jsdom
 */
// The sheet view, mounted: what a tap on a robot does, what a problem does, and how often the
// host is asked for a sprite. jsdom lays nothing out, so a test gives the view its size and says
// the size changed.
import { act } from "react";
import { Animated } from "react-native";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  PluginRpcProvider,
  type PluginSubscribe,
  type PluginSubscriptionObserver,
} from "@getpaseo/plugin/client/host";
import type { SheetEvent } from "../../shared/contracts.js";
import type { Sheet, SheetWalk, SpritePicture } from "../../shared/sheet.js";
import { LIGHT_THEME_COLORS } from "../scene/fake-theme.js";
import { useOfficeStyles } from "../styles.js";
import { SheetView } from "./sheet-view.js";

const THEME = { colors: LIGHT_THEME_COLORS };

// React Native Web asks the browser once, when it loads, and takes a browser that cannot say for
// one that wants less motion. jsdom cannot say.
const motion = vi.hoisted(() => {
  const asked = { reduced: false };
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return asked.reduced;
    },
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  return asked;
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
// React Native Web makes one observer for every view, the first time a view asks for its layout.
let resized: (entries: Array<{ target: Element }>) => void = () => {
  throw new Error("No view has asked for its layout");
};
vi.stubGlobal(
  "ResizeObserver",
  class {
    constructor(callback: (entries: Array<{ target: Element }>) => void) {
      resized = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

interface Opened {
  observer: PluginSubscriptionObserver;
}

let opened: Opened[];
let spriteCalls: Array<{ sheetId: string; key: string }>;
let selected: string[];
let problems: string[];
let container: HTMLElement;
let root: Root;

const subscribe: PluginSubscribe = (_method, _input, observer) => {
  opened.push({ observer });
  const close = () => {};
  return Object.assign(close, { ready: Promise.resolve(), release: async () => close() });
};

const SPRITE: SpritePicture = {
  png: "PNG",
  frames: 1,
  columns: 1,
  frameWidth: 60,
  frameHeight: 80,
  frameMs: 0,
  loop: true,
  scale: 40,
};

/** What the host answers for a sprite key; a test replaces it to hold an answer back. */
let spriteAnswer: (key: string) => Promise<SpritePicture | null>;
let inputCalls: number;

const stillOf = (key: string): SpritePicture => ({ ...SPRITE, png: key.toUpperCase() });

async function invoke(method: string, input: unknown): Promise<unknown> {
  if (method === "office.sheet.sprite.request") {
    const asked = input as { sheetId: string; key: string };
    spriteCalls.push(asked);
    return spriteAnswer(asked.key);
  }
  inputCalls += 1;
  return { ok: true };
}

function selectAgent(agentId: string): void {
  selected.push(agentId);
}

function ignoreBoard(): void {}

function reportProblem(message: string): void {
  problems.push(message);
}

function Mounted() {
  const styles = useOfficeStyles(THEME, true, true);
  return (
    <PluginRpcProvider invoke={invoke} subscribe={subscribe}>
      <SheetView
        theme={THEME}
        styles={styles}
        focusRoomId={null}
        focusRequest={null}
        onSelectAgent={selectAgent}
        onSelectBoard={ignoreBoard}
        onProblem={reportProblem}
      />
    </PluginRpcProvider>
  );
}

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

async function layout(width: number, height: number): Promise<void> {
  const scene = container.firstElementChild!;
  Object.defineProperty(scene, "offsetWidth", { configurable: true, value: width });
  Object.defineProperty(scene, "offsetHeight", { configurable: true, value: height });
  resized([{ target: scene }]);
  await settle();
}

async function hostSays(event: SheetEvent): Promise<void> {
  await act(async () => opened[0]!.observer.event(event));
  await settle();
}

// 400 x 800 picture pixels at 2 per point: 200 x 400 points, the size of the view, so the first
// transform is the identity and picture pixels are twice the view's points.
function sheet(version: number, extra: Partial<Sheet> = {}): Sheet {
  return {
    version,
    tiles: 1,
    width: 400,
    height: 800,
    ratio: 2,
    scale: 40,
    frame: { width: 60, height: 80, chest: { x: 30, y: 40 } },
    robots: [{ agentId: "a", key: "typing", x: 100, y: 300, phase: 0, walk: null, fresh: false }],
    rooms: [],
    notes: [],
    mentions: [],
    ...extra,
  };
}

async function shown(version: number, extra: Partial<Sheet> = {}): Promise<void> {
  await hostSays({
    type: "tile",
    tile: { version, index: 0, x: 0, y: 0, width: 400, height: 800, jpeg: "J", overlay: null },
  });
  await hostSays({ type: "sheet", sheet: sheet(version, extra) });
}

/** A finger down and up at one point of the view. */
async function tapAt(x: number, y: number): Promise<void> {
  const touch = container.querySelector('[aria-label="Office in 3D"]')!;
  const fire = (type: string) =>
    act(async () => {
      touch.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
        }),
      );
    });
  await fire("mousedown");
  await fire("mouseup");
}

beforeEach(async () => {
  motion.reduced = false;
  opened = [];
  spriteCalls = [];
  selected = [];
  problems = [];
  inputCalls = 0;
  spriteAnswer = async (key) => stillOf(key);
  container = document.createElement("div");
  document.body.appendChild(container);
  await mount();
});

async function mount(): Promise<void> {
  opened = [];
  root = createRoot(container);
  await act(async () => root.render(<Mounted />));
  await layout(200, 400);
  await hostSays({ type: "ready", sheetId: "s1" });
}

afterEach(() => {
  vi.restoreAllMocks();
  act(() => root.unmount());
  container.remove();
});

test("a tap at a robot's chest selects the agent, and one far from it does not", async () => {
  await shown(1);

  await tapAt(190, 20);
  expect(selected).toEqual([]);

  // The chest is at (130, 340) picture pixels: (65, 170) points.
  await tapAt(65, 170);
  expect(selected).toEqual(["a"]);
});

test("a problem from the host reaches the surface", async () => {
  await hostSays({ type: "problem", message: "no page" });

  expect(problems).toEqual(["no page"]);
});

test("the host is asked for a sprite once per key across two sheets", async () => {
  await shown(1);
  await hostSays({ type: "sheet", sheet: sheet(1) });
  await shown(2);

  expect(spriteCalls).toEqual([{ sheetId: "s1", key: "typing" }]);
});

const spriteSources = () =>
  [...container.querySelectorAll("img")]
    .map((image) => image.getAttribute("src") ?? "")
    .filter((source) => source.startsWith("data:image/png"));

test("a robot keeps its picture while the sprite of its new key is fetched", async () => {
  await shown(1);
  expect(spriteSources()).toEqual(["data:image/png;base64,TYPING"]);

  let answer: (picture: SpritePicture) => void = () => {};
  spriteAnswer = () => new Promise((done) => (answer = done));
  await hostSays({
    type: "sheet",
    sheet: sheet(1, {
      robots: [{ agentId: "a", key: "raised", x: 100, y: 300, phase: 0, walk: null, fresh: false }],
    }),
  });
  expect(spriteSources()).toEqual(["data:image/png;base64,TYPING"]);

  await act(async () => answer(stillOf("raised")));
  await settle();
  expect(spriteSources()).toEqual(["data:image/png;base64,RAISED"]);
});

// Out of one room and into the next: a leg behind the near walls, then one in front of them.
const WALK: SheetWalk = {
  id: 1,
  ms: 40,
  x: 100,
  y: 300,
  legs: [
    { x: 150, y: 400, until: 0.5, key: "walk|out", inside: true },
    { x: 200, y: 500, until: 1, key: "walk|over", inside: false },
  ],
};
const MOVED = {
  robots: [{ agentId: "a", key: "idle", x: 200, y: 500, phase: 0, walk: WALK, fresh: false }],
};

/** Each robot picture shown and where its frame's corner is laid. */
const spritesShown = () =>
  [...container.querySelectorAll("img")]
    .filter((image) => (image.getAttribute("src") ?? "").startsWith("data:image/png"))
    .map((image) => {
      const frame = image.closest<HTMLElement>('[style*="overflow"]')!;
      return [image.getAttribute("src")!.slice("data:image/png;base64,".length), frame.style.left];
    });

/**
 * Holds every timed animation until the test ends it. The test build of Animated ends each one
 * as it starts, so a walk would be over before it could be looked at.
 */
function heldAnimations() {
  const ends: Array<(result: { finished: boolean }) => void> = [];
  const durations: number[] = [];
  vi.spyOn(Animated, "timing").mockImplementation((_value, config) => {
    durations.push(config.duration ?? 0);
    return {
      start: (callback?: (result: { finished: boolean }) => void) => {
        if (callback) ends.push(callback);
      },
      stop: () => {},
      reset: () => {},
    };
  });
  return {
    durations,
    finish: () =>
      act(async () => {
        for (const end of ends.splice(0)) end({ finished: true });
      }),
  };
}

test("a robot that changes room waits at its old seat, walks, and sits down at the new one", async () => {
  const animations = heldAnimations();
  await shown(1);
  const answers = new Map<string, (picture: SpritePicture) => void>();
  spriteAnswer = (key) => new Promise((done) => answers.set(key, done));

  await hostSays({ type: "sheet", sheet: sheet(1, MOVED) });
  // Its walk's pictures and its new look are asked for; until they come it is where it was.
  expect(spriteCalls.map((call) => call.key).sort()).toEqual([
    "idle",
    "typing",
    "walk|out",
    "walk|over",
  ]);
  expect(spritesShown()).toEqual([["TYPING", "100px"]]);

  await act(async () => answers.get("walk|out")!(stillOf("walk|out")));
  await settle();
  expect(spritesShown()).toEqual([["TYPING", "100px"]]);

  await act(async () => {
    answers.get("walk|over")!(stillOf("walk|over"));
    answers.get("idle")!(stillOf("idle"));
  });
  // On foot: one picture a leg, and none at a desk. The walk takes as long as the host says.
  expect(spritesShown().map(([png]) => png)).toEqual(["WALK|OUT", "WALK|OVER"]);
  expect(animations.durations).toEqual([WALK.ms]);

  await animations.finish();
  expect(spritesShown()).toEqual([["IDLE", "200px"]]);
});

test("a robot that arrives is not drawn until it walks in, and sits down without fading in", async () => {
  const animations = heldAnimations();
  await shown(1);
  const answers = new Map<string, (picture: SpritePicture) => void>();
  spriteAnswer = (key) => new Promise((done) => answers.set(key, done));
  const arrived = {
    robots: [
      sheet(1).robots[0]!,
      {
        agentId: "b",
        key: "walking",
        x: 200,
        y: 500,
        phase: 0,
        walk: {
          id: 2,
          ms: 1500,
          x: 240,
          y: 600,
          legs: [{ ...WALK.legs[0]!, x: 200, y: 500, until: 1 }],
        },
        fresh: false,
      },
    ],
  };

  await hostSays({ type: "sheet", sheet: sheet(1, arrived) });
  expect(spritesShown()).toEqual([["TYPING", "100px"]]);

  await act(async () => {
    answers.get("walk|out")!(stillOf("walk|out"));
    answers.get("walking")!(stillOf("walking"));
  });
  expect(spritesShown().map(([png]) => png)).toEqual(["TYPING", "WALK|OUT"]);

  await animations.finish();
  expect(spritesShown()).toEqual([
    ["TYPING", "100px"],
    ["WALKING", "200px"],
  ]);
  // The walk is the only thing that was timed: no fade for the robot that walked in.
  expect(animations.durations).toEqual([1500]);
});

test("with reduced motion a robot is at its new desk at once", async () => {
  await act(async () => root.unmount());
  motion.reduced = true;
  await mount();
  const animations = heldAnimations();
  await shown(1);

  await hostSays({ type: "sheet", sheet: sheet(1, MOVED) });

  expect(spriteCalls.map((call) => call.key)).toEqual(["typing", "idle"]);
  expect(spritesShown()).toEqual([["IDLE", "200px"]]);
  expect(animations.durations).toEqual([]);
});

test("a walk is played once: the sheets that name it again do not start it over", async () => {
  const animations = heldAnimations();
  await shown(1);
  await hostSays({ type: "sheet", sheet: sheet(1, MOVED) });
  await hostSays({ type: "sheet", sheet: sheet(1, MOVED) });
  expect(animations.durations).toEqual([WALK.ms]);

  await animations.finish();
  await hostSays({ type: "sheet", sheet: sheet(1, MOVED) });
  expect(animations.durations).toEqual([WALK.ms]);
  expect(spritesShown()).toEqual([["IDLE", "200px"]]);
});

test("a view that opens while a robot is on its way shows it at its desk", async () => {
  await shown(1, MOVED);

  expect(spriteCalls.map((call) => call.key)).toEqual(["idle"]);
  expect(spritesShown()).toEqual([["IDLE", "200px"]]);
});

test("a walk whose pictures do not come is given up, and the robot sits at its new desk", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(1)));
    await act(async () => {
      opened[0]!.observer.event({
        type: "tile",
        tile: {
          version: 1,
          index: 0,
          x: 0,
          y: 0,
          width: 400,
          height: 800,
          jpeg: "J",
          overlay: null,
        },
      });
      opened[0]!.observer.event({ type: "sheet", sheet: sheet(1) });
    });
    await flush();
    spriteAnswer = async (key) => (key.startsWith("walk|") ? null : stillOf(key));
    await act(async () => opened[0]!.observer.event({ type: "sheet", sheet: sheet(1, MOVED) }));
    await flush();
    expect(spritesShown()).toEqual([["TYPING", "100px"]]);

    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
    expect(spritesShown()).toEqual([["IDLE", "200px"]]);
  } finally {
    vi.useRealTimers();
  }
});

test("a new backdrop ends a walk made for the old one", async () => {
  heldAnimations();
  await shown(1);
  await hostSays({ type: "sheet", sheet: sheet(1, MOVED) });
  expect(spritesShown().map(([png]) => png)).toEqual(["WALK|OUT", "WALK|OVER"]);

  await shown(2, MOVED);
  expect(spritesShown()).toEqual([["IDLE", "200px"]]);
});

test("a sprite that failed is asked for again later, not in a loop", async () => {
  spriteAnswer = async () => null;
  await shown(1);
  await hostSays({ type: "sheet", sheet: sheet(1) });
  await hostSays({ type: "sheet", sheet: sheet(1) });

  expect(spriteCalls).toHaveLength(1);
});

test("a view that is gone sends nothing more and stops its loop", async () => {
  const stops: ReturnType<typeof vi.fn>[] = [];
  const loop = Animated.loop;
  vi.spyOn(Animated, "loop").mockImplementation((animation, config) => {
    const made = loop(animation, config);
    const stop = vi.spyOn(made, "stop");
    stops.push(stop);
    return made;
  });
  const intervals: unknown[] = [];
  const cleared: unknown[] = [];
  const setter = globalThis.setInterval;
  const clearer = globalThis.clearInterval;
  vi.spyOn(globalThis, "setInterval").mockImplementation(((
    ...args: Parameters<typeof setInterval>
  ) => {
    const id = setter(...args);
    if (args[1] === 10_000) intervals.push(id);
    return id;
  }) as typeof setInterval);
  vi.spyOn(globalThis, "clearInterval").mockImplementation(((
    id: Parameters<typeof clearInterval>[0],
  ) => {
    cleared.push(id);
    clearer(id);
  }) as typeof clearInterval);

  await act(async () => root.unmount());
  await mount();
  spriteAnswer = async (key) => ({ ...stillOf(key), frames: 24, columns: 6, frameMs: 86 });
  await shown(1);
  expect(intervals).toHaveLength(1);
  expect(stops).toHaveLength(1);

  await act(async () => root.unmount());

  expect(cleared).toContain(intervals[0]);
  expect(stops[0]).toHaveBeenCalled();
  const calls = inputCalls;
  await settle();
  expect(inputCalls).toBe(calls);
  // The afterEach unmounts a root; this one is already gone.
  root = createRoot(container);
});
