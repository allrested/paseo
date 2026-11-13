// What the daemon and the render page say to each other. The page is a script in the daemon's
// Chromium (render/page.ts); the daemon reaches it by evaluating calls on one global.
import type { PluginTheme } from "@getpaseo/plugin";
import type { OfficeEvent } from "./contracts.js";

/** Where the daemon puts the three.js module namespace before the page script runs. */
export const THREE_GLOBAL = "__officeThree";
/** The page's one global, an `OfficeRenderGlobal`. */
export const RENDER_GLOBAL = "__officeRender";
export const PICTURE_QUALITY = 0.6;

export type RenderPageEvent =
  | { type: "agent"; agentId: string }
  | { type: "board"; roomId: string }
  | { type: "problem"; message: string };

export interface RenderPicture {
  /** Base64 JPEG, without the data URI prefix. */
  jpeg: string;
  /** Device pixels. */
  width: number;
  height: number;
}

/** What happened in the page since the last `take()`. */
export interface RenderTake {
  /** Null when no frame was drawn since the last call. */
  picture: RenderPicture | null;
  events: RenderPageEvent[];
}

export type RenderFocus = { roomId: string } | { agentId: string };

export interface RenderStart {
  /** The viewer's theme: the scene draws in it. */
  colors: PluginTheme["colors"];
  coarsePointer: boolean;
}

export interface OfficeRenderGlobal {
  start(input: RenderStart): void;
  state(event: OfficeEvent): void;
  focus(target: RenderFocus): void;
  take(): RenderTake;
}
