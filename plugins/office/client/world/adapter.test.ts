import { describe, expect, it } from "vitest";
import type { ActivityStep, OfficeAgent, OfficeSnapshot } from "../../shared/contracts.js";
import { buildOfficeModel } from "../model.js";
import {
  PLAN_DESKS,
  type WorldMemory,
  type WorldPeople,
  boardRoom,
  floorNote,
  isDarkTheme,
  teamOfRoom,
  worldBoardRows,
  worldBrand,
  worldChanges,
  worldMachine,
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

    const { sessions, overflow } = worldPeople(model, PLAN_DESKS.pro);

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

    const { sessions, overflow } = worldPeople(model, PLAN_DESKS.cozy);

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

    const rows = worldBoardRows(model, worldPeople(model, PLAN_DESKS.pro).sessions);

    expect(rows).toEqual([
      { id: "3", name: "Agent 3", text: "Waiting for your answer", state: "wait" },
      { id: "4", name: "Agent 4", text: "Stopped on an error", state: "done" },
      { id: "1", name: "Agent 1", text: "Running Bash", state: "doing" },
      { id: "2", name: "Agent 2", text: "Resting", state: "done" },
    ]);
  });

  it("seats an agent that waits on sub-agents as at work, and the board says on how many", () => {
    const model = buildOfficeModel(
      office([
        agent("1"),
        agent("2", { parentAgentId: "1", status: "running" }),
        agent("3", { parentAgentId: "1", status: "initializing" }),
        agent("4"),
      ]),
    );

    const { sessions } = worldPeople(model, PLAN_DESKS.pro);

    expect(sessions.map((session) => [session.id, session.status, session.waitingOn])).toEqual([
      ["1", "work", 2],
      ["2", "work", undefined],
      ["3", "work", undefined],
      ["4", "rest", undefined],
    ]);
    expect(worldBoardRows(model, sessions).find((row) => row.id === "1")).toEqual({
      id: "1",
      name: "Agent 1",
      text: "Waiting on 2 sub-agents",
      state: "doing",
    });
  });

  it("gives a person the context of their agent, when its provider says it", () => {
    const model = buildOfficeModel(
      office([agent("1", { context: { usedTokens: 164_000, maxTokens: 200_000 } }), agent("2")]),
    );

    const { sessions } = worldPeople(model, PLAN_DESKS.pro);

    expect(sessions[0]?.usage).toEqual({ ctx: 164_000, ctxMax: 200_000 });
    expect(sessions[1]).not.toHaveProperty("usage");
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
    worldPeople(buildOfficeModel(office(agents, {}, doing)), PLAN_DESKS.pro);
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

  it("sends an agent that turns busy with a sub-agent to wait at its desk, with no prompt", () => {
    const sub = (status: OfficeAgent["status"]) => agent("2", { parentAgentId: "1", status });
    const resting = people([agent("1"), sub("idle")]);
    const waiting = people([agent("1"), sub("running")]);
    const running = people([agent("1", { status: "running" }), sub("running")]);
    const eventsOf = (before: WorldPeople | null, now: WorldPeople) =>
      worldEvents(before === null ? null : rememberPeople(before), now).filter(
        (event) => event.sess === "1",
      );

    // A sub-agent starts while its parent rests: the parent waits at its desk. Nobody sent it a
    // prompt, so none is carried to it.
    expect(eventsOf(resting, waiting)).toEqual([{ sess: "1", type: "subwait" }]);
    // The parent's own turn ends while its sub-agent runs: it waits, and reports nothing yet.
    expect(eventsOf(running, waiting)).toEqual([{ sess: "1", type: "subwait" }]);
    // Said at once to whoever opens the office, and once.
    expect(eventsOf(null, waiting)).toEqual([{ sess: "1", type: "subwait" }]);
    expect(eventsOf(waiting, waiting)).toEqual([]);
    // The last sub-agent ends: the turn is reported, as at any turn's end.
    expect(eventsOf(waiting, resting)).toEqual([{ sess: "1", type: "stop" }]);
    // The parent runs again while it waited: that is a turn, and its prompt is carried.
    expect(eventsOf(waiting, running)).toEqual([{ sess: "1", type: "prompt" }]);
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

  it("carries the paper to the shredder when a context empties", () => {
    const at = (usedTokens: number, patch: Partial<OfficeAgent> = {}) =>
      people([agent("1", { context: { usedTokens, maxTokens: 200_000 }, ...patch })]);
    const full = rememberPeople(at(164_000));

    expect(worldEvents(full, at(30_000))).toEqual([{ sess: "1", type: "compact" }]);
    expect(worldEvents(full, at(0))).toEqual([{ sess: "1", type: "compact" }]);
    // A turn that starts with the compaction: the prompt comes first.
    expect(worldEvents(full, at(30_000, { status: "running" }))).toEqual([
      { sess: "1", type: "prompt" },
      { sess: "1", type: "compact" },
    ]);
    // Told once.
    expect(worldEvents(rememberPeople(at(30_000), full), at(30_000))).toEqual([]);
  });

  it("says nothing of a context that grows, shrinks a little or was never known", () => {
    const at = (usedTokens: number) =>
      people([agent("1", { context: { usedTokens, maxTokens: 200_000 } })]);

    expect(worldEvents(rememberPeople(at(100_000)), at(164_000))).toEqual([]);
    expect(worldEvents(rememberPeople(at(164_000)), at(120_000))).toEqual([]);
    // Half of little is not a compaction.
    expect(worldEvents(rememberPeople(at(16_000)), at(2000))).toEqual([]);
    expect(worldEvents(rememberPeople(people([agent("1")])), at(2000))).toEqual([]);
    expect(worldEvents(rememberPeople(at(164_000)), people([agent("1")]))).toEqual([]);
    expect(worldEvents(null, at(2000))).toEqual([]);
  });

  it("sends an agent at a skill to upstream's skill action, at the library", () => {
    const running = [agent("1", { status: "running" })];
    expect(worldEvents(null, people(running, { "1": step("skill") }))).toEqual([
      { sess: "1", type: "skill" },
    ]);
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

  it("walks once for a step that is reported for one read, and again for the next", () => {
    const running = [agent("1", { status: "running" })];
    const searched = people(running, { "1": step("web", "w1") });

    expect(worldEvents(null, searched)).toEqual([{ sess: "1", type: "web" }]);
    // The read after it has no step: no news, and nothing held against the next call.
    const told = rememberPeople(searched);
    expect(worldEvents(told, people(running))).toEqual([]);
    const moved = rememberPeople(people(running), told);
    expect(worldEvents(moved, people(running, { "1": step("web", "w2") }))).toEqual([
      { sess: "1", type: "web" },
    ]);
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
      // (a deploy that starts is a command; its end is the rocket's)
      "bash",
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

  it("tells a deploy as a command when it starts, and launches the rocket when it succeeds", () => {
    const running = [agent("1", { status: "running" })];
    const deploying = people(running, { "1": step("deploy", "d1") });
    const ended = (result: "passed" | "failed") =>
      people(running, { "1": { kind: "deploy", key: "d1", result } });

    expect(worldEvents(null, deploying)).toEqual([{ sess: "1", type: "bash" }]);
    const told = rememberPeople(deploying);
    // Still running: no news.
    expect(worldEvents(told, deploying)).toEqual([]);
    expect(worldEvents(told, ended("passed"))).toEqual([{ sess: "1", type: "deploy" }]);
    expect(worldEvents(told, ended("failed"))).toEqual([{ sess: "1", type: "fail", of: "deploy" }]);
    // Told once.
    expect(worldEvents(rememberPeople(ended("passed"), told), ended("passed"))).toEqual([]);
    // A deploy first seen after it ended is only its end.
    expect(worldEvents(null, ended("passed"))).toEqual([{ sess: "1", type: "deploy" }]);
    expect(worldEvents(null, ended("failed"))).toEqual([{ sess: "1", type: "fail", of: "deploy" }]);
  });

  it("says nothing of a deploy that was cancelled or never seen to end", () => {
    const running = [agent("1", { status: "running" })];
    const told = rememberPeople(people(running, { "1": step("deploy", "d1") }));

    expect(worldEvents(told, people(running, { "1": step("edit", "c2") }))).toEqual([
      { sess: "1", type: "edit" },
    ]);
    expect(worldEvents(told, people(running))).toEqual([]);
    expect(worldEvents(told, people([agent("1")]))).toEqual([{ sess: "1", type: "stop" }]);
    // The next deploy is told again.
    const moved = rememberPeople(people(running, { "1": step("edit", "c2") }), told);
    expect(worldEvents(moved, people(running, { "1": step("deploy", "d2") }))).toEqual([
      { sess: "1", type: "bash" },
    ]);
  });

  it("sends a plain push as a push: the applause, and no rocket", () => {
    const running = [agent("1", { status: "running" })];
    expect(worldEvents(null, people(running, { "1": step("push") }))).toEqual([
      { sess: "1", type: "push" },
    ]);
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

describe("the host's readings, as the scene draws them", () => {
  const GB = 1024 ** 3;
  const held = (agentId: string, patch: object = {}) => ({
    agentId,
    title: `Agent ${agentId}`,
    status: "running" as const,
    rssBytes: 1,
    processCount: 1,
    ports: [] as number[],
    idleSince: null,
    forgotten: false,
    ...patch,
  });
  const reading = (usedGb: number, agents: ReturnType<typeof held>[] = []) => ({
    readAt: "2026-11-16T12:00:00.000Z",
    memory: { usedBytes: usedGb * GB, totalBytes: 16 * GB },
    cpuPercent: 12,
    agents,
  });

  it("has no machine without a reading", () => {
    expect(worldMachine(null)).toBeNull();
  });

  it("gives the wall screen memory and CPU, critical from 90 percent", () => {
    expect(worldMachine(reading(8))).toEqual({
      mem: { used: 8 * GB, total: 16 * GB, pressure: "normal" },
      cpu: { percent: 12 },
      devServers: [],
    });
    expect(worldMachine(reading(15))?.mem?.pressure).toBe("critical");
    expect(worldMachine({ ...reading(8), memory: null, cpuPercent: null })).toEqual({
      mem: null,
      cpu: { percent: 0 },
      devServers: [],
    });
  });

  it("draws a box for each agent with a port open, and for whatever was left running", () => {
    const machine = worldMachine(
      reading(8, [
        held("a", { ports: [5173, 3000] }),
        held("b"),
        held("c", { status: "closed", forgotten: true }),
        held("d", { status: "idle", forgotten: true, ports: [8000], title: null }),
      ]),
    );
    expect(machine?.devServers).toEqual([
      { owner: { alive: true, sid: "a" }, label: "Agent a", ports: [5173, 3000], cpu: 0 },
      { owner: { alive: false, sid: "c" }, label: "Agent c", ports: [], cpu: 0 },
      { owner: { alive: false, sid: "d" }, label: "Agent d", ports: [8000], cpu: 0 },
    ]);
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

describe("floorNote", () => {
  it("says an empty office is empty, and who has no desk on a full floor", () => {
    expect(floorNote(0, 0)).toBe("No agents on this host yet. One that starts takes a desk here.");
    expect(floorNote(5, 0)).toBe(null);
    expect(floorNote(13, 1)).toBe("1 agent has no desk on this floor. The list shows everyone.");
    expect(floorNote(15, 3)).toBe("3 agents have no desk on this floor. The list shows everyone.");
  });
});

describe("the lobby's sign", () => {
  it("shows the host's brand, and the product's name where it has none", () => {
    const logoUrl = "https://office.example/_brand/logo.svg";
    expect(worldBrand({ name: "Flavours", logoUrl })).toEqual({ name: "Flavours", logoUrl });
    expect(worldBrand({ name: null, logoUrl })).toEqual({ name: "Paseo", logoUrl });
    expect(worldBrand(null)).toEqual({ name: "Paseo", logoUrl: null });
  });
});
