// Hand-run only, by sheet-page.local.e2e.test.ts: a page script that drives the sheet page already
// in the window, lays its pictures over each other as the app does, and draws the same office in
// one pass beside it.
import { groundSpan } from "../client/scene/camera.js";
import { createOfficeStills } from "../client/scene/office-stills.web.js";
import { scenePalette } from "../client/scene/palette.js";
import { roomFootprint, type RobotPlan } from "../client/scene/scene-plan.js";
import {
  clipMotion,
  picturePixels,
  sheetFrame,
  spriteKey,
  spriteLook,
} from "../client/scene/sheet-plan.js";
import { isThreeModule } from "../client/scene/three-types.js";
import { createRenderPipeline } from "./pipeline.js";
import type { OfficeEvent } from "../shared/contracts.js";
import { THREE_GLOBAL } from "../shared/render.js";
import {
  SHEET_GLOBAL,
  type OfficeSheetGlobal,
  type Sheet,
  type SheetSize,
  type SheetTile,
  type SpritePicture,
} from "../shared/sheet.js";

export const PREVIEW_GLOBAL = "__officeSheetPreview";
/** Two pixels this far apart in any channel differ: more than JPEG and soft edges explain. */
const TOLERANCE = 40;

interface PreviewInput {
  colors: Parameters<OfficeSheetGlobal["start"]>[0]["colors"];
  size: SheetSize;
  event: OfficeEvent;
}

export interface PreviewResult {
  sheet: Sheet;
  composed: string;
  reference: string;
  difference: string;
  /** Pixels further apart than the tolerance, and how many there are in all. */
  differing: number;
  pixels: number;
  tiles: number;
  tileBytes: number;
  sprites: Record<string, { bytes: number; frames: number; columns: number }>;
}

const globals = globalThis as unknown as Record<string, unknown>;
const PNG = "data:image/png;base64,";

function loaded(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("A picture did not load")));
    image.src = uri;
  });
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("No 2D canvas");
  return { canvas, context };
}

type Canvas = ReturnType<typeof canvasOf>;
type Sprites = Map<string, { picture: SpritePicture; image: HTMLImageElement }>;

/** As the app lays them: backdrop tiles, robots far to near, overlay tiles. */
async function compose(
  page: OfficeSheetGlobal,
  sheet: Sheet,
  tiles: readonly SheetTile[],
): Promise<{ composed: Canvas; sprites: Sprites }> {
  const composed = canvasOf(sheet.width, sheet.height);
  for (const tile of tiles) {
    composed.context.drawImage(await loaded(`data:image/jpeg;base64,${tile.jpeg}`), tile.x, tile.y);
  }
  const sprites: Sprites = new Map();
  for (const robot of sheet.robots) {
    let sprite = sprites.get(robot.key);
    if (!sprite) {
      const picture = page.sprite(robot.key);
      if (picture === null) throw new Error(`No sprite for ${robot.key}`);
      sprite = { picture, image: await loaded(`${PNG}${picture.png}`) };
      sprites.set(robot.key, sprite);
    }
    const { frameWidth: width, frameHeight: height } = sprite.picture;
    // Frame 0 of every clip, as the reference draws.
    composed.context.drawImage(sprite.image, 0, 0, width, height, robot.x, robot.y, width, height);
  }
  for (const tile of tiles) {
    if (tile.overlay === null) continue;
    composed.context.drawImage(await loaded(`${PNG}${tile.overlay}`), tile.x, tile.y);
  }
  return { composed, sprites };
}

/** The same office in one draw, its robots as frame 0 of their sprites has them. */
function drawReference({ colors, size, event }: PreviewInput): Canvas {
  const three = globals[THREE_GLOBAL];
  if (!isThreeModule(three)) throw new Error("three.js is not loaded");
  const palette = scenePalette({ colors });
  const pipeline = createRenderPipeline(palette);
  pipeline.resize(size.width, size.height);
  const plan = pipeline.apply(event);
  if (plan === null) throw new Error("No plan");
  const frame = sheetFrame(groundSpan(plan.rooms.map(roomFootprint)), size, size.pixelRatio);
  const glCanvas = document.createElement("canvas");
  const stills = createOfficeStills({ three, canvas: glCanvas });
  stills.set(plan, palette, frame);
  stills.whole(
    plan.robots.map((robot) => {
      const look = spriteLook(spriteKey(robot));
      if (look === null) throw new Error("A key that cannot be read back");
      // At its own seat, in the stance the sprite's first frame has.
      const stance: RobotPlan = { ...robot, seatIndex: look.seatIndex };
      return { robot, motion: clipMotion(stance, 0) };
    }),
  );
  const { width, height } = picturePixels(frame);
  const reference = canvasOf(width, height);
  reference.context.drawImage(glCanvas, 0, 0);
  stills.dispose();
  return reference;
}

/** The reference in grey, and red where the two are further apart than the tolerance. */
function differenceOf(composed: Canvas, reference: Canvas): { marks: Canvas; differing: number } {
  const { width, height } = reference.canvas;
  const a = composed.context.getImageData(0, 0, width, height).data;
  const b = reference.context.getImageData(0, 0, width, height).data;
  const marks = canvasOf(width, height);
  const drawn = marks.context.createImageData(width, height);
  const at = (data: Uint8ClampedArray, index: number) => data[index] ?? 0;
  let differing = 0;
  for (let index = 0; index < a.length; index += 4) {
    const apart = Math.max(
      Math.abs(at(a, index) - at(b, index)),
      Math.abs(at(a, index + 1) - at(b, index + 1)),
      Math.abs(at(a, index + 2) - at(b, index + 2)),
    );
    const bad = apart > TOLERANCE;
    if (bad) differing += 1;
    const grey = (at(b, index) + at(b, index + 1) + at(b, index + 2)) / 6 + 127;
    drawn.data[index] = bad ? 255 : grey;
    drawn.data[index + 1] = bad ? 0 : grey;
    drawn.data[index + 2] = bad ? 0 : grey;
    drawn.data[index + 3] = 255;
  }
  marks.context.putImageData(drawn, 0, 0);
  return { marks, differing };
}

async function run(input: PreviewInput): Promise<PreviewResult> {
  const page = globals[SHEET_GLOBAL] as OfficeSheetGlobal;
  page.start({ colors: input.colors });
  page.size(input.size);
  page.state(input.event);
  const take = page.take();
  if (take.problem !== null || take.sheet === null) throw new Error(take.problem ?? "No sheet");
  const { sheet, tiles } = take;
  const { composed, sprites } = await compose(page, sheet, tiles);
  const reference = drawReference(input);
  const { marks, differing } = differenceOf(composed, reference);
  const cut = (canvas: HTMLCanvasElement) => canvas.toDataURL("image/png").slice(PNG.length);
  return {
    sheet,
    composed: cut(composed.canvas),
    reference: cut(reference.canvas),
    difference: cut(marks.canvas),
    differing,
    pixels: reference.canvas.width * reference.canvas.height,
    tiles: tiles.length,
    tileBytes: tiles.reduce((sum, tile) => sum + tile.jpeg.length + (tile.overlay?.length ?? 0), 0),
    sprites: Object.fromEntries(
      [...sprites].map(([key, { picture }]) => [
        key,
        { bytes: picture.png.length, frames: picture.frames, columns: picture.columns },
      ]),
    ),
  };
}

globals[PREVIEW_GLOBAL] = { run };
