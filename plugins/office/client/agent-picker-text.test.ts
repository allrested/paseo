import { expect, test } from "vitest";
import type { OfficeAgent, OfficeSnapshot } from "../shared/contracts.js";
import {
  NOBODY,
  choiceLabel,
  closeStep,
  keptChoice,
  pickerGroups,
  sheetLeavesFirstOn,
  showsSearch,
} from "./agent-picker-text.js";
import { buildOfficeModel, type OfficeRoom } from "./model.js";

function agent(id: string, patch: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: `Agent ${id}`,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: `2026-11-16T00:00:${id.padStart(2, "0")}Z`,
    ...patch,
  };
}

function rooms(agents: OfficeAgent[]): OfficeRoom[] {
  const snapshot: OfficeSnapshot = {
    agents,
    workspaces: [
      { id: "w1", name: "shop-api", projectName: "shop" },
      { id: "w2", name: "landing", projectName: "site" },
    ],
    activity: {},
    doing: {},
    boards: {},
    wake: { paused: false, queued: {} },
  };
  return buildOfficeModel(snapshot).rooms;
}

const permission = { id: "p1", kind: "tool" as const, title: "Run a command" };

function ids(all: OfficeRoom[], roomId: string, query: string): string[] {
  return pickerGroups(all, roomId, query).flatMap((group) => group.rows.map((row) => row.agentId));
}

test("the room's own agents come first, then the others in the office's order", () => {
  const all = rooms([
    agent("1", { workspaceId: null, permissions: [permission], status: "running" }),
    agent("2"),
    agent("3", { workspaceId: "w2", status: "running" }),
    agent("4", { status: "error" }),
    agent("5", { status: "initializing" }),
  ]);
  expect(pickerGroups(all, "w1", "")).toEqual([
    {
      label: "This room",
      rows: [
        { agentId: "2", title: "Agent 2", detail: "shop-api · Idle", tone: "idle" },
        { agentId: "4", title: "Agent 4", detail: "shop-api · Error", tone: "danger" },
        { agentId: "5", title: "Agent 5", detail: "shop-api · Starting", tone: "starting" },
      ],
    },
    {
      label: "Other rooms",
      rows: [
        { agentId: "1", title: "Agent 1", detail: "Lobby · Needs permission", tone: "warning" },
        { agentId: "3", title: "Agent 3", detail: "landing · Running", tone: "running" },
      ],
    },
  ]);
});

test("the lobby's board has the lobby's agents as its own", () => {
  const all = rooms([agent("1", { workspaceId: null }), agent("2")]);
  expect(pickerGroups(all, "lobby", "").map((group) => group.label)).toEqual([
    "This room",
    "Other rooms",
  ]);
  expect(ids(all, "lobby", "")).toEqual(["1", "2"]);
});

test("a room without agents of its own has only the others, and an empty office has no group", () => {
  const all = rooms([agent("1")]);
  expect(pickerGroups(all, "w2", "").map((group) => group.label)).toEqual(["Other rooms"]);
  expect(pickerGroups(rooms([]), "w1", "")).toEqual([]);
});

test("a search keeps the agents whose title or room has the words, without case", () => {
  const all = rooms([
    agent("1", { title: "Fix checkout" }),
    agent("2", { title: "Write docs", workspaceId: "w2" }),
    agent("3", { title: "Landing copy", workspaceId: null }),
  ]);
  expect(ids(all, "w1", "CHECK")).toEqual(["1"]);
  // One by its title, in the lobby, and one by its room.
  expect(ids(all, "w1", " landing ")).toEqual(["3", "2"]);
  expect(pickerGroups(all, "w1", "nothing")).toEqual([]);
});

test("the search field shows from nine agents", () => {
  const some = (count: number) =>
    rooms(Array.from({ length: count }, (_, index) => agent(String(index + 1))));
  expect(showsSearch(some(8))).toBe(false);
  expect(showsSearch(some(9))).toBe(true);
});

test("a chosen agent that left, or closed, is nobody again", () => {
  const all = rooms([agent("1", { title: "Builder" }), agent("2", { status: "closed" })]);
  expect(keptChoice("1", all)).toBe("1");
  expect(keptChoice("2", all)).toBe(NOBODY);
  expect(keptChoice("gone", all)).toBe(NOBODY);
  expect(keptChoice(NOBODY, all)).toBe(NOBODY);
  expect(choiceLabel("1", all)).toBe("Builder");
  expect(choiceLabel(NOBODY, all)).toBe("Nobody");
  expect(choiceLabel("gone", all)).toBe("Nobody");
});

test("a close goes back from the page when the sheet stays, and closes when it has left", () => {
  expect(closeStep(true, false)).toBe("back");
  expect(closeStep(true, true)).toBe("close");
  expect(closeStep(false, false)).toBe("close");
  expect(closeStep(false, true)).toBe("close");
});

test("only the web's wide dialog stays when it reports a close", () => {
  expect(sheetLeavesFirstOn(false, "web")).toBe(false);
  expect(sheetLeavesFirstOn(true, "web")).toBe(true);
  expect(sheetLeavesFirstOn(true, "ios")).toBe(true);
  expect(sheetLeavesFirstOn(false, "android")).toBe(true);
  expect(sheetLeavesFirstOn(false, "ios")).toBe(true);
});
