// Opens a render page in the daemon's Chromium and speaks to it. The only file that knows how
// three.js and the page script get into the page.
import type { PluginTheme } from "@getpaseo/plugin";
import { TAP_SLOP_PX } from "../../client/scene/camera.js";
import type { OfficeEvent, PointerStep } from "../../shared/contracts.js";
import {
  RENDER_GLOBAL,
  THREE_GLOBAL,
  type RenderFocus,
  type RenderStart,
  type RenderTake,
} from "../../shared/render.js";

export const NO_WEBGL = "The host browser has no WebGL";

export interface RenderViewport {
  /** CSS pixels. */
  width: number;
  height: number;
  deviceScaleFactor: number;
}

/** A page of the daemon's Chromium, as the daemon hands it to built-ins (OffscreenPage). */
export interface PagePort {
  evaluate<T = unknown>(expression: string): Promise<T>;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  setViewport(viewport: RenderViewport): Promise<void>;
  close(): Promise<void>;
  onClosed(listener: () => void): () => void;
}

export interface PagesPort {
  open(viewport: RenderViewport): Promise<PagePort>;
}

export interface RenderPage {
  state(event: OfficeEvent): Promise<void>;
  focus(target: RenderFocus): Promise<void>;
  pointer(steps: readonly PointerStep[]): Promise<void>;
  resize(viewport: RenderViewport): Promise<void>;
  take(): Promise<RenderTake>;
  close(): Promise<void>;
  onClosed(listener: () => void): () => void;
}

export interface RenderPageInput {
  viewport: RenderViewport;
  colors: PluginTheme["colors"];
  coarsePointer: boolean;
}

export interface RenderPageHost {
  /** Opens a page, loads three.js and the page script, and starts the scene. */
  open(input: RenderPageInput): Promise<RenderPage>;
}

export interface RenderPageHostDeps {
  pages: PagesPort;
  bundle(entryPath: string): Promise<string>;
  readThree(): Promise<Uint8Array>;
  /** The path of render/page.ts. */
  pageEntry: string;
}

const call = (method: string, argument?: unknown) =>
  `globalThis[${JSON.stringify(RENDER_GLOBAL)}].${method}(${argument === undefined ? "" : JSON.stringify(argument)})`;

/** three.js is an ES module, which only `import()` can run: from a blob URL, as the web UI does. */
function loadThree(source: string): string {
  return `(async () => {
    const url = URL.createObjectURL(new Blob([${JSON.stringify(source)}], { type: "text/javascript" }));
    try {
      globalThis[${JSON.stringify(THREE_GLOBAL)}] = await import(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    return true;
  })()`;
}

function mouse(type: string, at: { x: number; y: number }, pressed: boolean) {
  return {
    type,
    x: at.x,
    y: at.y,
    button: pressed || type !== "mouseMoved" ? "left" : "none",
    buttons: pressed ? 1 : 0,
    clickCount: type === "mouseMoved" ? 0 : 1,
  };
}

/**
 * The scene captures the pointer on press, which refuses an event a script made up, so steps go in
 * as real mouse events. A mouse has no cancel: a cancelled press is moved past the tap slop and
 * back before its release, so the scene pans nothing and picks nothing.
 */
function pointerSender(page: PagePort) {
  let down: { x: number; y: number } | null = null;
  let dragged = false;
  const send = (type: string, at: { x: number; y: number }, pressed: boolean) =>
    page.send("Input.dispatchMouseEvent", mouse(type, at, pressed));
  return async (steps: readonly PointerStep[]): Promise<void> => {
    for (const step of steps) {
      if (step.type === "down") {
        down = { x: step.x, y: step.y };
        dragged = false;
        await send("mousePressed", step, true);
      } else if (step.type === "move") {
        if (down !== null && Math.hypot(step.x - down.x, step.y - down.y) > TAP_SLOP_PX) {
          dragged = true;
        }
        await send("mouseMoved", step, down !== null);
      } else if (down !== null) {
        if (step.type === "cancel" && !dragged) {
          await send("mouseMoved", { x: down.x + TAP_SLOP_PX + 2, y: down.y }, true);
          await send("mouseMoved", down, true);
        }
        const at = step.type === "cancel" ? down : step;
        down = null;
        await send("mouseReleased", at, false);
      }
    }
  };
}

export function createRenderPageHost(deps: RenderPageHostDeps): RenderPageHost {
  let sources: Promise<{ three: string; script: string }> | null = null;

  /** Read and built once; a failure is not kept, so the next viewer tries again. */
  function loadSources(): Promise<{ three: string; script: string }> {
    sources ??= (async () => {
      const [three, script] = await Promise.all([deps.readThree(), deps.bundle(deps.pageEntry)]);
      return { three: new TextDecoder().decode(three), script };
    })().catch((error: unknown) => {
      sources = null;
      throw error;
    });
    return sources;
  }

  return {
    async open({ viewport, colors, coarsePointer }) {
      const { three, script } = await loadSources();
      const page = await deps.pages.open(viewport);
      try {
        const webgl = await page.evaluate<boolean>(
          `!!document.createElement("canvas").getContext("webgl2")`,
        );
        if (!webgl) throw new Error(NO_WEBGL);
        await page.evaluate(loadThree(three));
        await page.evaluate(script);
        const start: RenderStart = { colors, coarsePointer };
        await page.evaluate(call("start", start));
      } catch (error) {
        await page.close();
        throw error;
      }
      const pointer = pointerSender(page);
      return {
        state: async (event) => {
          await page.evaluate(call("state", event));
        },
        focus: async (target) => {
          await page.evaluate(call("focus", target));
        },
        pointer,
        resize: (next) => page.setViewport(next),
        take: () => page.evaluate<RenderTake>(call("take")),
        close: () => page.close(),
        onClosed: (listener) => page.onClosed(listener),
      };
    },
  };
}
