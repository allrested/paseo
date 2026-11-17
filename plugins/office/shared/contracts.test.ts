import { expect, test } from "vitest";
import {
  ChatMessageSchema,
  ChatRequestSchema,
  ChecklistStepSchema,
  chatRpc,
  MachineEventSchema,
  cleanupRpc,
  clearDoneRpc,
  machineSubscription,
  OfficeEventSchema,
  OfficeSnapshotSchema,
  PostSchema,
  worldRpc,
  deleteRpc,
  incidentsDismissRpc,
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
    incidentsDismissRpc.name,
  ]).toEqual([
    "office.state",
    "office.post.request",
    "office.update.request",
    "office.delete.request",
    "office.set_wakes_paused.request",
    "office.world.request",
    "office.incidents.dismiss.request",
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

test("a snapshot without incidents parses", () => {
  const snapshot = emptySnapshot();
  expect(OfficeSnapshotSchema.parse(snapshot)).toEqual(snapshot);
});

test("a snapshot carries the open incidents and each tracker's state", () => {
  const snapshot = {
    ...emptySnapshot(),
    incidents: {
      open: [
        {
          id: "jira:FPOS-12",
          source: "jira",
          key: "FPOS-12",
          title: "Checkout fails",
          url: "https://example.atlassian.net/browse/FPOS-12",
          createdAt: 1_763_359_200_000,
          foundAt: 1_763_359_500_000,
        },
      ],
      problems: { sentry: "Sentry refused the token: check SENTRY_AUTH_TOKEN" },
      jiraReady: true,
      sentryReady: false,
      scheduleError: null,
    },
  };
  expect(OfficeSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  const unknownSource = structuredClone(snapshot);
  unknownSource.incidents.open[0].source = "linear";
  expect(OfficeSnapshotSchema.safeParse(unknownSource).success).toBe(false);
});

test("dismiss takes some ids or none for all, and answers with a count", () => {
  expect(incidentsDismissRpc.input.parse({})).toEqual({});
  expect(incidentsDismissRpc.input.parse({ ids: ["jira:FPOS-12"] })).toEqual({
    ids: ["jira:FPOS-12"],
  });
  expect(incidentsDismissRpc.output.safeParse({ dismissed: 2 }).success).toBe(true);
  expect(incidentsDismissRpc.output.safeParse({ dismissed: -1 }).success).toBe(false);
  expect(incidentsDismissRpc.output.safeParse({ dismissed: 1.5 }).success).toBe(false);
});

test("a snapshot and an activity event carry checklists, and parse without them", () => {
  const steps = { a1: [{ text: "Run typecheck", status: "in_progress" }] };
  expect(OfficeSnapshotSchema.parse({ ...emptySnapshot(), checklists: steps }).checklists).toEqual(
    steps,
  );
  expect(OfficeSnapshotSchema.parse(emptySnapshot()).checklists).toBeUndefined();
  expect(
    OfficeEventSchema.parse({ type: "activity", activity: {}, checklists: steps }),
  ).toMatchObject({ checklists: steps });
});

test("a step is pending or in progress, never completed", () => {
  expect(ChecklistStepSchema.safeParse({ text: "x", status: "completed" }).success).toBe(false);
});

test("clear done names its RPC and needs a board", () => {
  expect(clearDoneRpc.name).toBe("office.board.clear_done.request");
  expect(clearDoneRpc.input.safeParse({ board: "" }).success).toBe(false);
});

test("the chat call names its RPC and takes each op", () => {
  expect(chatRpc.name).toBe("office.chat.request");
  for (const input of [
    { op: "send", text: "@Alice hi", replyTo: "m1" },
    { op: "send", sticker: 3 },
    { op: "react", id: "m1", emoji: "👍" },
    { op: "vote", id: "m1", index: 0 },
    { op: "rsvp", id: "m1", yes: true },
    { op: "recall", id: "m1" },
  ])
    expect(ChatRequestSchema.safeParse(input).success).toBe(true);
  expect(ChatRequestSchema.safeParse({ op: "send", text: "x".repeat(601) }).success).toBe(false);
  expect(ChatRequestSchema.safeParse({ op: "pin", id: "m1" }).success).toBe(false);
});

test("a snapshot and an event carry the chat, and a snapshot parses without it", () => {
  const message = {
    id: "m1",
    at: 1,
    kind: "text",
    from: "me",
    name: "Boss",
    text: "hi",
    reacts: {},
  };
  const chat = { messages: [message], typing: ["Alice"] };
  expect(OfficeSnapshotSchema.parse({ ...emptySnapshot(), chat }).chat).toEqual(chat);
  expect(OfficeSnapshotSchema.parse(emptySnapshot()).chat).toBeUndefined();
  for (const change of [
    { op: "add", message },
    { op: "update", message },
    { op: "typing", names: [] },
    { op: "all", messages: [message] },
    { op: "act", what: "meeting", id: "a1" },
  ])
    expect(OfficeEventSchema.parse({ type: "chat", change })).toEqual({ type: "chat", change });
});

test("a system line has no sender", () => {
  expect(
    ChatMessageSchema.parse({ id: "s", at: 1, kind: "sys", text: "created", reacts: {} }).from,
  ).toBeUndefined();
});
