import { LOBBY } from "../shared/contracts.js";
import type { OfficeModel, OfficeRoom, OfficeRow } from "./model.js";

export const DESKS_PER_ROOM = 24;
export const CELL_COLUMNS = 4;
export const CELL_ROWS = 3;
export const CELL_SIZE = 2.5;
export const ROOM_WIDTH = 12;
/** A room with every row of desks; one with fewer rows is less deep (`roomDepth`). */
export const ROOM_DEPTH = 11;
export const ROOM_PITCH_X = 15;
/** Clear ground between a room and the next one in its column. */
export const ROOM_GAP = 3;
export const WALL_HEIGHT = 1.2;
export const DOOR_WIDTH = 2;
/**
 * The camera looks at the office from this far round to the right, in radians (scene/camera.ts).
 * The rooms keep their walls square to the world, and their places are dealt along the camera's
 * own directions, so on screen a column of rooms runs straight down and the columns start level.
 * Seen from above, the places are a grid turned by this angle.
 */
export const VIEW_TURN = (26 * Math.PI) / 180;
const TURN_TAN = Math.tan(VIEW_TURN);
/** From the back wall to the first row of desks: the whiteboard's strip and room to walk. */
const BACK_STRIP = 2.5;
/** From the last row of desks to the front wall. */
const FRONT_STRIP = 1;
const MAIN_SEAT_OFFSET_X = -0.55;
const SIDE_SEAT_OFFSET_X = 0.65;
const BOUNDS_MARGIN = 2;
/** A view at least this many times wider than tall gets a third column of rooms. */
const VERY_WIDE = 2.8;
/** CSS pixels a column of rooms needs for its robots to be legible. */
const COLUMN_MIN_PX = 340;
/** The columns `layoutOffice` deals for when it is given no usable count: a wide view's. */
const WIDE_COLUMNS = 2;

export interface Point {
  x: number;
  z: number;
}

