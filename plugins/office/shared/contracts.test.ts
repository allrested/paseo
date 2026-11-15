import { expect, test } from "vitest";
import {
  MachineEventSchema,
  cleanupRpc,
  machineSubscription,
  OfficeEventSchema,
  OfficeSnapshotSchema,
  PostSchema,
  sheetInputRpc,
  sheetSpriteRpc,
  sheetSubscription,
  worldRpc,
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
    worldRpc.name,
  ]).toEqual([
    "office.state",
    "office.post.request",
    "office.update.request",
    "office.delete.request",
    "office.set_wakes_paused.request",
    "office.world.request",
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

test("a snapshot says whether the host can draw 3D, and one without it still parses", () => {
  expect(OfficeSnapshotSchema.parse(emptySnapshot()).render).toBeUndefined();
  expect(
    OfficeSnapshotSchema.parse({ ...emptySnapshot(), render: { available: true } }).render,
  ).toEqual({ available: true });
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
        walk: null,
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

test("a robot's walk has at least one leg, and each leg ends within the walk's time", () => {
  const leg = { x: 10, y: 20, until: 1, key: "walk|idle|#fff|off|#aaa|2", inside: true };
  const walk = { id: 1, ms: 1500, x: 10, y: 90, legs: [leg] };
  const withWalk = (value: unknown) =>
    sheetSubscription.event.safeParse({
      type: "sheet",
      sheet: {
        version: 1,
        tiles: 1,
        width: 780,
        height: 1814,
        ratio: 2,
        scale: 47.4,
        frame: { width: 155, height: 204, chest: { x: 84, y: 107.6 } },
        robots: [{ agentId: "a", key: "k", x: 10, y: 20, phase: 0, walk: value, fresh: false }],
        rooms: [],
        notes: [],
        mentions: [],
      },
    }).success;

  expect(withWalk(walk)).toBe(true);
  expect(withWalk({ ...walk, legs: [] })).toBe(false);
  expect(withWalk({ ...walk, legs: [{ ...leg, until: 0 }] })).toBe(false);
  expect(withWalk({ ...walk, legs: [{ ...leg, until: 1.5 }] })).toBe(false);
  expect(withWalk(undefined)).toBe(false);
});

test("a sheet viewer's size is bounded", () => {
  const colors = Object.fromEntries(
    [
      "surface0",
      "surface1",
      "surface2",
      "border",
      "foreground",
      "foregroundMuted",
      "accent",
      "accentForeground",
      "statusSuccess",
      "statusWarning",
      "statusDanger",
    ].map((name) => [name, "#000"]),
  );
  const input = { width: 390, height: 700, pixelRatio: 2.625, colors };
  expect(sheetSubscription.input.safeParse(input).success).toBe(true);
  expect(sheetSubscription.input.safeParse({ ...input, width: 20_000 }).success).toBe(false);
  expect(sheetSubscription.input.safeParse({ ...input, height: 4097 }).success).toBe(false);
  expect(sheetSubscription.input.safeParse({ ...input, pixelRatio: 9 }).success).toBe(false);
  const resize = { width: 20_000, height: 700, pixelRatio: 2 };
  expect(sheetInputRpc.input.safeParse({ sheetId: "s1", resize }).success).toBe(false);
  expect(
    sheetInputRpc.input.safeParse({ sheetId: "s1", resize: { ...resize, width: 800 } }).success,
  ).toBe(true);
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

test("the host's readings and the cleanup call are named and bounded", () => {
  expect(machineSubscription.name).toBe("office.machine");
  expect(cleanupRpc.name).toBe("office.machine.cleanup.request");
  expect(MachineEventSchema.safeParse({ type: "unavailable" }).success).toBe(true);
  const reading = {
    type: "reading",
    machine: {
      readAt: "2026-11-16T12:00:00.000Z",
      memory: null,
      cpuPercent: null,
      agents: [
        {
          agentId: "a",
          title: null,
          status: "closed",
          rssBytes: 1024,
          processCount: 1,
          ports: [5173],
          idleSince: null,
          forgotten: true,
        },
      ],
    },
  };
  expect(MachineEventSchema.parse(reading)).toEqual(reading);
  expect(cleanupRpc.input.safeParse({ agentIds: [] }).success).toBe(false);
  expect(cleanupRpc.input.safeParse({ agentIds: [""] }).success).toBe(false);
  expect(cleanupRpc.input.safeParse({ agentIds: ["a"] }).success).toBe(true);
  expect(
    cleanupRpc.input.safeParse({ agentIds: Array.from({ length: 51 }, (_v, i) => `a${i}`) })
      .success,
  ).toBe(false);
});
