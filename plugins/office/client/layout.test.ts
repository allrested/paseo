import { expect, test } from "vitest";
import type { OfficeAgent, OfficeSnapshot } from "../shared/contracts.js";
import {
  DESKS_PER_ROOM,
  columnsFor,
  EMPTY_LAYOUT_MEMORY,
  ROOM_DEPTH,
  ROOM_PITCH_X,
  ROOM_PITCH_Z,
  ROOM_WIDTH,
  layoutOffice,
  rowCells,
  seatPosition,
  spiralCells,
  type LayoutMemory,
} from "./layout.js";
import { buildOfficeModel } from "./model.js";

function agent(id: string, minute: number, overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: id,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: `2026-11-11T08:${String(minute).padStart(2, "0")}:00.000Z`,
    ...overrides,
  };
}

function snapshot(workspaceIds: readonly string[], agents: readonly OfficeAgent[]): OfficeSnapshot {
  return {
    agents: [...agents],
    workspaces: workspaceIds.map((id) => ({ id, name: id, projectName: "p" })),
    activity: {},
    boards: {},
    wake: { paused: false, queued: {} },
  };
}

function run(state: OfficeSnapshot, memory: LayoutMemory = EMPTY_LAYOUT_MEMORY, columns?: number) {
  return layoutOffice(buildOfficeModel(state), memory, columns);
}

function cells(result: ReturnType<typeof run>) {
  return result.layout.rooms.map((room) => [room.roomId, room.cell.gx, room.cell.gz]);
}

test("spiral cells go ring by ring, each ring by angle from east", () => {
  expect(spiralCells(9)).toEqual([
    { gx: 0, gz: 0 },
    { gx: 1, gz: 0 },
    { gx: 1, gz: 1 },
    { gx: 0, gz: 1 },
    { gx: -1, gz: 1 },
    { gx: -1, gz: 0 },
    { gx: -1, gz: -1 },
    { gx: 0, gz: -1 },
    { gx: 1, gz: -1 },
  ]);
});

test("the lobby sits in the middle and rooms spiral out from it", () => {
  const { layout } = run(snapshot(["w1", "w2"], []));
  expect(layout.rooms.map((room) => [room.roomId, room.center])).toEqual([
    ["lobby", { x: 0, z: 0 }],
    ["w1", { x: ROOM_PITCH_X, z: 0 }],
    ["w2", { x: ROOM_PITCH_X, z: ROOM_PITCH_Z }],
  ]);
  const lobby = layout.roomById.get("lobby");
  expect(lobby?.board).toEqual({ x: 0, z: -ROOM_DEPTH / 2 + 0.35 });
  expect(lobby?.door).toEqual({ x: 0, z: ROOM_DEPTH / 2 });
});

test("rooms keep their cells when another room is added or removed", () => {
  const first = run(snapshot(["w1", "w2"], []));
  const added = run(snapshot(["w0", "w1", "w2"], []), first.memory);
  expect(added.layout.roomById.get("w1")?.cell).toEqual({ gx: 1, gz: 0 });
  expect(added.layout.roomById.get("w2")?.cell).toEqual({ gx: 1, gz: 1 });
  expect(added.layout.roomById.get("w0")?.cell).toEqual({ gx: 0, gz: 1 });
  const removed = run(snapshot(["w0", "w2"], []), added.memory);
  expect(removed.layout.roomById.get("w2")?.cell).toEqual({ gx: 1, gz: 1 });
  expect(removed.layout.roomById.get("w0")?.cell).toEqual({ gx: 0, gz: 1 });
});

test("agents take main seats in order and a child sits beside its parent", () => {
  const { layout } = run(
    snapshot(["w1"], [agent("a", 0), agent("b", 1), agent("c", 2, { parentAgentId: "a" })]),
  );
  expect(["a", "c", "b"].map((id) => layout.seatOf.get(id)?.index)).toEqual([0, 1, 2]);
  expect(layout.seatOf.get("c")?.side).toBe(true);
  expect(layout.seatOf.get("c")?.roomId).toBe("w1");
});

test("an agent that starts later, or earlier in time, does not move anyone", () => {
  const first = run(snapshot(["w1"], [agent("b", 5), agent("c", 6)]));
  expect([first.layout.seatOf.get("b")?.index, first.layout.seatOf.get("c")?.index]).toEqual([
    0, 2,
  ]);
  const next = run(snapshot(["w1"], [agent("a", 1), agent("b", 5), agent("c", 6)]), first.memory);
  expect(["a", "b", "c"].map((id) => next.layout.seatOf.get(id)?.index)).toEqual([4, 0, 2]);
});

test("a freed seat is reused by the next new agent", () => {
  const first = run(snapshot(["w1"], [agent("a", 0), agent("b", 1)]));
  const next = run(snapshot(["w1"], [agent("b", 1), agent("d", 3)]), first.memory);
  expect([next.layout.seatOf.get("b")?.index, next.layout.seatOf.get("d")?.index]).toEqual([2, 0]);
});

test("24 desks per room; the rest count as overflow", () => {
  const agents = Array.from({ length: 30 }, (_, index) => agent(`a${index}`, index));
  const { layout } = run(snapshot(["w1"], agents));
  const room = layout.roomById.get("w1");
  expect(room?.seats).toHaveLength(DESKS_PER_ROOM);
  expect(room?.overflow).toBe(6);
  expect(layout.seatOf.has("a29")).toBe(false);
});

