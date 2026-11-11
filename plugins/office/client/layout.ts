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

/** What the next layout keeps: each room's place and rows, and each agent's seat. */
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
 */
export function columnsFor(viewport: { width: number; height: number }): number {
  const { width, height } = viewport;
  if (!(width > 0) || !(height > 0)) return 1;
  const fitting = Math.max(1, Math.floor(width / COLUMN_MIN_PX));
  if (width < height) return 1;
  return Math.min(fitting, width < height * VERY_WIDE ? 2 : 3);
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

/** The middle of each room's floor: column by column, each room behind the last one. */
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
    centers.set(room.roomId, { x: cell.gx * ROOM_PITCH_X, z: back + room.depth / 2 });
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
  const cells = dealRooms(sized, memory.columns === count ? memory.roomCells : new Map(), count);
  const centers = roomCenters(sized, cells);
  const rooms: RoomLayout[] = [];
  for (const entry of seated) {
    const cell = cells.get(entry.room.id);
    const center = centers.get(entry.room.id);
    if (cell && center) rooms.push(roomLayout(entry, cell, center));
  }
  const seatOf = new Map<string, SeatSlot>();
  for (const room of rooms) for (const seat of room.seats) seatOf.set(seat.agentId, seat);
  return {
    layout: {
      rooms,
      roomById: new Map(rooms.map((room) => [room.roomId, room])),
      seatOf,
      bounds: boundsOf(rooms),
      columns: count,
    },
    memory: {
      roomCells: cells,
      seats: new Map(seated.map((entry) => [entry.room.id, entry.seats])),
      rows: new Map(seated.map((entry) => [entry.room.id, entry.rows])),
      columns: count,
    },
  };
}
