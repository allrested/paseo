import { isWorldApi, type WorldApi } from "./world-api.js";

// Web only. world-view.tsx calls this from an effect, and the surface renders that view only in
// a browser with WebGL2. Nothing here touches the DOM when the module loads: the plugin's client
// is bundled for every platform.

export interface WorldFrame {
  /** The page's API once its script ran; rejects when the frame or the script failed. */
  api: Promise<WorldApi>;
  /** Stops the page and takes the frame out; safe before `api` settles. */
  dispose(): void;
}

export interface WorldFrameInput {
  container: HTMLElement;
  script: string;
  /** What a screen reader calls the frame. */
  title: string;
}

// Standards mode: without the doctype the page's `height: 100%` rules do not hold.
const PAGE = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
const FRAME_STYLE =
  "position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:transparent";

/**
 * Gives the keyboard back to Paseo's page. A press inside the frame takes it, and Paseo's
 * shortcuts and the Escape of its sheets are heard only in Paseo's own page.
 */
export function focusApp(): void {
  window.focus();
}

/**
 * Opens a page of its own inside `container` and runs the office's script in it. The scene is
 * one app per page: module state, a stylesheet for `html` and `body`, listeners on its window.
 * A frame keeps all of that out of Paseo's page, and taking the frame out ends it.
 */
export function openWorldFrame({ container, script, title }: WorldFrameInput): WorldFrame {
  const element = document.createElement("iframe");
  element.title = title;
  element.srcdoc = PAGE;
  // The bar's Full screen button calls requestFullscreen on the page's own root; without this the
  // browser refuses it for a frame.
  element.setAttribute("allow", "fullscreen");
  element.style.cssText = FRAME_STYLE;
  let loaded: WorldApi | null = null;
  const api = new Promise<WorldApi>((resolve, reject) => {
    element.addEventListener(
      "load",
      () => {
        const page = element.contentWindow;
        const doc = element.contentDocument;
        if (page === null || doc === null) {
          reject(new Error("The office's frame did not open"));
          return;
        }
        // A script that throws while it is evaluated reports to its window, not to the caller.
        let thrown: string | null = null;
        page.addEventListener("error", (event) => {
          thrown ??= event.message;
        });
        const tag = doc.createElement("script");
        tag.textContent = script;
        doc.head.append(tag);
        const world: unknown = Reflect.get(page, "PaseoOfficeWorld");
        if (!isWorldApi(world)) {
          reject(new Error(thrown ?? "Unexpected office build"));
          return;
        }
        // A press on the scene itself hands the keyboard back; one on a control of the frame
        // (a chip, the place card) leaves it there for that control.
        doc.addEventListener("pointerup", () => {
          if (doc.activeElement === null || doc.activeElement === doc.body) focusApp();
        });
        loaded = world;
        resolve(world);
      },
      { once: true },
    );
  });
  container.append(element);
  return {
    api,
    dispose() {
      loaded?.stop();
      element.remove();
    },
  };
}
