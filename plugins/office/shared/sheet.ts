// The office as pictures and positions, for a device that composes it itself: what the sheet page
// (render/sheet-page.ts) gives the daemon, and the daemon the app. Types and plain constants
// only: the page script imports this file, so it must not pull in zod.
import type { PluginTheme } from "@getpaseo/plugin";
import type { OfficeEvent } from "./contracts.js";

/** The page's one global, an `OfficeSheetGlobal`. */
export const SHEET_GLOBAL = "__officeSheet";
/** A tile's longest side. Android's image loader shrinks a picture over 2048 pixels. */
export const TILE_SIDE = 1024;
/** A backdrop is drawn less sharp to stay under this, but never under one pixel per point. */
export const MAX_BACKDROP_PIXELS = 4_000_000;
/** The widest grid of sprite frames. */
export const MAX_SPRITE_WIDTH = 1024;
/** Sprites a page keeps; the oldest goes first. */
export const MAX_SPRITES = 200;
/** The sprite key of the paper plane. */
export const PLANE_KEY = "plane";
export const BACKDROP_QUALITY = 0.85;

export interface SheetPoint {
  x: number;
  y: number;
}

export interface SheetRect extends SheetPoint {
  width: number;
  height: number;
}

export interface SheetRobot {
  agentId: string;
  /** Names the sprite to show: `office.sheet.sprite.request` returns it. */
  key: string;
  /** The top left corner of its frame. */
  x: number;
  y: number;
  /** The frame a looping sprite starts at, so neighbours do not move as one. */
  phase: number;
  /** It has only just arrived: shown with a fade. */
  joining: boolean;
  /** Its pose began less than a wave ago: a once-only sprite plays for a robot not seen before. */
  fresh: boolean;
}

export interface SheetRoom {
  roomId: string;
  /** What the room covers on the picture, walls included: what a focus on it shows. */
  area: SheetRect;
  board: SheetRect;
  plate: SheetRect;
}

/** A note on a desk: a tap on it opens its room's board. */
export interface SheetNote {
  roomId: string;
  rect: SheetRect;
}

export interface SheetMention {
  postId: string;
  from: SheetPoint;
  to: SheetPoint;
}

/** Where everything is, in picture pixels from the backdrop's top left corner. */
export interface Sheet {
  /** The backdrop these positions belong to, and how many tiles it has. */
  version: number;
  tiles: number;
  width: number;
  height: number;
  /** Picture pixels per screen point: the picture is shown `width / ratio` points wide. */
  ratio: number;
  /** Picture pixels per world unit. Sprites are drawn for one scale. */
  scale: number;
  /** A sprite's frame, and where the robot's chest is in it: what a tap is measured from. */
  frame: { width: number; height: number; chest: SheetPoint };
  /** Far to near: the order to draw them in. */
  robots: SheetRobot[];
  rooms: SheetRoom[];
  notes: SheetNote[];
  mentions: SheetMention[];
}

export interface SheetTile extends SheetRect {
  version: number;
  index: number;
  /** Base64, without the data URI prefix. */
  jpeg: string;
  /** What stands in front of robots there, as a base64 PNG; null when nothing does. */
  overlay: string | null;
}

export interface SpritePicture {
  /** Base64 PNG: `frames` frames in rows of `columns`, each `frameWidth` x `frameHeight`. */
  png: string;
  frames: number;
  columns: number;
  frameWidth: number;
  frameHeight: number;
  /** How long each frame shows. 0 for a still. */
  frameMs: number;
  /** Looping, or played once and held on its last frame. */
  loop: boolean;
  /** The `Sheet.scale` it was drawn for. */
  scale: number;
}

/** What changed in the page since the last `take()`. */
export interface SheetTake {
  /** The tiles of a new backdrop; empty when the still parts are as they were. */
  tiles: SheetTile[];
  sheet: Sheet | null;
  problem: string | null;
}

export interface SheetSize {
  /** Screen points. */
  width: number;
  height: number;
  pixelRatio: number;
}

export interface OfficeSheetGlobal {
  start(input: { colors: PluginTheme["colors"] }): void;
  size(size: SheetSize): void;
  state(event: OfficeEvent): void;
  take(): SheetTake;
  /** Null for a key the page cannot read. */
  sprite(key: string): SpritePicture | null;
}