/** A room's place: `gx` is its column, `gz` its place in the column, counted from the back. */
export interface GridCell {
  gx: number;
  gz: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface SeatSlot extends Point {
  agentId: string;
  roomId: string;
  /** 0-23: even indexes are main seats, odd ones the side seat of the same cell. */
  index: number;
  side: boolean;
}

/** What places a seat: the middle of the room's floor and how deep the room is. */
export interface RoomBox {
  center: Point;
  depth: number;
}

export interface RoomLayout extends RoomBox {
  roomId: string;
  cell: GridCell;
  /** Rows of desks: what the agents need, at least one, and never fewer than the room had. */
  rows: number;
  seats: SeatSlot[];
  /** Agents without a desk, drawn as "+N". */
  overflow: number;
  board: Point;
  door: Point;
  label: Point;
}

export interface OfficeLayout {
  rooms: RoomLayout[];
  roomById: ReadonlyMap<string, RoomLayout>;
  seatOf: ReadonlyMap<string, SeatSlot>;
  bounds: Bounds;
  /** The column count the rooms were dealt for. */
  columns: number;
}

/**
 * What the next layout keeps: each room's place and rows, and each agent's seat. Rooms missing
 * from a snapshot are kept too, so a room that comes back returns to its place. In memory a room's
 * `gz` counts the missing rooms in front of it; in the layout the rooms behind a gap move up.
 */
export interface LayoutMemory {
  roomCells: ReadonlyMap<string, GridCell>;
  seats: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** The most rows each room has had. A room does not shrink, so its neighbours move once. */
  rows: ReadonlyMap<string, number>;
  /** The column count the places were dealt for. */
  columns?: number;
}

export const EMPTY_LAYOUT_MEMORY: LayoutMemory = {
  roomCells: new Map(),
  seats: new Map(),
  rows: new Map(),
};

/** From the back wall to the front wall of a room with `rows` rows of desks. */
export function roomDepth(rows: number): number {
  return BACK_STRIP + rows * CELL_SIZE + FRONT_STRIP;
}

/**
 * How many columns of rooms a view of this size gets. A column is a stack of rooms, one behind
 * the other. A view taller than wide gets one, so a phone shows each room at the full width of
 * its screen; a wider one gets two, a very wide one three, and never more than its width has
 * room for at a legible size.
 *
 * A 0 x 0 size is no view at all: a hidden tab (`display: none`) measures 0 x 0. A caller must
 * not pass it to decide the columns. While its container is 0 x 0 it keeps the last count and
 * does not lay the office out again, or the rooms are dealt anew and framed anew on every tab
 * switch.
 *
 * This is the count for the view's shape alone, the fewest it gets. A large office gets more,
 * up to `columnsFitting` (scene/grid.ts).
 */
export function columnsFor(viewport: { width: number; height: number }): number {
  const { width, height } = viewport;
  if (!(width > 0) || !(height > 0)) return 1;
  if (width < height) return 1;
  return Math.min(columnsFitting(viewport), width < height * VERY_WIDE ? 2 : 3);
}

/** The most columns of rooms a view this wide has room for at a legible size, at least one. */
export function columnsFitting(viewport: { width: number }): number {
  if (!(viewport.width > 0)) return 1;
  return Math.max(1, Math.floor(viewport.width / COLUMN_MIN_PX));
}

/** Column indexes from the middle outwards, the left one first of two equally near. */
function columnsFromMiddle(columns: number): number[] {
  const middle = (columns - 1) / 2;
  return Array.from({ length: columns }, (_, index) => index).sort(
    (left, right) => Math.abs(left - middle) - Math.abs(right - middle) || left - right,
  );
}

interface Sized {
  roomId: string;
  depth: number;
}

/**
 * Deals the rooms into columns. A room that has a place keeps its column and its order in it.
 * The others go one by one to the back of the column that is shortest so far, the middle column
 * first of equals: the lobby first, then, with more than one column, the deepest room first, so
 * the columns end near the same line. In one column the model's order stands.
 */
function dealRooms(
  rooms: readonly Sized[],
  previous: ReadonlyMap<string, GridCell>,
  columns: number,
): Map<string, GridCell> {
  const stacks: Sized[][] = Array.from({ length: columns }, () => []);
  const kept: { room: Sized; cell: GridCell }[] = [];
  const pending: Sized[] = [];
  for (const room of rooms) {
    const cell = previous.get(room.roomId);
    if (cell && cell.gx < columns) kept.push({ room, cell });
    else pending.push(room);
  }
  kept.sort((left, right) => left.cell.gz - right.cell.gz);
  for (const { room, cell } of kept) stacks[cell.gx]?.push(room);
  const rank = (room: Sized) => (room.roomId === LOBBY ? Infinity : room.depth);
  if (columns > 1) pending.sort((left, right) => rank(right) - rank(left));
  const order = columnsFromMiddle(columns);
  const reach = (stack: readonly Sized[]) =>
    stack.reduce((sum, room) => sum + room.depth + ROOM_GAP, 0);
  for (const room of pending) {
    let shortest = order[0] ?? 0;
    for (const column of order) {
      if (reach(stacks[column] ?? []) < reach(stacks[shortest] ?? [])) shortest = column;
    }
    stacks[shortest]?.push(room);
  }
  const cells = new Map<string, GridCell>();
  stacks.forEach((stack, gx) => {
    stack.forEach((room, gz) => cells.set(room.roomId, { gx, gz }));
  });
  return cells;
}

/**
 * The middle of each room's floor: column by column, each room behind the last one. A room hangs
 * from the middle of its back wall, which stays where it is when the room grows by a row. Going
 * down a column the rooms step to the right, and each column starts further back than the one
 * to its left: both by the tangent of the view's turn, which is what keeps them upright and
 * level on screen.
 */
function roomCenters(
  rooms: readonly Sized[],
  cells: ReadonlyMap<string, GridCell>,
): Map<string, Point> {
  const ordered = rooms
    .map((room) => ({ room, cell: cells.get(room.roomId) }))
    .sort((left, right) => (left.cell?.gz ?? 0) - (right.cell?.gz ?? 0));
  const backs = new Map<number, number>();
  const centers = new Map<string, Point>();
  for (const { room, cell } of ordered) {
    if (!cell) continue;
    const back = backs.get(cell.gx) ?? 0;
    centers.set(room.roomId, {
      x: cell.gx * ROOM_PITCH_X + back * TURN_TAN,
      z: back - cell.gx * ROOM_PITCH_X * TURN_TAN + room.depth / 2,
    });
    backs.set(cell.gx, back + room.depth + ROOM_GAP);
  }
  return centers;
}

/** World position of seat `index` in `room`. Rows count from the back wall, which stays put. */
export function seatPosition(room: RoomBox, index: number): Point {
  const cell = Math.floor(index / 2);
  const column = cell % CELL_COLUMNS;
  const row = Math.floor(cell / CELL_COLUMNS);
  const side = index % 2 === 1;
  const cellX = -ROOM_WIDTH / 2 + 1 + column * CELL_SIZE + CELL_SIZE / 2;
  const cellZ = -room.depth / 2 + BACK_STRIP + row * CELL_SIZE + CELL_SIZE / 2;
  return {
    x: room.center.x + cellX + (side ? SIDE_SEAT_OFFSET_X : MAIN_SEAT_OFFSET_X),
    z: room.center.z + cellZ,
  };
}

function pickSeat(
  row: OfficeRow,
  seats: ReadonlyMap<string, number>,
  used: ReadonlySet<number>,
): number | null {
  const parentId = row.depth === 1 ? row.agent.parentAgentId : null;
  const parentSeat = parentId === null ? undefined : seats.get(parentId);
  if (parentSeat !== undefined && parentSeat % 2 === 0 && !used.has(parentSeat + 1)) {
    return parentSeat + 1;
  }
  for (let index = 0; index < DESKS_PER_ROOM; index += 2) if (!used.has(index)) return index;
  for (let index = 1; index < DESKS_PER_ROOM; index += 2) if (!used.has(index)) return index;
  return null;
}

function assignSeats(
  room: OfficeRoom,
  previous: ReadonlyMap<string, number> | undefined,
): { seats: Map<string, number>; overflow: number } {
  const seats = new Map<string, number>();
  const used = new Set<number>();
  for (const row of room.rows) {
    const kept = previous?.get(row.agent.id);
    if (kept !== undefined && kept < DESKS_PER_ROOM && !used.has(kept)) {
      seats.set(row.agent.id, kept);
      used.add(kept);
    }
  }
  let overflow = 0;
  for (const row of room.rows) {
    if (seats.has(row.agent.id)) continue;
    const index = pickSeat(row, seats, used);
    if (index === null) {
      overflow += 1;
      continue;
    }
    seats.set(row.agent.id, index);
    used.add(index);
  }
  return { seats, overflow };
}

/** The rows a room needs for its seats, and at least the rows it had. */
function rowsFor(seats: ReadonlyMap<string, number>, had: number | undefined): number {
  let rows = Math.min(CELL_ROWS, Math.max(1, had ?? 1));
  for (const index of seats.values()) {
    rows = Math.max(rows, Math.floor(Math.floor(index / 2) / CELL_COLUMNS) + 1);
  }
  return rows;
}

interface Seated {
  room: OfficeRoom;
  seats: ReadonlyMap<string, number>;
  overflow: number;
  rows: number;
}

function roomLayout(seated: Seated, cell: GridCell, center: Point): RoomLayout {
  const { room, seats, overflow, rows } = seated;
  const depth = roomDepth(rows);
  const slots: SeatSlot[] = [];
  for (const [agentId, index] of seats) {
    slots.push({
      ...seatPosition({ center, depth }, index),
      agentId,
      roomId: room.id,
      index,
      side: index % 2 === 1,
    });
  }
  slots.sort((left, right) => left.index - right.index);
  return {
    roomId: room.id,
    cell,
    center,
    rows,
    depth,
    seats: slots,
    overflow,
    board: { x: center.x, z: center.z - depth / 2 + 0.35 },
    door: { x: center.x, z: center.z + depth / 2 },
    label: { x: center.x - ROOM_WIDTH / 2 + 2.5, z: center.z + depth / 2 + 0.9 },
  };
}

/**
 * The places to remember: each column's remembered order, missing rooms included, with the rooms
 * dealt there anew behind it. `previous` holds places for this column count only.
 */
function rememberCells(
  cells: ReadonlyMap<string, GridCell>,
  previous: ReadonlyMap<string, GridCell>,
  columns: number,
): Map<string, GridCell> {
  const stacks: string[][] = Array.from({ length: columns }, () => []);
  const remembered = [...previous].filter(([roomId, cell]) => {
    const now = cells.get(roomId);
    return cell.gx < columns && (now === undefined || now.gx === cell.gx);
  });
  remembered.sort(([, left], [, right]) => left.gz - right.gz);
  for (const [roomId, cell] of remembered) stacks[cell.gx]?.push(roomId);
  const known = new Set(remembered.map(([roomId]) => roomId));
  const dealt = [...cells].filter(([roomId]) => !known.has(roomId));
  dealt.sort(([, left], [, right]) => left.gz - right.gz);
  for (const [roomId, cell] of dealt) stacks[cell.gx]?.push(roomId);
  const memory = new Map<string, GridCell>();
  stacks.forEach((stack, gx) => {
    stack.forEach((roomId, gz) => memory.set(roomId, { gx, gz }));
  });
  return memory;
}

/** `kept` with what `previous` knows of rooms `kept` lacks. */
function withMissing<T>(
  kept: ReadonlyMap<string, T>,
  previous: ReadonlyMap<string, T>,
): Map<string, T> {
  const merged = new Map(kept);
  for (const [roomId, value] of previous) if (!merged.has(roomId)) merged.set(roomId, value);
  return merged;
}

/**
 * True for an office of the lobby alone after one with other rooms. A reconnect can show that
 * for a moment: the agents arrive before their workspaces and all stand in the lobby. It is drawn,
 * but not remembered, or the lobby would keep the rows it grew to and push every room back.
 */
function lobbyAloneForNow(model: OfficeModel, memory: LayoutMemory): boolean {
  if (model.rooms.some((room) => room.id !== LOBBY)) return false;
  return [...memory.rows.keys()].some((roomId) => roomId !== LOBBY);
}

function boundsOf(rooms: readonly RoomLayout[]): Bounds {
  if (rooms.length === 0) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  return {
    minX: Math.min(...rooms.map((room) => room.center.x)) - ROOM_WIDTH / 2 - BOUNDS_MARGIN,
    maxX: Math.max(...rooms.map((room) => room.center.x)) + ROOM_WIDTH / 2 + BOUNDS_MARGIN,
    minZ: Math.min(...rooms.map((room) => room.center.z - room.depth / 2)) - BOUNDS_MARGIN,
    maxZ: Math.max(...rooms.map((room) => room.center.z + room.depth / 2)) + BOUNDS_MARGIN,
  };
}

/**
 * Lays the rooms out in `columns` columns (see `columnsFor`); without a usable count, for a wide
 * view. Places remembered for another column count are not kept; seats and rows are.
 */
export function layoutOffice(
  model: OfficeModel,
  memory: LayoutMemory,
  columns?: number,
): { layout: OfficeLayout; memory: LayoutMemory } {
  const usable = columns !== undefined && Number.isInteger(columns) && columns >= 1;
  const count = usable ? columns : WIDE_COLUMNS;
  const seated = model.rooms.map((room): Seated => {
    const { seats, overflow } = assignSeats(room, memory.seats.get(room.id));
    return { room, seats, overflow, rows: rowsFor(seats, memory.rows.get(room.id)) };
  });
  const sized = seated.map((entry) => ({ roomId: entry.room.id, depth: roomDepth(entry.rows) }));
  const places = memory.columns === count ? memory.roomCells : new Map<string, GridCell>();
  const cells = dealRooms(sized, places, count);
  const centers = roomCenters(sized, cells);
  const rooms: RoomLayout[] = [];
  for (const entry of seated) {
    const cell = cells.get(entry.room.id);
    const center = centers.get(entry.room.id);
    if (cell && center) rooms.push(roomLayout(entry, cell, center));
  }
  const seatOf = new Map<string, SeatSlot>();
  for (const room of rooms) for (const seat of room.seats) seatOf.set(seat.agentId, seat);
  const layout: OfficeLayout = {
    rooms,
    roomById: new Map(rooms.map((room) => [room.roomId, room])),
    seatOf,
    bounds: boundsOf(rooms),
    columns: count,
  };
  if (lobbyAloneForNow(model, memory)) return { layout, memory };
  const seats = new Map(seated.map((entry) => [entry.room.id, entry.seats]));
  const rows = new Map(seated.map((entry) => [entry.room.id, entry.rows]));
  return {
    layout,
    memory: {
      roomCells: rememberCells(cells, places, count),
      seats: withMissing(seats, memory.seats),
      rows: withMissing(rows, memory.rows),
      columns: count,
    },
  };
}
