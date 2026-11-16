// Where everything stands in the 2D office, in art pixels: one is `scale` screen pixels. The room
// is as wide as the surface and as long as its teams need, so it scrolls down and never sideways.

export interface Point {
  x: number;
  y: number;
}

/** Where a person goes away from the desk: to work, or for a rest in the lounge. */
export type PlaceKind = "library" | "board" | "racks" | "coffee" | "pad" | "sofa" | "plant";

export interface PlanTeam {
  id: string;
  name: string;
  /** The agents with a desk, in the order they sit. */
  members: readonly string[];
}

export interface PlanDesk {
  agentId: string;
  teamId: string;
  /** The desk's top left corner. */
  x: number;
  y: number;
  /** A seated person's top left corner. */
  seat: Point;
  /** The top of a person who walks behind this desk's chair. */
  aisleY: number;
}

/** A team's name plate over its desks. */
export interface PlanTeamPlate {
  id: string;
  name: string;
  count: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The places people stand at a place: the first ones side by side, the rest a step in front. */
export interface PlanSpots {
  y: number;
  xs: readonly number[];
}

export interface FloorPlan {
  scale: number;
  width: number;
  height: number;
  /** Where the wall ends and the floor starts. */
  wallHeight: number;
  /** The left of a person in the lane that joins every aisle with the wall and the lounge. */
  laneX: number;
  shelves: readonly Point[];
  board: Point;
  racks: readonly Point[];
  /** Null in a room too narrow for one. */
  sofa: Point | null;
  plant: Point;
  coffee: Point;
  /** The janitor's cart, and where the janitor stands beside it. */
  cart: Point;
  janitor: Point;
  rocket: Point;
  /** The lounge's top: the floor below the last desks. */
  loungeY: number;
  plates: readonly PlanTeamPlate[];
  desks: readonly PlanDesk[];
  /** A name tag's height under a desk. */
  tagHeight: number;
  spots: Readonly<Record<PlaceKind, PlanSpots>>;
}

/** Sizes of the pictures in art.ts that the plan places. */
export const SIZE = {
  person: { w: 12, h: 16 },
  seated: { w: 12, h: 12 },
  desk: { w: 30, h: 18 },
  shelves: { w: 60, h: 26 },
  board: { w: 44, h: 20 },
  rack: { w: 14, h: 26 },
  sofa: { w: 30, h: 14 },
  coffee: { w: 12, h: 18 },
  plant: { w: 10, h: 16 },
  cart: { w: 12, h: 16 },
  rocket: { w: 14, h: 26 },
  bubble: { w: 12, h: 14 },
} as const;

/** A desk and the room at its sides. */
export const SLOT = 40;
/** Desks on one floor. Past this the room is a long scroll and a phone has thousands of views. */
export const FLOOR_DESKS = 40;

const SIDE = 6;
const WALL = 30;
const CORRIDOR = 24;
const LANE = 14;
/** How far under its desk's top a seated person starts. */
const SEAT_DROP = 12;
/** The floor behind a row of chairs: a person and a pixel of air over and under. */
const AISLE = 18;
const TEAM_GAP = 4;
const LOUNGE = 40;
/** Screen pixels of text: a plate's one line, and a name tag's colour bar over two lines. */
const PLATE_PX = 24;
const TAG_PX = 32;
/** People side by side stand this far apart; one more lap stands this far in front. */
const SPOT_STEP = 13;
const LAP = { x: 5, y: 3 };

/**
 * Screen pixels per art pixel, a whole number so every edge is sharp. A phone gets 2; a wider
 * surface as many as keep the room about 340 art pixels across, up to 4.
 */
export function scaleFor(widthPx: number): number {
  if (widthPx < 300) return 1;
  return Math.min(4, Math.max(2, Math.round(widthPx / 340)));
}

function shelfUnits(width: number): number {
  if (width >= 500) return 3;
  return width >= 290 ? 2 : 1;
}

/** The plan of a room `widthPx` screen pixels wide for these teams. Teams without members get no desks. */
export function planFloor(teams: readonly PlanTeam[], widthPx: number): FloorPlan {
  const scale = scaleFor(widthPx);
  const width = Math.max(150, Math.floor(widthPx / scale));
  const plateHeight = Math.ceil(PLATE_PX / scale);
  const tagHeight = Math.ceil(TAG_PX / scale);
  const laneX = SIDE + 1;
  const wallY = WALL + 4;

  const shelves = Array.from({ length: shelfUnits(width) }, (_, unit) => ({
    x: SIDE + LANE + unit * (SIZE.shelves.w + 2),
    y: WALL - SIZE.shelves.h,
  }));
  const rackCount = width >= 180 ? 2 : 1;
  const racksLeft = width - SIDE - rackCount * SIZE.rack.w - (rackCount - 1) * 2;
  const racks = Array.from({ length: rackCount }, (_, index) => ({
    x: racksLeft + index * (SIZE.rack.w + 2),
    y: WALL - SIZE.rack.h,
  }));
  const shelvesRight = SIDE + LANE + shelves.length * (SIZE.shelves.w + 2) - 2;
  // In the middle of the wall where the shelves leave it free, else between them and the racks.
  const between = shelvesRight + Math.floor((racksLeft - shelvesRight - SIZE.board.w) / 2);
  const middle = Math.floor((width - SIZE.board.w) / 2);
  const board = {
    x: middle >= shelvesRight + 6 ? middle : between,
    y: WALL - SIZE.board.h - 4,
  };

  const room = width - 2 * SIDE - LANE;
  const perRow = Math.max(1, Math.floor(room / SLOT));
  const desksLeft = SIDE + LANE + Math.floor((room - perRow * SLOT) / 2);
  const pitch = SEAT_DROP + SIZE.seated.h + tagHeight + AISLE;
  const plates: PlanTeamPlate[] = [];
  const desks: PlanDesk[] = [];
  let top = WALL + CORRIDOR + 2;
  for (const team of teams) {
    if (team.members.length === 0) continue;
    plates.push({
      id: team.id,
      name: team.name,
      count: team.members.length,
      x: desksLeft,
      y: top,
      width: Math.min(perRow, team.members.length) * SLOT,
      height: plateHeight,
    });
    const rowsTop = top + plateHeight + 2;
    team.members.forEach((agentId, index) => {
      const x = desksLeft + (index % perRow) * SLOT + (SLOT - SIZE.desk.w) / 2;
      const y = rowsTop + Math.floor(index / perRow) * pitch;
      const seatY = y + SEAT_DROP;
      desks.push({
        agentId,
        teamId: team.id,
        x,
        y,
        seat: { x: x + (SIZE.desk.w - SIZE.seated.w) / 2, y: seatY },
        aisleY: seatY + SIZE.seated.h + tagHeight + 1,
      });
    });
    top = rowsTop + Math.ceil(team.members.length / perRow) * pitch + TEAM_GAP;
  }

  const loungeY = top;
  const ground = loungeY + 30;
  const sofa = width >= 180 ? { x: SIDE + LANE + 2, y: ground - SIZE.sofa.h } : null;
  const plantX = sofa === null ? SIDE + LANE + 2 : sofa.x + SIZE.sofa.w + 3;
  const plant = { x: plantX, y: ground - SIZE.plant.h };
  const coffee = { x: plant.x + SIZE.plant.w + 4, y: ground - SIZE.coffee.h };
  const rocket = { x: width - SIDE - SIZE.rocket.w - 4, y: ground - SIZE.rocket.h };
  const loungeSpotY = ground + 4 - SIZE.person.h;
  // Left to right: the coffee machine and who drinks there, the cart and the janitor, who waits
  // at the pad, the rocket. A narrow room has one spot at the machine, and at the pad as many
  // as fit.
  const coffeeSpots = (width >= 180 ? [0, 1] : [0]).map(
    (index) => coffee.x + SIZE.coffee.w + 3 + index * SPOT_STEP,
  );
  const cart = {
    x: (coffeeSpots.at(-1) ?? coffee.x) + SIZE.person.w + 3,
    y: ground - SIZE.cart.h,
  };
  const janitor = { x: cart.x + SIZE.cart.w - 1, y: loungeSpotY };
  const padSpots = [0, 1]
    .map((index) => rocket.x - 16 - index * SPOT_STEP)
    .filter((x, index) => index === 0 || x > janitor.x + SIZE.person.w);

  return {
    scale,
    width,
    height: loungeY + LOUNGE + SIDE,
    wallHeight: WALL,
    laneX,
    shelves,
    board,
    racks,
    sofa,
    plant,
    coffee,
    cart,
    janitor,
    rocket,
    loungeY,
    plates,
    desks,
    tagHeight,
    spots: {
      library: {
        y: wallY,
        xs: shelves.flatMap((unit) => [6, 20, 34, 48].map((offset) => unit.x + offset)),
      },
      board: { y: wallY, xs: [2, 16, 30].map((offset) => board.x + offset) },
      racks: { y: wallY, xs: racks.map((rack) => rack.x + 1) },
      coffee: { y: loungeSpotY, xs: coffeeSpots },
      pad: { y: loungeSpotY, xs: padSpots },
      // On the sofa's two cushions, the feet on its front edge; a room without a sofa has none.
      sofa: sofa === null ? { y: 0, xs: [] } : { y: sofa.y - 4, xs: [sofa.x + 3, sofa.x + 15] },
      // In front of the plant, looking at it.
      plant: { y: loungeSpotY, xs: [plant.x - 1] },
    },
  };
}

/** Where the person `index` in line at a place stands. */
export function spotAt(spots: PlanSpots, index: number): Point {
  const lap = Math.floor(index / spots.xs.length);
  const x = spots.xs[index % spots.xs.length] ?? 0;
  return { x: x + lap * LAP.x, y: spots.y + lap * LAP.y };
}

/**
 * The corners of a walk from one point to another. Every aisle, the floor in front of the wall
 * and the lounge are lines across the room, and the lane at the left joins them: a walk leaves
 * its line for the lane, goes up or down it and turns in again. Two points on one line are a
 * straight walk. The start is not in the list; the last corner is `to`.
 */
export function routeBetween(from: Point, to: Point, laneX: number): Point[] {
  if (from.x === to.x && from.y === to.y) return [];
  if (from.y === to.y) return [to];
  const corners: Point[] = [];
  if (from.x !== laneX) corners.push({ x: laneX, y: from.y });
  if (to.x !== laneX) corners.push({ x: laneX, y: to.y });
  corners.push(to);
  return corners;
}

/** Art pixels a walk over these corners covers. */
export function routeLength(from: Point, corners: readonly Point[]): number {
  let length = 0;
  let at = from;
  for (const corner of corners) {
    length += Math.abs(corner.x - at.x) + Math.abs(corner.y - at.y);
    at = corner;
  }
  return length;
}
