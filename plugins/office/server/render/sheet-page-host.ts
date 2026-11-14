// Opens a sheet page in the daemon's Chromium and speaks to it.
import type { PluginTheme } from "@getpaseo/plugin";
import type { OfficeEvent } from "../../shared/contracts.js";
import {
  SHEET_GLOBAL,
  type SheetSize,
  type SheetTake,
  type SpritePicture,
} from "../../shared/sheet.js";
import { scriptedPages, type RenderPageHostDeps } from "./page-host.js";

/** The page draws on canvases of its own size; its window shows nothing. */
const WINDOW = { width: 64, height: 64, deviceScaleFactor: 1 };

export interface SheetPage {
  size(size: SheetSize): Promise<void>;
  state(event: OfficeEvent): Promise<void>;
  take(): Promise<SheetTake>;
  sprite(key: string): Promise<SpritePicture | null>;
  close(): Promise<void>;
  onClosed(listener: () => void): () => void;
}

export interface SheetPageHost {
  /** Opens a page, loads three.js and the page script, and starts it in the viewer's theme. */
  open(input: { colors: PluginTheme["colors"] }): Promise<SheetPage>;
}

const call = (method: string, argument?: unknown) =>
  `globalThis[${JSON.stringify(SHEET_GLOBAL)}].${method}(${argument === undefined ? "" : JSON.stringify(argument)})`;

/** `deps.pageEntry` is the path of render/sheet-page.ts. */
export function createSheetPageHost(deps: RenderPageHostDeps): SheetPageHost {
  const openPage = scriptedPages(deps);

  return {
    async open({ colors }) {
      const page = await openPage(WINDOW);
      try {
        await page.evaluate(call("start", { colors }));
      } catch (error) {
        await page.close();
        throw error;
      }
      return {
        size: async (size) => {
          await page.evaluate(call("size", size));
        },
        state: async (event) => {
          await page.evaluate(call("state", event));
        },
        take: () => page.evaluate<SheetTake>(call("take")),
        sprite: (key) => page.evaluate<SpritePicture | null>(call("sprite", key)),
        close: () => page.close(),
        onClosed: (listener) => page.onClosed(listener),
      };
    },
  };
}
