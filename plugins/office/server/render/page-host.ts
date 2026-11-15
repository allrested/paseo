// Opens a page in the daemon's Chromium with three.js and a page script in it. The only file
// that knows how the two get into the page.
import { THREE_GLOBAL } from "../../shared/render.js";

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

export interface RenderPageHostDeps {
  pages: PagesPort;
  bundle(entryPath: string): Promise<string>;
  readThree(): Promise<Uint8Array>;
  /** The path of the page script, render/sheet-page.ts. */
  pageEntry: string;
}

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

/**
 * Opens pages that have three.js and the page script in them. Both are read and built once; a
 * failure is not kept, so the next viewer tries again.
 */
export function scriptedPages(
  deps: RenderPageHostDeps,
): (viewport: RenderViewport) => Promise<PagePort> {
  let sources: Promise<{ three: string; script: string }> | null = null;

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

  return async (viewport) => {
    const { three, script } = await loadSources();
    const page = await deps.pages.open(viewport);
    try {
      const webgl = await page.evaluate<boolean>(
        `!!document.createElement("canvas").getContext("webgl2")`,
      );
      if (!webgl) throw new Error(NO_WEBGL);
      await page.evaluate(loadThree(three));
      await page.evaluate(script);
    } catch (error) {
      await page.close();
      throw error;
    }
    return page;
  };
}
