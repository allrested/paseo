import { LOBBY } from "../shared/contracts.js";
import type { OfficeModel, OfficeRoom, OfficeRow } from "./model.js";

export const DESKS_PER_ROOM = 24;
export const CELL_COLUMNS = 4;
export const CELL_ROWS = 3;
export const CELL_SIZE = 2.5;
export const ROOM_WIDTH = 12;
export const ROOM_DEPTH = 11;
export const ROOM_PITCH_X = 15;
export const ROOM_PITCH_Z = 14;
export const WALL_HEIGHT = 1.2;
export const DOOR_WIDTH = 2;
/** The strip at the back of a room that holds the whiteboard. */
const BOARD_STRIP = 2;
const MAIN_SEAT_OFFSET_X = -0.55;
const SIDE_SEAT_OFFSET_X = 0.65;
const BOUNDS_MARGIN = 2;

export interface Point {
  x: number;
  z: number;
}

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

export interface RoomLayout {
  roomId: string;
  cell: GridCell;
  center: Point;
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
}

/** What the next layout keeps: each room's cell and each agent's seat. */
export interface LayoutMemory {
  roomCells: ReadonlyMap<string, GridCell>;
  seats: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

export const EMPTY_LAYOUT_MEMORY: LayoutMemory = { roomCells: new Map(), seats: new Map() };

function angleOf(cell: GridCell): number {
  const angle = Math.atan2(cell.gz, cell.gx);
  return angle < 0 ? angle + 2 * Math.PI : angle;
}

/** Grid cells ring by ring from (0, 0), each ring ordered by angle from east. */
export function spiralCells(count: number): GridCell[] {
  const cells: GridCell[] = [];
  for (let ring = 0; cells.length < count; ring += 1) {
    const ringCells: GridCell[] = [];
    for (let gx = 0 - ring; gx <= ring; gx += 1) {
      for (let gz = 0 - ring; gz <= ring; gz += 1) {
        if (Math.max(Math.abs(gx), Math.abs(gz)) === ring) ringCells.push({ gx, gz });
      }
    }
    ringCells.sort((left, right) => angleOf(left) - angleOf(right));
    cells.push(...ringCells);
  }
  return cells.slice(0, count);
}

function cellKey(cell: GridCell): string {
  return `${cell.gx},${cell.gz}`;
}

function assignCells(
  roomIds: readonly string[],
  previous: ReadonlyMap<string, GridCell>,
): Map<string, GridCell> {
  const cells = new Map<string, GridCell>([[LOBBY, { gx: 0, gz: 0 }]]);
  const taken = new Set<string>([cellKey({ gx: 0, gz: 0 })]);
  const pending: string[] = [];
  for (const roomId of roomIds) {
    if (roomId === LOBBY) continue;
    const kept = previous.get(roomId);
    if (kept && !taken.has(cellKey(kept))) {
      taken.add(cellKey(kept));
      cells.set(roomId, kept);
    } else {
      pending.push(roomId);
    }
  }
  // Of the first taken + pending spiral cells, at most `taken` are in use.
  const free = spiralCells(taken.size + pending.length).filter((cell) => !taken.has(cellKey(cell)));
  pending.forEach((roomId, index) => {
    const cell = free[index];
    if (cell) cells.set(roomId, cell);
  });
  return cells;
}

/** World position of seat `index` in a room centred at `center`. */
export function seatPosition(center: Point, index: number): Point {
  const cell = Math.floor(index / 2);
  const column = cell % CELL_COLUMNS;
  const row = Math.floor(cell / CELL_COLUMNS);
  const side = index % 2 === 1;
  const cellX = -ROOM_WIDTH / 2 + 1 + column * CELL_SIZE + CELL_SIZE / 2;
  const cellZ = -ROOM_DEPTH / 2 + BOARD_STRIP + 0.5 + row * CELL_SIZE + CELL_SIZE / 2;
  return {
    x: center.x + cellX + (side ? SIDE_SEAT_OFFSET_X : MAIN_SEAT_OFFSET_X),
    z: center.z + cellZ,
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

function roomLayout(
  room: OfficeRoom,
  cell: GridCell,
  seats: ReadonlyMap<string, number>,
  overflow: number,
): RoomLayout {
  const center = { x: cell.gx * ROOM_PITCH_X, z: cell.gz * ROOM_PITCH_Z };
  const slots: SeatSlot[] = [];
  for (const [agentId, index] of seats) {
    slots.push({
      ...seatPosition(center, index),
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
    seats: slots,
    overflow,
    board: { x: center.x, z: center.z - ROOM_DEPTH / 2 + 0.35 },
    door: { x: center.x, z: center.z + ROOM_DEPTH / 2 },
    label: { x: center.x - ROOM_WIDTH / 2 + 2.5, z: center.z + ROOM_DEPTH / 2 + 0.9 },
  };
}

function boundsOf(rooms: readonly RoomLayout[]): Bounds {
  const xs = rooms.map((room) => room.center.x);
  const zs = rooms.map((room) => room.center.z);
  return {
    minX: Math.min(...xs) - ROOM_WIDTH / 2 - BOUNDS_MARGIN,
    maxX: Math.max(...xs) + ROOM_WIDTH / 2 + BOUNDS_MARGIN,
    minZ: Math.min(...zs) - ROOM_DEPTH / 2 - BOUNDS_MARGIN,
    maxZ: Math.max(...zs) + ROOM_DEPTH / 2 + BOUNDS_MARGIN,
  };
}

export function layoutOffice(
  model: OfficeModel,
  memory: LayoutMemory,
): { layout: OfficeLayout; memory: LayoutMemory } {
  const cells = assignCells(
    model.rooms.map((room) => room.id),
    memory.roomCells,
  );
  const rooms: RoomLayout[] = [];
  const seatMemory = new Map<string, ReadonlyMap<string, number>>();
  for (const room of model.rooms) {
    const cell = cells.get(room.id);
    if (!cell) continue;
    const { seats, overflow } = assignSeats(room, memory.seats.get(room.id));
    seatMemory.set(room.id, seats);
    rooms.push(roomLayout(room, cell, seats, overflow));
  }
  const seatOf = new Map<string, SeatSlot>();
  for (const room of rooms) for (const seat of room.seats) seatOf.set(seat.agentId, seat);
  return {
    layout: {
      rooms,
      roomById: new Map(rooms.map((room) => [room.roomId, room])),
      seatOf,
      bounds: boundsOf(rooms),
    },
    memory: { roomCells: cells, seats: seatMemory },
  };
}
