import { expect, test } from "vitest";
import {
  OfficeEventSchema,
  OfficeSnapshotSchema,
  PostSchema,
  RenderEventSchema,
  renderInputRpc,
  renderSubscription,
  sheetInputRpc,
  sheetSpriteRpc,
  sheetSubscription,
  assetRpc,
  deleteRpc,
  officeStateSubscription,
  postRpc,
  setWakesPausedRpc,
  updateRpc,
  type OfficeSnapshot,
} from "./contracts.js";

function emptySnapshot(): OfficeSnapshot {
  return {
    agents: [],
    workspaces: [],
    activity: {},
    boards: {},
    wake: { paused: false, queued: {} },
  };
}

test("contract names follow the dotted request convention", () => {
  expect([
    officeStateSubscription.name,
    postRpc.name,
    updateRpc.name,
    deleteRpc.name,
    setWakesPausedRpc.name,
    assetRpc.name,
  ]).toEqual([
    "office.state",
    "office.post.request",
    "office.update.request",
    "office.delete.request",
    "office.set_wakes_paused.request",
    "office.asset.request",
  ]);
});

test("a snapshot event and a note without state parse", () => {
  const note = {
    id: "p1",
    seq: 1,
    board: "lobby",
    kind: "note",
    text: "Build is green",
    author: "user",
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
  };
  expect(PostSchema.parse(note)).toEqual(note);
  const snapshot = emptySnapshot();
  expect(OfficeEventSchema.parse({ type: "snapshot", state: snapshot })).toEqual({
    type: "snapshot",
    state: snapshot,
  });
});

test("a post longer than 2,000 characters is refused at the boundary", () => {
  const input = { board: "lobby", kind: "note", text: "x".repeat(2001) };
  expect(postRpc.input.safeParse(input).success).toBe(false);
  expect(postRpc.input.safeParse({ ...input, text: "x".repeat(2000) }).success).toBe(true);
});

test("the asset RPC returns bytes", () => {
  expect(assetRpc.output.safeParse(new Uint8Array([1, 2])).success).toBe(true);
  expect(assetRpc.output.safeParse("bytes").success).toBe(false);
});

test("a snapshot says whether the host can draw 3D, and one without it still parses", () => {
  expect(OfficeSnapshotSchema.parse(emptySnapshot()).render).toBeUndefined();
  expect(
    OfficeSnapshotSchema.parse({ ...emptySnapshot(), render: { available: true } }).render,
  ).toEqual({ available: true });
});

test("the render contracts are named like the others", () => {
  expect([renderSubscription.name, renderInputRpc.name]).toEqual([
    "office.render",
    "office.render.input.request",
  ]);
});

test("render input needs only its stream, and takes at most 64 pointer steps", () => {
  const step = { type: "move", x: 1, y: 2 };
  expect(renderInputRpc.input.safeParse({ streamId: "s1" }).success).toBe(true);
  expect(
    renderInputRpc.input.safeParse({ streamId: "s1", steps: Array(64).fill(step) }).success,
  ).toBe(true);
  expect(
    renderInputRpc.input.safeParse({ streamId: "s1", steps: Array(65).fill(step) }).success,
  ).toBe(false);
});

test("a picture's seq starts at 1", () => {
  const picture = { type: "picture", jpeg: "abc", width: 585, height: 1050 };
  expect(RenderEventSchema.safeParse({ ...picture, seq: 1 }).success).toBe(true);
  expect(RenderEventSchema.safeParse({ ...picture, seq: 0 }).success).toBe(false);
});

test("the render subscription refuses a theme with a colour missing", () => {
  const input = { width: 390, height: 700, pixelRatio: 3, coarsePointer: true };
  expect(
    renderSubscription.input.safeParse({ ...input, colors: { surface0: "#fff" } }).success,
  ).toBe(false);
});

test("the sheet view's subscription and RPCs are named as the docs say", () => {
  expect([sheetSubscription.name, sheetInputRpc.name, sheetSpriteRpc.name]).toEqual([
    "office.sheet",
    "office.sheet.input.request",
    "office.sheet.sprite.request",
  ]);
});

test("a sheet's events parse, and a tile over 1024 pixels is refused", () => {
  const tile = {
    version: 1,
    index: 0,
    x: 0,
    y: 0,
    width: 780,
    height: 1024,
    jpeg: "AA",
    overlay: null,
  };
  const event = sheetSubscription.event;
  expect(event.safeParse({ type: "ready", sheetId: "s1" }).success).toBe(true);
  expect(event.safeParse({ type: "tile", tile }).success).toBe(true);
  expect(event.safeParse({ type: "tile", tile: { ...tile, overlay: "AA" } }).success).toBe(true);
  expect(event.safeParse({ type: "tile", tile: { ...tile, height: 1025 } }).success).toBe(false);
  const sheet = {
    version: 1,
    tiles: 2,
    width: 780,
    height: 1814,
    ratio: 2,
    scale: 47.4,
    frame: { width: 155, height: 204, chest: { x: 84, y: 107.6 } },
    robots: [
      {
        agentId: "a",
        key: "idle|#fff|off|#aaa|0|0|0",
        x: 10,
        y: 20,
        phase: 0,
        joining: false,
        fresh: true,
      },
    ],
    rooms: [
      {
        roomId: "lobby",
        area: { x: 0, y: 0, width: 30, height: 40 },
        board: { x: 1, y: 2, width: 3, height: 4 },
        plate: { x: 1, y: 2, width: 3, height: 4 },
      },
    ],
    notes: [{ roomId: "lobby", rect: { x: 1, y: 2, width: 3, height: 4 } }],
    mentions: [{ postId: "p", from: { x: 0, y: 0 }, to: { x: 5, y: 5 } }],
  };
  expect(event.safeParse({ type: "sheet", sheet }).success).toBe(true);
  expect(event.safeParse({ type: "sheet", sheet: { ...sheet, tiles: 0 } }).success).toBe(false);
  expect(event.safeParse({ type: "problem", message: "no browser" }).success).toBe(true);
});

test("a sprite request names its sheet, and the answer may be null", () => {
  expect(sheetSpriteRpc.input.safeParse({ sheetId: "s1", key: "plane" }).success).toBe(true);
  expect(sheetSpriteRpc.input.safeParse({ key: "plane" }).success).toBe(false);
  expect(sheetSpriteRpc.input.safeParse({ sheetId: "s1", key: "x".repeat(201) }).success).toBe(
    false,
  );
  expect(sheetSpriteRpc.output.safeParse(null).success).toBe(true);
  expect(sheetInputRpc.input.safeParse({ sheetId: "s1" }).success).toBe(true);
});
