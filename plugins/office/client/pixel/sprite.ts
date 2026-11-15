// Pixel art from React Native views. The plugin bundle is evaluated as it is on every platform,
// so there is no canvas and no image to draw into: a sprite is a grid of palette letters, and
// its pixels are merged into as few rectangles as a row-by-row pass finds. One rectangle is one
// view. A 12 by 16 person comes out at about 25.

/** A rectangle of one colour, in art pixels from the sprite's top left corner. */
export interface SpriteRect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface Sprite {
  /** Art pixels. */
  width: number;
  height: number;
  rects: readonly SpriteRect[];
}

/** The letter of a pixel that shows what is under it. */
export const CLEAR = ".";

interface Run {
  x: number;
  w: number;
  letter: string;
}

function runsOf(row: string): Run[] {
  const runs: Run[] = [];
  let start = 0;
  for (let x = 1; x <= row.length; x += 1) {
    if (x < row.length && row[x] === row[start]) continue;
    const letter = row[start] ?? CLEAR;
    if (letter !== CLEAR) runs.push({ x: start, w: x - start, letter });
    start = x;
  }
  return runs;
}

/**
 * The grid as rectangles: each row's runs of one letter, and a run that repeats in the row below
 * grows down instead of starting anew. Every row must be as long as the first, and every letter
 * but the clear one must be in the palette; a grid that breaks either is a mistake in the art,
 * and throws when the module loads, where a test sees it.
 */
export function compileSprite(grid: readonly string[], palette: Readonly<Record<string, string>>) {
  const width = grid[0]?.length ?? 0;
  const rects: SpriteRect[] = [];
  // The rectangles that end in the row above, by where they start and what they are.
  let open = new Map<string, SpriteRect>();
  grid.forEach((row, y) => {
    if (row.length !== width)
      throw new Error(`Sprite row ${y} is ${row.length} wide, not ${width}`);
    const next = new Map<string, SpriteRect>();
    for (const run of runsOf(row)) {
      const color = palette[run.letter];
      if (color === undefined) throw new Error(`Sprite letter "${run.letter}" has no colour`);
      const key = `${run.x}:${run.w}:${run.letter}`;
      const above = open.get(key);
      if (above) {
        above.h += 1;
        next.set(key, above);
      } else {
        const rect = { x: run.x, y, w: run.w, h: 1, color };
        rects.push(rect);
        next.set(key, rect);
      }
    }
    open = next;
  });
  return { width, height: grid.length, rects } satisfies Sprite;
}
