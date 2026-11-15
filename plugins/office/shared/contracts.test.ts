import { expect, test } from "vitest";
import {
  MachineEventSchema,
  cleanupRpc,
  machineSubscription,
  OfficeEventSchema,
  PostSchema,
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
