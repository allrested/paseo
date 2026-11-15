import { describe, expect, it } from "vitest";
import type { OfficeAgent, OfficeSnapshot } from "../../shared/contracts.js";
import { buildOfficeModel } from "../model.js";
import {
  PLAN_DESKS,
  boardRoom,
  isDarkTheme,
  rememberPeople,
  teamOfRoom,
  worldBoardRows,
  worldEvents,
  worldPeople,
} from "./adapter.js";

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

function office(agents: OfficeAgent[], activity: Record<string, string> = {}): OfficeSnapshot {
  return {
    agents,
    workspaces: [
      { id: "w1", name: "shop-api", projectName: "shop" },
      { id: "w2", name: "landing", projectName: "site" },
    ],
    activity,
    boards: {},
    wake: { paused: false, queued: {} },
  };
}

const permission = { id: "p1", kind: "tool" as const, title: "Run a command" };

describe("the office's agents as the scene's people", () => {
  it("seats a workspace's agents as one team and says what each is doing", () => {
    const model = buildOfficeModel(
      office([
        agent("1", { status: "running" }),
        agent("2", { permissions: [permission], status: "running" }),
        agent("3", { status: "error" }),
        agent("4", { workspaceId: "w2", provider: "codex", status: "initializing" }),
        agent("5", { workspaceId: null }),
      ]),
    );

    const { sessions, overflow } = worldPeople(model, "pro");

    expect(overflow).toBe(0);
    expect(sessions.map((s) => [s.id, s.git.repo, s.status, s.stuck, s.agent])).toEqual([
      ["5", "Lobby", "rest", false, "claude"],
      ["1", "shop-api", "work", false, "claude"],
      ["2", "shop-api", "wait", false, "claude"],
      ["3", "shop-api", "rest", true, "claude"],
      ["4", "landing", "work", false, "codex"],
    ]);
    expect(sessions[1]).toMatchObject({ name: "Agent 1", title: "Agent 1", dir: "shop-api" });
  });

  it("keeps who needs the user and who works when the desks run out", () => {
    const resting = Array.from({ length: PLAN_DESKS.cozy }, (_, index) => agent(String(index + 1)));
    const model = buildOfficeModel(
      office([
        ...resting,
        agent("20", { status: "running" }),
        agent("21", { permissions: [permission] }),
      ]),
    );

    const { sessions, overflow } = worldPeople(model, "cozy");

    expect(overflow).toBe(2);
    expect(sessions).toHaveLength(PLAN_DESKS.cozy);
    expect(sessions.map((s) => s.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "20", "21"]);
  });

  it("writes the whiteboard from the people at a desk, who needs the user first", () => {
    const model = buildOfficeModel(
      office(
        [
          agent("1", { status: "running" }),
          agent("2"),
          agent("3", { permissions: [permission] }),
          agent("4", { status: "error" }),
        ],
        { "1": "Running Bash" },
      ),
    );

    const rows = worldBoardRows(model, worldPeople(model, "pro").sessions);

    expect(rows).toEqual([
      { id: "3", name: "Agent 3", text: "Waiting for your answer", state: "wait" },
      { id: "4", name: "Agent 4", text: "Stopped on an error", state: "done" },
      { id: "1", name: "Agent 1", text: "Running Bash", state: "doing" },
      { id: "2", name: "Agent 2", text: "Resting", state: "done" },
    ]);
  });

  it("names a room's team, and nothing for a room that is gone", () => {
    const model = buildOfficeModel(office([agent("1")]));

    expect(teamOfRoom(model, "w1")).toBe("shop-api");
    expect(teamOfRoom(model, "lobby")).toBe("Lobby");
    expect(teamOfRoom(model, "w9")).toBeNull();
    expect(teamOfRoom(model, null)).toBeNull();
  });
});

describe("what changed, as things the people do", () => {
  const people = (agents: OfficeAgent[]) =>
    worldPeople(buildOfficeModel(office(agents)), "pro").sessions;

  it("says nothing the first time, and nothing about a newcomer", () => {
    const now = people([agent("1", { status: "running" })]);

    expect(worldEvents(null, now)).toEqual([]);
    expect(worldEvents(rememberPeople([]), now)).toEqual([]);
  });

  it("carries a prompt when a turn starts and reports when it ends", () => {
    const resting = rememberPeople(people([agent("1"), agent("2", { status: "running" })]));
    const next = people([agent("1", { status: "running" }), agent("2")]);

    expect(worldEvents(resting, next)).toEqual([
      { sess: "1", type: "prompt", label: "" },
      { sess: "2", type: "stop", label: "" },
    ]);
  });

  it("is a failure when an agent ends in an error, once", () => {
    const working = rememberPeople(people([agent("1", { status: "running" })]));
    const failed = people([agent("1", { status: "error" })]);

    expect(worldEvents(working, failed)).toEqual([
      { sess: "1", type: "fail", label: "the agent stopped" },
    ]);
    expect(worldEvents(rememberPeople(failed), failed)).toEqual([]);
  });

  it("says nothing while an agent waits for an answer and then goes on", () => {
    const working = rememberPeople(people([agent("1", { status: "running" })]));
    const waiting = people([agent("1", { status: "running", permissions: [permission] })]);

    expect(worldEvents(working, waiting)).toEqual([]);
    expect(
      worldEvents(rememberPeople(waiting), people([agent("1", { status: "running" })])),
    ).toEqual([]);
  });
});

describe("which room's board a tap in the scene opens", () => {
  const model = buildOfficeModel(
    office([agent("1"), agent("2", { workspaceId: "w2" }), agent("3", { workspaceId: "w2" })]),
  );

  it("opens the board of the team whose chip was chosen", () => {
    expect(boardRoom(model, { project: "landing", focusRoomId: "w1", selectedAgentId: "1" })).toBe(
      "w2",
    );
    expect(boardRoom(model, { project: "gone", focusRoomId: "w1", selectedAgentId: null })).toBe(
      null,
    );
  });

  it("opens the tab's room for the whiteboard, then the chosen agent's, then the lobby", () => {
    expect(boardRoom(model, { project: null, focusRoomId: "w2", selectedAgentId: "1" })).toBe("w2");
    expect(boardRoom(model, { project: null, focusRoomId: null, selectedAgentId: "3" })).toBe("w2");
    expect(boardRoom(model, { project: null, focusRoomId: "closed", selectedAgentId: null })).toBe(
      "lobby",
    );
  });

  it("opens nothing in an empty office", () => {
    const empty = buildOfficeModel(office([]));
    expect(
      boardRoom(
        { ...empty, rooms: [] },
        { project: null, focusRoomId: null, selectedAgentId: null },
      ),
    ).toBe(null);
  });
});

describe("day and night", () => {
  it("draws the office by night under a dark theme", () => {
    expect(isDarkTheme({ surface0: "#101012" })).toBe(true);
    expect(isDarkTheme({ surface0: "#F7F5F0" })).toBe(false);
  });
});
