import { describe, expect, it } from "vitest";
import type { ActivityStep, OfficeAgent, OfficeSnapshot } from "../../shared/contracts.js";
import { buildOfficeModel } from "../model.js";
import {
  PLAN_DESKS,
  type WorldMemory,
  type WorldPeople,
  boardRoom,
  isDarkTheme,
  teamOfRoom,
  worldBoardRows,
  worldChanges,
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

function office(
  agents: OfficeAgent[],
  activity: Record<string, string> = {},
  doing: Record<string, ActivityStep> = {},
): OfficeSnapshot {
  return {
    agents,
    workspaces: [
      { id: "w1", name: "shop-api", projectName: "shop" },
      { id: "w2", name: "landing", projectName: "site" },
    ],
    activity,
    doing,
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
  const people = (agents: OfficeAgent[], doing: Record<string, ActivityStep> = {}) =>
    worldPeople(buildOfficeModel(office(agents, {}, doing)), "pro");
  const step = (kind: ActivityStep["kind"], key = "c1"): ActivityStep => ({ kind, key });
  const worldEvents = (before: WorldMemory | null, now: WorldPeople) =>
    worldChanges(before, now).events;
  /** What the scene knows after it was shown these people. */
  const rememberPeople = (shown: WorldPeople, before: WorldMemory | null = null) =>
    worldChanges(before, shown).memory;

  it("says nothing of a state the first time, and nothing of a newcomer's", () => {
    const now = people([agent("1", { status: "running" })]);

    expect(worldEvents(null, now)).toEqual([]);
    expect(worldEvents(rememberPeople(people([])), now)).toEqual([]);
  });

  it("carries a prompt when a turn starts and reports when it ends", () => {
    const resting = rememberPeople(people([agent("1")]));
    const working = people([agent("1", { status: "running" })]);

    expect(worldEvents(resting, working)).toEqual([{ sess: "1", type: "prompt" }]);
    expect(worldEvents(rememberPeople(working), people([agent("1")]))).toEqual([
      { sess: "1", type: "stop" },
    ]);
  });

  it("is a failure when an agent ends in an error, once", () => {
    const working = rememberPeople(people([agent("1", { status: "running" })]));
    const failed = people([agent("1", { status: "error" })]);

    expect(worldEvents(working, failed)).toEqual([{ sess: "1", type: "fail" }]);
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

  it("sends a working agent to the place of each new tool call", () => {
    const running = [agent("1", { status: "running" })];
    const reading = people(running, { "1": step("read") });

    // What an agent is at is shown at once, to whoever opens the office and for a newcomer.
    expect(worldEvents(null, reading)).toEqual([{ sess: "1", type: "read" }]);
    expect(worldEvents(rememberPeople(people([])), reading)).toEqual([{ sess: "1", type: "read" }]);
    // The same call seen again is no news; the next call of the same tool is.
    expect(worldEvents(rememberPeople(reading), reading)).toEqual([]);
    expect(
      worldEvents(rememberPeople(reading), people(running, { "1": step("read", "c2") })),
    ).toEqual([{ sess: "1", type: "read" }]);
    // No step (the agent writes or thinks) is no news either: the person goes back by itself.
    expect(worldEvents(rememberPeople(reading), people(running))).toEqual([]);
  });

  it("tells a step again after the agent was at none, for a provider that numbers no calls", () => {
    const running = [agent("1", { status: "running" })];
    const reading = people(running, { "1": step("read", "read") });
    const thinking = rememberPeople(people(running), rememberPeople(reading));

    expect(worldEvents(thinking, reading)).toEqual([{ sess: "1", type: "read" }]);
  });

  it("names each kind of work as the scene knows it", () => {
    const running = [agent("1", { status: "running" })];
    const typeOf = (kind: ActivityStep["kind"]) =>
      worldEvents(null, people(running, { "1": step(kind) }))[0]?.type;

    expect(
      (
        [
          "read",
          "search",
          "edit",
          "write",
          "command",
          "web",
          "tool",
          "subagent",
          "plan",
          "test",
          "commit",
          "push",
          "deploy",
        ] as const
      ).map(typeOf),
    ).toEqual([
      "read",
      "grep",
      "edit",
      "write",
      "bash",
      "web",
      "mcp",
      "agent",
      "plan",
      "test",
      "commit",
      "push",
      "deploy",
    ]);
  });

  it("carries the prompt first when a turn starts at a tool, and says no step of who waits", () => {
    const resting = rememberPeople(people([agent("1")]));
    const started = people([agent("1", { status: "running" })], { "1": step("command") });

    expect(worldEvents(resting, started)).toEqual([
      { sess: "1", type: "prompt" },
      { sess: "1", type: "bash" },
    ]);
    const waiting = people([agent("1", { status: "running", permissions: [permission] })], {
      "1": step("command", "c2"),
    });
    expect(worldEvents(rememberPeople(started), waiting)).toEqual([]);
    // The approval was for that call: once given, the person goes to it.
    const approved = people([agent("1", { status: "running" })], { "1": step("command", "c2") });
    expect(worldEvents(rememberPeople(waiting, rememberPeople(started)), approved)).toEqual([
      { sess: "1", type: "bash" },
    ]);
  });

  it("tells a test run when it starts and how it ended", () => {
    const running = [agent("1", { status: "running" })];
    const testing = people(running, { "1": step("test", "t1") });
    const ended = (result: "passed" | "failed") =>
      people(running, { "1": { kind: "test", key: "t1", result } });

    expect(worldEvents(null, testing)).toEqual([{ sess: "1", type: "test" }]);
    const told = rememberPeople(testing);
    expect(worldEvents(told, ended("passed"))).toEqual([{ sess: "1", type: "testok" }]);
    expect(worldEvents(told, ended("failed"))).toEqual([{ sess: "1", type: "testfail" }]);
    // Told once.
    expect(worldEvents(rememberPeople(ended("passed"), told), ended("passed"))).toEqual([]);
    // A run first seen after it ended is only its result.
    expect(worldEvents(null, ended("failed"))).toEqual([{ sess: "1", type: "testfail" }]);
  });

  it("puts out the lamp of a test run whose end was never seen", () => {
    const running = [agent("1", { status: "running" })];
    const told = rememberPeople(people(running, { "1": step("test", "t1") }));

    expect(worldEvents(told, people(running, { "1": step("edit", "c2") }))).toEqual([
      { sess: "1", type: "testend" },
      { sess: "1", type: "edit" },
    ]);
    expect(worldEvents(told, people(running))).toEqual([{ sess: "1", type: "testend" }]);
    expect(worldEvents(told, people([agent("1")]))).toEqual([
      { sess: "1", type: "stop" },
      { sess: "1", type: "testend" },
    ]);
    // While the agent waits on the same call, the run goes on.
    const waiting = people([agent("1", { status: "running", permissions: [permission] })], {
      "1": step("test", "t1"),
    });
    expect(worldEvents(told, waiting)).toEqual([]);
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