test("every seat lies inside its room, and the bounds hold every room", () => {
  for (let index = 0; index < DESKS_PER_ROOM; index += 1) {
    const seat = seatPosition({ x: 100, z: 50 }, index);
    expect(Math.abs(seat.x - 100)).toBeLessThan(ROOM_WIDTH / 2);
    expect(Math.abs(seat.z - 50)).toBeLessThan(ROOM_DEPTH / 2);
  }
  const { layout } = run(snapshot(["w1", "w2"], []));
  expect(layout.bounds).toEqual({
    minX: -ROOM_WIDTH / 2 - 2,
    maxX: ROOM_PITCH_X + ROOM_WIDTH / 2 + 2,
    minZ: -ROOM_DEPTH / 2 - 2,
    maxZ: ROOM_PITCH_Z + ROOM_DEPTH / 2 + 2,
  });
});

test("an office with no rooms has zero-size bounds at the origin", () => {
  const { layout } = layoutOffice(
    { rooms: [], attention: [], agents: new Map(), roomOfAgent: new Map() },
    EMPTY_LAYOUT_MEMORY,
  );
  expect(layout.rooms).toEqual([]);
  expect(layout.bounds).toEqual({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
});

test("row cells fill a fixed number of columns, turning at the end of each row", () => {
  expect(rowCells(5, 2)).toEqual([
    { gx: 0, gz: 0 },
    { gx: 1, gz: 0 },
    { gx: 1, gz: 1 },
    { gx: 0, gz: 1 },
    { gx: 0, gz: 2 },
  ]);
  // The first four are the spiral's first four, so a small office looks the same in both grids.
  expect(rowCells(4, 2)).toEqual(spiralCells(4));
  expect(rowCells(3, 1)).toEqual([
    { gx: 0, gz: 0 },
    { gx: 0, gz: 1 },
    { gx: 0, gz: 2 },
  ]);
});

test("with a column count the office is that many rooms wide, however many rooms it has", () => {
  const tall = run(snapshot(["w1", "w2", "w3", "w4"], []), EMPTY_LAYOUT_MEMORY, 2);
  expect(cells(tall)).toEqual([
    ["lobby", 0, 0],
    ["w1", 1, 0],
    ["w2", 1, 1],
    ["w3", 0, 1],
    ["w4", 0, 2],
  ]);
  expect(tall.layout.bounds).toEqual({
    minX: -ROOM_WIDTH / 2 - 2,
    maxX: ROOM_PITCH_X + ROOM_WIDTH / 2 + 2,
    minZ: -ROOM_DEPTH / 2 - 2,
    maxZ: 2 * ROOM_PITCH_Z + ROOM_DEPTH / 2 + 2,
  });
  // Without one, the same office is three rooms wide.
  expect(run(snapshot(["w1", "w2", "w3", "w4"], [])).layout.bounds.minX).toBe(
    -ROOM_PITCH_X - ROOM_WIDTH / 2 - 2,
  );
});

test("rooms keep their cells in a column grid when another room is added or removed", () => {
  const first = run(snapshot(["w1", "w2", "w3", "w4"], []), EMPTY_LAYOUT_MEMORY, 2);
  const removed = run(snapshot(["w1", "w3", "w4"], []), first.memory, 2);
  expect(cells(removed)).toEqual([
    ["lobby", 0, 0],
    ["w1", 1, 0],
    ["w3", 0, 1],
    ["w4", 0, 2],
  ]);
  const added = run(snapshot(["w1", "w3", "w4", "w5"], []), removed.memory, 2);
  expect(added.layout.roomById.get("w5")?.cell).toEqual({ gx: 1, gz: 1 });
  expect(added.layout.roomById.get("w4")?.cell).toEqual({ gx: 0, gz: 2 });
});

test("a change of grid lays the rooms out again, and seats stay", () => {
  const agents = [agent("a", 0), agent("b", 1)];
  const ids = ["w1", "w2", "w3", "w4"];
  const wide = run(snapshot(ids, agents));
  expect(wide.layout.roomById.get("w4")?.cell).toEqual({ gx: -1, gz: 1 });
  const later = run(snapshot(ids, [agent("b", 1)]), wide.memory, 2);
  expect(later.layout.roomById.get("w4")?.cell).toEqual({ gx: 0, gz: 2 });
  expect(later.layout.seatOf.get("b")?.index).toBe(2);
  const back = run(snapshot(ids, [agent("b", 1)]), later.memory);
  expect(cells(back)).toEqual(cells(wide));
  expect(back.layout.seatOf.get("b")?.index).toBe(2);
});

test("a column count that is not a whole number of at least 1 is ignored", () => {
  const ids = ["w1", "w2", "w3", "w4"];
  const spiral = cells(run(snapshot(ids, [])));
  expect(cells(run(snapshot(ids, []), EMPTY_LAYOUT_MEMORY, 0))).toEqual(spiral);
  expect(cells(run(snapshot(ids, []), EMPTY_LAYOUT_MEMORY, Number.NaN))).toEqual(spiral);
  expect(cells(run(snapshot(ids, []), EMPTY_LAYOUT_MEMORY, 2.5))).toEqual(spiral);
});

test("a view taller than wide gets two columns, a wide one the spiral", () => {
  expect(columnsFor({ width: 390, height: 844 })).toBe(2);
  expect(columnsFor({ width: 820, height: 1180 })).toBe(2);
  expect(columnsFor({ width: 1180, height: 820 })).toBeUndefined();
  expect(columnsFor({ width: 800, height: 800 })).toBeUndefined();
  expect(columnsFor({ width: 0, height: 0 })).toBeUndefined();
});
