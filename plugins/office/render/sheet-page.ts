// The sheet page: the office as still pictures and positions, drawn in the daemon's Chromium for
// a device that composes them itself. The daemon loads three.js into THREE_GLOBAL, runs this
// script, and then drives the page through SHEET_GLOBAL. Built for a browser by the daemon
// (bundleBrowserScript); never imported.
import { groundSpan } from "../client/scene/camera.js";
import { createOfficeStills, type OfficeStills } from "../client/scene/office-stills.web.js";
import { scenePalette, type ScenePalette } from "../client/scene/palette.js";
import {
  WAVE_MS,
  roomFootprint,
  type RobotPose,
  type ScenePlan,
} from "../client/scene/scene-plan.js";
import {
  CHEST_Y,
  SPRITE_CLIPS,
  buildSheet,
  clipMotion,
  picturePixels,
  pictureScale,
  sheetFrame,
  spriteFrame,
  spriteGrid,
  spriteLook,
  stillSignature,
  tileRects,
  type SheetFrame,
} from "../client/scene/sheet-plan.js";
import { isThreeModule } from "../client/scene/three-types.js";
import { THREE_GLOBAL } from "../shared/render.js";
import {
  BACKDROP_QUALITY,
  MAX_SPRITES,
  PLANE_KEY,
  SHEET_GLOBAL,
  type OfficeSheetGlobal,
  type SheetSize,
  type SheetTake,
  type SheetTile,
  type SpritePicture,
} from "../shared/sheet.js";
import { createRenderPipeline, type RenderPipeline } from "./pipeline.js";

const JPEG_PREFIX = "data:image/jpeg;base64,";
const PNG_PREFIX = "data:image/png;base64,";
const globals = globalThis as unknown as Record<string, unknown>;
/** Drawn with no office in it: a sprite has none around it. */
const NOTHING: ScenePlan = {
  rooms: [],
  robots: [],
  bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
  columns: 0,
  notes: [],
  mentions: [],
};

interface Running {
  stills: OfficeStills;
  pipeline: RenderPipeline;
  palette: ScenePalette;
  /** What the stills draw on. */
  canvas: HTMLCanvasElement;
  /** Where a part of that is copied to be read as a picture. */
  copy: HTMLCanvasElement;
}

let running: Running | null = null;
let plan: ScenePlan | null = null;
let viewer: SheetSize | null = null;
/** The backdrop that was drawn last, and what it showed. */
let drawn: {
  signature: string;
  version: number;
  tiles: number;
  /** Each room's name plate as it was drawn: the sheet says where a tap finds it. */
  plates: Map<string, { width: number; height: number }>;
} | null = null;
let changed = false;
/** Each robot's pose and when it took it, by this page's clock. */
const posed = new Map<string, { pose: RobotPose; at: number }>();
/** Sprites by key, for the scale they were drawn at. */
let sprites: { scale: number; byKey: Map<string, SpritePicture> } = { scale: 0, byKey: new Map() };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireRunning(): Running {
  if (running === null) throw new Error("The sheet page was not started");
  return running;
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("The sheet page has no 2D canvas");
  return context;
}

/** A part of what the stills drew, as base64: a JPEG, or a PNG that is null when it is clear. */
function copied(
  { canvas, copy }: Running,
  rect: { x: number; y: number; width: number; height: number },
  kind: "jpeg" | "png",
): string | null {
  copy.width = rect.width;
  copy.height = rect.height;
  const context = context2d(copy);
  context.clearRect(0, 0, rect.width, rect.height);
  context.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  if (kind === "jpeg") {
    return copy.toDataURL("image/jpeg", BACKDROP_QUALITY).slice(JPEG_PREFIX.length);
  }
  const pixels = context.getImageData(0, 0, rect.width, rect.height).data;
  let clear = true;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0) {
      clear = false;
      break;
    }
  }
  return clear ? null : copy.toDataURL("image/png").slice(PNG_PREFIX.length);
}

function frameNow(current: ScenePlan, size: SheetSize): SheetFrame {
  return sheetFrame(groundSpan(current.rooms.map(roomFootprint)), size, size.pixelRatio);
}

function drawTiles(run: Running, current: ScenePlan, frame: SheetFrame, version: number) {
  const { width, height } = picturePixels(frame);
  const rects = tileRects(width, height);
  run.stills.set(current, run.palette, frame);
  run.stills.backdrop();
  const jpegs = rects.map((rect) => copied(run, rect, "jpeg") ?? "");
  run.stills.overlay();
  return rects.map(
    (rect, index): SheetTile => ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      version,
      index,
      jpeg: jpegs[index] ?? "",
      overlay: copied(run, rect, "png"),
    }),
  );
}

