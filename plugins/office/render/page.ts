// The render page: the office scene as a headless client in the daemon's Chromium. The daemon
// loads three.js into THREE_GLOBAL, runs this script, and then drives the page through
// RENDER_GLOBAL. Built for a browser by the daemon (bundleBrowserScript); never imported.
import { createOfficeScene, type OfficeScene } from "../client/scene/office-scene.web.js";
import { scenePalette, type ScenePalette } from "../client/scene/palette.js";
import { isThreeModule } from "../client/scene/three-types.js";
import {
  PAGE_FRAME_MS,
  PICTURE_QUALITY,
  RENDER_GLOBAL,
  THREE_GLOBAL,
  type OfficeRenderGlobal,
  type RenderPageEvent,
  type RenderTake,
} from "../shared/render.js";
import { createRenderPipeline, type RenderPipeline } from "./pipeline.js";

const JPEG_PREFIX = "data:image/jpeg;base64,";
const globals = globalThis as unknown as Record<string, unknown>;

interface Running {
  scene: OfficeScene;
  pipeline: RenderPipeline;
  palette: ScenePalette;
  canvas: HTMLCanvasElement;
}

let running: Running | null = null;
let dirty = false;
const events: RenderPageEvent[] = [];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireRunning(): Running {
  if (running === null) throw new Error("The render page was not started");
  return running;
}

const page: OfficeRenderGlobal = {
  start({ colors, coarsePointer }) {
    if (running !== null) throw new Error("The render page was already started");
    const three = globals[THREE_GLOBAL];
    if (!isThreeModule(three)) throw new Error("three.js is not loaded in the render page");
    // The scene fills its container, so the page is one container the size of the viewport.
    for (const element of [document.documentElement, document.body]) {
      element.style.margin = "0";
      element.style.height = "100%";
      element.style.overflow = "hidden";
    }
    document.body.style.position = "relative";
    const container = document.body;
    const palette = scenePalette({ colors });
    const pipeline = createRenderPipeline(palette);
    const scene = createOfficeScene({
      three,
      container,
      coarsePointer,
      reducedMotion: false,
      preserveDrawingBuffer: true,
      // Not the browser's frame clock: this window is not on screen, and there that clock runs
      // about four times a second once the page draws, which shows as a still, jerky office.
      frames: {
        request: (callback) => window.setTimeout(() => callback(performance.now()), PAGE_FRAME_MS),
        cancel: (handle) => window.clearTimeout(handle),
      },
      onFrame: () => {
        dirty = true;
      },
      onSelectAgent: (agentId) => events.push({ type: "agent", agentId }),
      onSelectBoard: (roomId) => events.push({ type: "board", roomId }),
      onContextLost: () =>
        events.push({ type: "problem", message: "the graphics context was lost" }),
    });
    const canvas = container.querySelector("canvas");
    if (canvas === null) throw new Error("The scene made no canvas");
    running = { scene, pipeline, palette, canvas };
    const measure = () => {
      try {
        const plan = pipeline.resize(container.clientWidth, container.clientHeight);
        if (plan !== null) scene.update(plan, palette);
      } catch (error) {
        events.push({ type: "problem", message: messageOf(error) });
      }
    };
    new ResizeObserver(measure).observe(container);
    measure();
  },
  state(event) {
    const { scene, pipeline, palette } = requireRunning();
    const plan = pipeline.apply(event);
    if (plan !== null) scene.update(plan, palette);
  },
  focus(target) {
    const { scene } = requireRunning();
    if ("roomId" in target) scene.focusRoom(target.roomId);
    else scene.focusAgent(target.agentId);
  },
  take(): RenderTake {
    const { canvas } = requireRunning();
    const taken = events.splice(0);
    if (!dirty) return { picture: null, events: taken };
    dirty = false;
    const jpeg = canvas.toDataURL("image/jpeg", PICTURE_QUALITY).slice(JPEG_PREFIX.length);
    return { picture: { jpeg, width: canvas.width, height: canvas.height }, events: taken };
  },
};

globals[RENDER_GLOBAL] = page;
