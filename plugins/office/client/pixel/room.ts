// What stands still in the 2D office: the wall, the rug and the furniture nobody moves.
import type { Art, Tones } from "./art.js";
import { SIZE, type FloorPlan } from "./floor-plan.js";
import type { Sprite, SpriteRect } from "./sprite.js";

export interface Placed {
  key: string;
  sprite: Sprite;
  x: number;
  y: number;
}

const WALL_TOP = 4;
const BASEBOARD = 2;

const BOARD_GAP = 8;

/** Seams between the floor's boards: what makes a flat colour a floor. */
function floorLines(plan: FloorPlan, tones: Tones): SpriteRect[] {
  const lines: SpriteRect[] = [];
  for (let y = plan.wallHeight + BOARD_GAP; y < plan.height; y += BOARD_GAP) {
    lines.push({ x: 0, y, w: plan.width, h: 1, color: tones.floorLine });
  }
  return lines;
}

/** The room's flat surfaces, back to front: the wall, its shadow on the floor and the rug. */
export function roomRects(plan: FloorPlan, tones: Tones): SpriteRect[] {
  const { width, wallHeight } = plan;
  const ground = plan.loungeY + 30;
  const rugLeft = (plan.sofa ?? plan.plant).x - 2;
  const lastSpot = plan.spots.coffee.xs.at(-1) ?? plan.coffee.x;
  return [
    { x: 0, y: 0, w: width, h: WALL_TOP, color: tones.wallTop },
    { x: 0, y: WALL_TOP, w: width, h: wallHeight - WALL_TOP - BASEBOARD, color: tones.wall },
    { x: 0, y: wallHeight - BASEBOARD, w: width, h: BASEBOARD, color: tones.baseboard },
    { x: 0, y: wallHeight, w: width, h: 1, color: tones.shadow },
    ...floorLines(plan, tones),
    {
      x: rugLeft,
      y: ground - 8,
      w: lastSpot + SIZE.person.w + 2 - rugLeft,
      h: 15,
      color: tones.rug,
    },
  ];
}

/** The furniture that never changes. The racks blink and the rocket flies, so they are not here. */
export function roomFurniture(plan: FloorPlan, art: Art): Placed[] {
  return [
    ...plan.shelves.map((at, index) => ({ key: `shelves-${index}`, sprite: art.shelves, ...at })),
    { key: "board", sprite: art.board, ...plan.board },
    ...(plan.sofa === null ? [] : [{ key: "sofa", sprite: art.sofa, ...plan.sofa }]),
    { key: "plant", sprite: art.plant, ...plan.plant },
    { key: "coffee", sprite: art.coffee, ...plan.coffee },
  ];
}