function notePoses(next: ScenePlan): void {
  const now = performance.now();
  const present = new Set<string>();
  for (const robot of next.robots) {
    present.add(robot.agentId);
    if (posed.get(robot.agentId)?.pose !== robot.pose) {
      posed.set(robot.agentId, { pose: robot.pose, at: now });
    }
  }
  for (const agentId of posed.keys()) if (!present.has(agentId)) posed.delete(agentId);
}

function freshNow(): Set<string> {
  const now = performance.now();
  const fresh = new Set<string>();
  for (const [agentId, { at }] of posed) if (now - at < WAVE_MS) fresh.add(agentId);
  return fresh;
}

function take(): SheetTake {
  const run = requireRunning();
  if (!changed || plan === null || viewer === null)
    return { tiles: [], sheet: null, problem: null };
  changed = false;
  const frame = frameNow(plan, viewer);
  const signature = stillSignature(plan, frame);
  let tiles: SheetTile[] = [];
  if (drawn === null || drawn.signature !== signature) {
    const version = (drawn?.version ?? 0) + 1;
    tiles = drawTiles(run, plan, frame, version);
    drawn = { signature, version, tiles: tiles.length, plates: run.stills.plates() };
  }
  const sheet = buildSheet({
    plan,
    frame,
    version: drawn.version,
    tiles: drawn.tiles,
    fresh: freshNow(),
    plates: drawn.plates,
  });
  return { tiles, sheet, problem: null };
}

/** The frames of one sprite, each drawn by `frameAt`, in a grid. */
function gridOf(
  run: Running,
  clip: { frames: number; frameMs: number; loop: boolean },
  frame: SheetFrame,
  frameAt: (index: number) => void,
): SpritePicture {
  const scale = pictureScale(frame);
  const { columns, box, scale: drawnScale } = spriteGrid(clip.frames, scale);
  run.stills.set(NOTHING, run.palette, spriteFrame(box, drawnScale, frame.ratio));
  const grid = document.createElement("canvas");
  grid.width = columns * box.width;
  grid.height = Math.ceil(clip.frames / columns) * box.height;
  const context = context2d(grid);
  for (let index = 0; index < clip.frames; index += 1) {
    frameAt(index);
    const x = (index % columns) * box.width;
    const y = Math.floor(index / columns) * box.height;
    context.drawImage(run.canvas, x, y);
  }
  return {
    png: grid.toDataURL("image/png").slice(PNG_PREFIX.length),
    frames: clip.frames,
    columns,
    frameWidth: box.width,
    frameHeight: box.height,
    frameMs: clip.frameMs,
    loop: clip.loop,
    scale,
  };
}

function drawSprite(run: Running, key: string, frame: SheetFrame): SpritePicture | null {
  if (key === PLANE_KEY) {
    const still = { frames: 1, frameMs: 0, loop: false };
    // Where a robot's chest is in a frame: the app lays that point on the plane's path.
    return gridOf(run, still, frame, () => run.stills.plane({ x: 0, z: 0 }, CHEST_Y));
  }
  const look = spriteLook(key);
  if (look === null) return null;
  return gridOf(run, SPRITE_CLIPS[look.pose], frame, (index) =>
    run.stills.robot(look, clipMotion(look, index)),
  );
}

function sprite(key: string): SpritePicture | null {
  const run = requireRunning();
  if (plan === null || viewer === null) return null;
  const frame = frameNow(plan, viewer);
  const scale = pictureScale(frame);
  if (sprites.scale !== scale) sprites = { scale, byKey: new Map() };
  const kept = sprites.byKey.get(key);
  if (kept) return kept;
  const picture = drawSprite(run, key, frame);
  if (picture === null) return null;
  if (sprites.byKey.size >= MAX_SPRITES) {
    const oldest = sprites.byKey.keys().next();
    if (!oldest.done) sprites.byKey.delete(oldest.value);
  }
  sprites.byKey.set(key, picture);
  return picture;
}

const page: OfficeSheetGlobal = {
  start({ colors }) {
    if (running !== null) throw new Error("The sheet page was already started");
    const three = globals[THREE_GLOBAL];
    if (!isThreeModule(three)) throw new Error("three.js is not loaded in the sheet page");
    const palette = scenePalette({ colors });
    const canvas = document.createElement("canvas");
    running = {
      stills: createOfficeStills({ three, canvas }),
      pipeline: createRenderPipeline(palette),
      palette,
      canvas,
      copy: document.createElement("canvas"),
    };
  },
  size(size) {
    const { pipeline } = requireRunning();
    viewer = size;
    const next = pipeline.resize(size.width, size.height);
    if (next !== null) {
      plan = next;
      notePoses(next);
    }
    changed = true;
  },
  state(event) {
    const { pipeline } = requireRunning();
    const next = pipeline.apply(event);
    if (next === null) return;
    plan = next;
    notePoses(next);
    changed = true;
  },
  take() {
    try {
      return take();
    } catch (error) {
      return { tiles: [], sheet: null, problem: messageOf(error) };
    }
  },
  sprite,
};

globals[SHEET_GLOBAL] = page;
