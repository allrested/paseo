import { expect, test } from "vitest";
import type { OfficeAgent, OfficeSnapshot } from "../shared/contracts.js";
import {
  CELL_ROWS,
  CELL_SIZE,
  DESKS_PER_ROOM,
  columnsFor,
  EMPTY_LAYOUT_MEMORY,
  ROOM_DEPTH,
  ROOM_GAP,
  ROOM_PITCH_X,
  ROOM_WIDTH,
  VIEW_TURN,
  layoutOffice,
  roomDepth,
  seatPosition,
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

/** `count` agents of one workspace, named after it. */
function crew(workspaceId: string, count: number): OfficeAgent[] {
  return Array.from({ length: count }, (_, index) =>
    agent(`${workspaceId}-${index}`, index, { workspaceId }),
  );
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

function centers(result: ReturnType<typeof run>) {
  return result.layout.rooms.map((room) => [room.roomId, room.center.x, room.center.z]);
}

const ONE_ROW = roomDepth(1);
const TAN = Math.tan(VIEW_TURN);

/** The middle of a room `depth` deep whose back wall stands `back` down column `column`. */
function centerAt(column: number, back: number, depth: number): [number, number] {
  return [column * ROOM_PITCH_X + back * TAN, back - column * ROOM_PITCH_X * TAN + depth / 2];
}

test("a room is as deep as the rows of desks its agents need, and never less than one", () => {
  expect([roomDepth(1), roomDepth(2), roomDepth(CELL_ROWS)]).toEqual([6, 8.5, ROOM_DEPTH]);
  const { layout } = run(
    snapshot(["w1", "w2", "w3"], [...crew("w1", 4), ...crew("w2", 5), ...crew("w3", 9)]),
  );
  expect(layout.rooms.map((room) => [room.roomId, room.rows, room.depth])).toEqual([
    ["lobby", 1, 6],
    ["w1", 1, 6],
    ["w2", 2, 8.5],
    ["w3", 3, 11],
  ]);
});

test("a child at its parent's side desk does not ask for a row", () => {
  const { layout } = run(
    snapshot(["w1"], [...crew("w1", 4), agent("child", 9, { parentAgentId: "w1-3" })]),
  );
  expect(layout.roomById.get("w1")?.rows).toBe(1);
});

test("in one column the rooms stand in the model's order, the lobby at the back", () => {
  const result = run(snapshot(["w1", "w2"], crew("w1", 5)), EMPTY_LAYOUT_MEMORY, 1);
  const second = ONE_ROW + ROOM_GAP;
  const third = second + roomDepth(2) + ROOM_GAP;
  expect(centers(result)).toEqual([
    ["lobby", ...centerAt(0, 0, ONE_ROW)],
    ["w1", ...centerAt(0, second, roomDepth(2))],
    ["w2", ...centerAt(0, third, ONE_ROW)],
  ]);
  expect(cells(result)).toEqual([
    ["lobby", 0, 0],
    ["w1", 0, 1],
    ["w2", 0, 2],
  ]);
  const lobby = result.layout.roomById.get("lobby");
  expect(lobby?.board).toEqual({ x: 0, z: 0.35 });
  expect(lobby?.door).toEqual({ x: 0, z: ONE_ROW });
});

test("in columns the lobby takes the middle, then the deepest room goes to the shortest column", () => {
  const result = run(snapshot(["w1", "w2", "w3", "w4"], crew("w4", 9)), EMPTY_LAYOUT_MEMORY, 3);
  // The lobby first, then w4 (three rows), then the others in the model's order.
  expect(cells(result)).toEqual([
    ["lobby", 1, 0],
    ["w1", 2, 0],
    ["w2", 1, 1],
    ["w3", 2, 1],
    ["w4", 0, 0],
  ]);
  expect(centers(result)).toEqual([
    ["lobby", ...centerAt(1, 0, ONE_ROW)],
    ["w1", ...centerAt(2, 0, ONE_ROW)],
    ["w2", ...centerAt(1, ONE_ROW + ROOM_GAP, ONE_ROW)],
    ["w3", ...centerAt(2, ONE_ROW + ROOM_GAP, ONE_ROW)],
    ["w4", ...centerAt(0, 0, ROOM_DEPTH)],
  ]);
  expect(result.layout.columns).toBe(3);
});

test("rooms of one depth fill the columns in reading order", () => {
  const result = run(snapshot(["w1", "w2", "w3"], []), EMPTY_LAYOUT_MEMORY, 2);
  expect(cells(result)).toEqual([
    ["lobby", 0, 0],
    ["w1", 1, 0],
    ["w2", 0, 1],
    ["w3", 1, 1],
  ]);
});

test("rooms keep their column and their order when another room is added or removed", () => {
  const first = run(snapshot(["w1", "w2", "w3"], []), EMPTY_LAYOUT_MEMORY, 2);
  const removed = run(snapshot(["w2", "w3"], []), first.memory, 2);
  // w3 stays in its column and moves up to the place w1 left.
  expect(cells(removed)).toEqual([
    ["lobby", 0, 0],
    ["w2", 0, 1],
    ["w3", 1, 0],
  ]);
  const [x, z] = centerAt(1, 0, ONE_ROW);
  expect(removed.layout.roomById.get("w3")?.center).toEqual({ x, z });
  // A new room goes behind the last room of the shortest column; nobody else moves.
  const added = run(snapshot(["w0", "w2", "w3"], []), removed.memory, 2);
  expect(cells(added)).toEqual([
    ["lobby", 0, 0],
    ["w0", 1, 1],
    ["w2", 0, 1],
    ["w3", 1, 0],
  ]);
});

test("a room that grows by a row keeps its back wall and its seats, and pushes the rooms behind it", () => {
  const ids = ["w1", "w2", "w3"];
  const before = run(snapshot(ids, crew("w1", 4)), EMPTY_LAYOUT_MEMORY, 2);
  const after = run(snapshot(ids, crew("w1", 5)), before.memory, 2);
  expect(cells(after)).toEqual(cells(before));
  const [was, now] = [before, after].map((result) => result.layout.roomById.get("w1"));
  expect([was?.rows, now?.rows]).toEqual([1, 2]);
  expect((now?.center.z ?? 0) - (now?.depth ?? 0) / 2).toBeCloseTo(
    (was?.center.z ?? 0) - (was?.depth ?? 0) / 2,
    9,
  );
  expect(now?.center.x).toBe(was?.center.x);
  for (const seat of was?.seats ?? []) {
    const kept = after.layout.seatOf.get(seat.agentId);
    expect(kept?.x).toBeCloseTo(seat.x, 9);
    expect(kept?.z).toBeCloseTo(seat.z, 9);
  }
  // w3 stands behind w1 and moves by one row; w2 is in the other column and stays.
  const moved = ids.map((id) => {
    const from = before.layout.roomById.get(id)?.center.z ?? 0;
    return (after.layout.roomById.get(id)?.center.z ?? 0) - from;
  });
  expect(moved[0]).toBeCloseTo(CELL_SIZE / 2, 9);
  expect(moved[1]).toBe(0);
  expect(moved[2]).toBeCloseTo(CELL_SIZE, 9);
});

test("a room keeps the rows it grew to when its agents leave, so its neighbours move once", () => {
  const grown = run(snapshot(["w1", "w2"], crew("w1", 5)), EMPTY_LAYOUT_MEMORY, 1);
  const emptied = run(snapshot(["w1", "w2"], crew("w1", 1)), grown.memory, 1);
  expect(emptied.layout.roomById.get("w1")?.rows).toBe(2);
  expect(centers(emptied)).toEqual(centers(grown));
  // Laid out afresh, the same room needs one row.
  expect(run(snapshot(["w1", "w2"], crew("w1", 1))).layout.roomById.get("w1")?.rows).toBe(1);
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
  expect(room?.rows).toBe(CELL_ROWS);
  expect(layout.seatOf.has("a29")).toBe(false);
});

test("every seat lies inside a room of its rows, and the bounds hold every room", () => {
  for (let rows = 1; rows <= CELL_ROWS; rows += 1) {
    const room = { center: { x: 100, z: 50 }, depth: roomDepth(rows) };
    for (let index = 0; index < rows * 8; index += 1) {
      const seat = seatPosition(room, index);
      expect(Math.abs(seat.x - 100)).toBeLessThan(ROOM_WIDTH / 2);
      expect(Math.abs(seat.z - 50)).toBeLessThan(room.depth / 2);
    }
  }
  const { layout } = run(snapshot(["w1", "w2"], []), EMPTY_LAYOUT_MEMORY, 2);
  // The second column starts further back, so that on screen it starts level with the first.
  expect(layout.bounds.minX).toBeCloseTo(-ROOM_WIDTH / 2 - 2, 9);
  expect(layout.bounds.maxX).toBeCloseTo(ROOM_PITCH_X + ROOM_WIDTH / 2 + 2, 9);
  expect(layout.bounds.minZ).toBeCloseTo(-ROOM_PITCH_X * TAN - 2, 9);
  expect(layout.bounds.maxZ).toBeCloseTo(2 * ONE_ROW + ROOM_GAP + 2, 9);
});

test("seen from above the places are a grid turned by the view's angle", () => {
  const { layout } = run(snapshot(["w1", "w2", "w3"], []), EMPTY_LAYOUT_MEMORY, 2);
  const back = (roomId: string) => {
    const room = layout.roomById.get(roomId);
    return { x: room?.center.x ?? 0, z: (room?.center.z ?? 0) - (room?.depth ?? 0) / 2 };
  };
  // Along the camera's own directions: across the screen, and down it.
  const across = (roomId: string) =>
    back(roomId).x * Math.cos(VIEW_TURN) - back(roomId).z * Math.sin(VIEW_TURN);
  const down = (roomId: string) =>
    back(roomId).x * Math.sin(VIEW_TURN) + back(roomId).z * Math.cos(VIEW_TURN);
  expect(VIEW_TURN).toBeGreaterThan(0);
  // w2 stands behind the lobby, w1 beside it.
  expect(across("w2")).toBeCloseTo(across("lobby"), 9);
  expect(down("w2") - down("lobby")).toBeCloseTo((ONE_ROW + ROOM_GAP) / Math.cos(VIEW_TURN), 9);
  expect(down("w1")).toBeCloseTo(down("lobby"), 9);
  expect(across("w1") - across("lobby")).toBeCloseTo(ROOM_PITCH_X / Math.cos(VIEW_TURN), 9);
});

test("the first row of desks stands the same distance from the back wall in every room", () => {
  const shallow = { center: { x: 0, z: ONE_ROW / 2 }, depth: ONE_ROW };
  const deep = { center: { x: 0, z: ROOM_DEPTH / 2 }, depth: ROOM_DEPTH };
  expect(seatPosition(shallow, 0)).toEqual(seatPosition(deep, 0));
  expect(seatPosition(deep, 8).z - seatPosition(deep, 0).z).toBe(CELL_SIZE);
});

test("an office with no rooms has zero-size bounds at the origin", () => {
  const { layout } = layoutOffice(
    { rooms: [], attention: [], agents: new Map(), roomOfAgent: new Map() },
    EMPTY_LAYOUT_MEMORY,
  );
  expect(layout.rooms).toEqual([]);
  expect(layout.bounds).toEqual({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
});

test("a change of column count deals the rooms again, and seats and rows stay", () => {
  const ids = ["w1", "w2", "w3", "w4"];
  const wide = run(snapshot(ids, crew("w1", 5)), EMPTY_LAYOUT_MEMORY, 2);
  expect(wide.layout.roomById.get("w4")?.cell).toEqual({ gx: 0, gz: 2 });
  const leaver = crew("w1", 5).slice(1);
  const tall = run(snapshot(ids, leaver), wide.memory, 1);
  expect(cells(tall)).toEqual([
    ["lobby", 0, 0],
    ["w1", 0, 1],
    ["w2", 0, 2],
    ["w3", 0, 3],
    ["w4", 0, 4],
  ]);
  expect(tall.layout.seatOf.get("w1-4")?.index).toBe(8);
  expect(tall.layout.roomById.get("w1")?.rows).toBe(2);
  const back = run(snapshot(ids, leaver), tall.memory, 2);
  expect(cells(back)).toEqual(cells(wide));
  expect(back.layout.seatOf.get("w1-4")?.index).toBe(8);
});

test("a column count that is not a whole number of at least 1 lays out for a wide view", () => {
  const ids = ["w1", "w2", "w3", "w4"];
  const wide = cells(run(snapshot(ids, []), EMPTY_LAYOUT_MEMORY, 2));
  expect(cells(run(snapshot(ids, [])))).toEqual(wide);
  expect(cells(run(snapshot(ids, []), EMPTY_LAYOUT_MEMORY, 0))).toEqual(wide);
  expect(cells(run(snapshot(ids, []), EMPTY_LAYOUT_MEMORY, Number.NaN))).toEqual(wide);
  expect(cells(run(snapshot(ids, []), EMPTY_LAYOUT_MEMORY, 2.5))).toEqual(wide);
});

test("a tall view gets one column of rooms, a wide one two, a very wide one three", () => {
  expect(columnsFor({ width: 390, height: 844 })).toBe(1);
  expect(columnsFor({ width: 820, height: 1180 })).toBe(1);
  expect(columnsFor({ width: 800, height: 800 })).toBe(2);
  expect(columnsFor({ width: 1180, height: 820 })).toBe(2);
  expect(columnsFor({ width: 1440, height: 900 })).toBe(2);
  expect(columnsFor({ width: 1920, height: 600 })).toBe(3);
});

test("a view too narrow for another column of legible robots does not get one", () => {
  // A phone on its side is very wide for its height, but only two columns fit its 844 px.
  expect(columnsFor({ width: 844, height: 212 })).toBe(2);
  expect(columnsFor({ width: 600, height: 300 })).toBe(1);
  expect(columnsFor({ width: 0, height: 0 })).toBe(1);
});

/** What a reader of the layout sees of each room: its place, its rows and its seats. */
function places(result: ReturnType<typeof run>) {
  return result.layout.rooms.map((room) => ({
    roomId: room.roomId,
    cell: room.cell,
    rows: room.rows,
    center: room.center,
    seats: room.seats.map((seat) => [seat.agentId, seat.index]),
  }));
}

test("a snapshot that holds only the lobby for a moment leaves every room its place, rows and seats", () => {
  const ids = ["w1", "w2", "w3"];
  const agents = [...crew("w1", 5), ...crew("w2", 2), ...crew("w3", 1)];
  const full = run(snapshot(ids, agents), EMPTY_LAYOUT_MEMORY, 2);
  // A reconnect: the agents arrived before their workspaces, so every agent stands in the lobby.
  const lobbyOnly = run(snapshot([], agents), full.memory, 2);
  const empty = run(snapshot([], []), lobbyOnly.memory, 2);
  const again = run(snapshot(ids, agents), empty.memory, 2);
  expect(places(again)).toEqual(places(full));
});

test("a room that drops out of one snapshot comes back to its place", () => {
  const ids = ["w1", "w2", "w3", "w4"];
  const first = run(snapshot(ids, crew("w2", 5)), EMPTY_LAYOUT_MEMORY, 2);
  const without = run(snapshot(["w1", "w3", "w4"], []), first.memory, 2);
  const back = run(snapshot(ids, crew("w2", 5)), without.memory, 2);
  expect(places(back)).toEqual(places(first));
});

test("an office that only ever had the lobby remembers its seats", () => {
  const before = run(snapshot([], crew("lobby", 3)));
  const after = run(snapshot([], crew("lobby", 3).slice(1)), before.memory);
  expect(after.layout.seatOf.get("lobby-2")?.index).toBe(4);
});

test("a room that comes back takes its own place, not that of the room that moved up", () => {
  const first = run(snapshot(["w1", "w2", "w3"], []), EMPTY_LAYOUT_MEMORY, 1);
  const without = run(snapshot(["w1", "w3"], []), first.memory, 1);
  expect(cells(without)).toEqual([
    ["lobby", 0, 0],
    ["w1", 0, 1],
    ["w3", 0, 2],
  ]);
  // The workspaces come back listed in another order: the places stand.
  const back = run(snapshot(["w3", "w2", "w1"], []), without.memory, 1);
  expect(cells(back).sort()).toEqual(cells(first).sort());
});
