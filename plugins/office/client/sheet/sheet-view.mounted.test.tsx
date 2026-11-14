/**
 * @vitest-environment jsdom
 */
// The sheet view, mounted: what a tap on a robot does, what a problem does, and how often the
// host is asked for a sprite. jsdom lays nothing out, so a test gives the view its size and says
// the size changed.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  PluginRpcProvider,
  type PluginSubscribe,
  type PluginSubscriptionObserver,
} from "@getpaseo/plugin/client/host";
import type { SheetEvent } from "../../shared/contracts.js";
import type { Sheet, SpritePicture } from "../../shared/sheet.js";
import { LIGHT_THEME_COLORS } from "../scene/fake-theme.js";
import { useOfficeStyles } from "../styles.js";
import { SheetView } from "./sheet-view.js";

const THEME = { colors: LIGHT_THEME_COLORS };

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

async function invoke(method: string, input: unknown): Promise<unknown> {
  if (method === "office.sheet.sprite.request") {
    spriteCalls.push(input as { sheetId: string; key: string });
    return SPRITE;
  }
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
        coarsePointer
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
    robots: [
      { agentId: "a", key: "typing", x: 100, y: 300, phase: 0, joining: false, fresh: false },
    ],
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
  opened = [];
  spriteCalls = [];
  selected = [];
  problems = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Mounted />));
  await layout(200, 400);
  await hostSays({ type: "ready", sheetId: "s1" });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("a tap at a robot's chest selects the agent", async () => {
  await shown(1);
  // The chest is at (130, 340) picture pixels: (65, 170) points.
  await tapAt(65, 170);

  expect(selected).toEqual(["a"]);
});

test("a tap far from every robot selects nothing", async () => {
  await shown(1);

  await tapAt(190, 20);

  expect(selected).toEqual([]);
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
