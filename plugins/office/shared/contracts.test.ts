import { expect, test } from "vitest";
import {
  OfficeEventSchema,
  OfficeSnapshotSchema,
  PostSchema,
  RenderEventSchema,
  renderInputRpc,
  renderSubscription,
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
