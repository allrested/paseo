import { expect, test } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import type { OfficeAgent, OfficeSnapshot } from "../../shared/contracts.js";
import { EMPTY_LAYOUT_MEMORY, layoutOffice } from "../layout.js";
import { buildOfficeModel } from "../model.js";
import { scenePalette } from "./palette.js";
import {
  DESK_OFFSET_Z,
  WALK_MS,
  animationNeed,
  buildScenePlan,
  robotFrame,
  robotPose,
  roomLabel,
  deskPlans,
  type RobotPlan,
} from "./scene-plan.js";

const THEME: PluginTheme = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f6f6f7",
    surface2: "#ececee",
    border: "#dcdce0",
    foreground: "#18181b",
    foregroundMuted: "#71717a",
    accent: "#d97757",
    accentForeground: "#ffffff",
    statusSuccess: "#2f855a",
    statusWarning: "#b7791f",
    statusDanger: "#c53030",
  },
};
const PALETTE = scenePalette(THEME);

function agent(id: string, overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: id,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-11T08:00:00.000Z",
    ...overrides,
  };
}

function plan(agents: readonly OfficeAgent[]) {
  const state: OfficeSnapshot = {
    agents: [...agents],
    workspaces: [{ id: "w1", name: "main", projectName: "paseo" }],
    activity: {},
    boards: {},
    wake: { paused: false, queued: {} },
  };
  const model = buildOfficeModel(state);
  const { layout } = layoutOffice(model, EMPTY_LAYOUT_MEMORY);
  return buildScenePlan(model, layout, PALETTE);
}

function robot(overrides: Partial<RobotPlan>): RobotPlan {
  return {
    agentId: "a",
    roomId: "w1",
    seat: { x: 10, z: 4 },
    seatIndex: 0,
    door: { x: 10, z: 10 },
    side: false,
    pose: "idle",
    visor: "#6cae96",
    light: null,
    screenLit: false,
    ...overrides,
  };
}

const PERMISSION = { id: "r", kind: "tool" as const, title: "Run" };

test("each state maps to its pose", () => {
  expect(robotPose(agent("a", { status: "running" }))).toBe("typing");
  expect(robotPose(agent("a"))).toBe("idle");
  expect(robotPose(agent("a", { status: "running", permissions: [PERMISSION] }))).toBe("raised");
  expect(robotPose(agent("a", { status: "error" }))).toBe("slumped");
  expect(robotPose(agent("a", { status: "initializing" }))).toBe("walking");
});

test("the plan has a robot per seated agent with its light, screen and visor", () => {
  const scene = plan([
    agent("run", { status: "running" }),
    agent("ask", { status: "running", permissions: [PERMISSION] }),
    agent("err", { status: "error" }),
  ]);
  // The visor is the identity colour for a dark surface in a light theme too: heads are graphite.
  expect(
    scene.robots.map((item) => [item.agentId, item.pose, item.light, item.screenLit, item.visor]),
  ).toEqual([
    ["ask", "raised", PALETTE.lightWarning, true, "#6cae96"],
    ["err", "slumped", PALETTE.lightDanger, false, "#6cae96"],
    ["run", "typing", null, true, "#6cae96"],
  ]);
  expect(scene.rooms.map((room) => [room.roomId, room.label])).toEqual([
    ["lobby", "Lobby"],
    ["w1", "main"],
  ]);
});

test("a room label counts the agents without a desk", () => {
  expect(roomLabel("main", 0)).toBe("main");
  expect(roomLabel("main", 6)).toBe("main +6");
});

test("typing bobs the arms unless motion is reduced", () => {
  const typing = robot({ pose: "typing" });
  const moving = robotFrame(typing, 0, 1000, false);
  const still = robotFrame(typing, 0, 1000, true);
  expect(moving.armLeft).not.toBe(moving.armRight);
  expect(still).toEqual({
    x: 10,
    z: 4,
    lift: 0,
    heading: 0,
    lean: 0.08,
    armLeft: -1.2,
    armRight: -1.2,
  });
  // Neighbours type out of step.
  const neighbour = robotFrame(robot({ pose: "typing", seatIndex: 2 }), 0, 1000, false);
  expect(neighbour.armLeft).not.toBe(moving.armLeft);
});

test("a starting agent walks from the door to its desk, or is already there with reduced motion", () => {
  const walker = robot({ pose: "walking" });
  const half = robotFrame(walker, 0, WALK_MS / 2, false);
  expect([half.x, half.z]).toEqual([10, 7]);
  expect(half.heading).toBeCloseTo(Math.PI);
  const arrived = robotFrame(walker, 0, WALK_MS, false);
  expect(arrived).toEqual({ x: 10, z: 4, lift: 0, heading: 0, lean: 0, armLeft: 0, armRight: 0 });
  expect(robotFrame(walker, 0, 0, true)).toEqual(arrived);
});

test("the other poses are fixed", () => {
  expect(robotFrame(robot({ pose: "idle" }), 0, 0, false)).toEqual({
    x: 10,
    z: 4,
    lift: 0,
    heading: 0,
    lean: -0.3,
    armLeft: 0,
    armRight: 0,
  });
  expect(robotFrame(robot({ pose: "raised" }), 0, 0, false)).toEqual({
    x: 10,
    z: 4,
    lift: 0.32,
    heading: 0,
    lean: 0,
    armLeft: 0,
    armRight: Math.PI,
  });
  expect(robotFrame(robot({ pose: "slumped" }), 0, 0, false)).toEqual({
    x: 10,
    z: 4,
    lift: -0.08,
    heading: 0,
    lean: 0.55,
    armLeft: 0.25,
    armRight: 0.25,
  });
});

test("the scene animates smoothly while someone walks, slowly while someone types, else not at all", () => {
  const entered = new Map([["w", 0]]);
  const walker = robot({ agentId: "w", pose: "walking" });
  const typist = robot({ agentId: "t", pose: "typing" });
  expect(animationNeed([walker, typist], entered, WALK_MS / 2, false)).toBe("smooth");
  expect(animationNeed([walker, typist], entered, WALK_MS, false)).toBe("typing");
  expect(animationNeed([robot({})], entered, 0, false)).toBe("none");
  expect(animationNeed([walker, typist], entered, 0, true)).toBe("none");
});

test("every room has a desk at each main seat of its rows, plus a side desk per seated child", () => {
  const scene = plan([agent("a", { status: "running" }), agent("c", { parentAgentId: "a" })]);
  const desks = deskPlans(scene);
  // The lobby and the room have one row of four desks each.
  expect(desks).toHaveLength(2 * 4 + 1);
  const parent = scene.robots.find((item) => item.agentId === "a");
  expect(desks.filter((desk) => desk.screenLit)).toEqual([
    { x: parent?.seat.x, z: (parent?.seat.z ?? 0) + DESK_OFFSET_Z, screenLit: true },
  ]);
});

test("a room that needs a second row gets its desks, and the plan says how deep each room is", () => {
  const five = ["a", "b", "c", "d", "e"].map((id) => agent(id));
  const scene = plan(five);
  expect(scene.rooms.map((room) => [room.roomId, room.rows, room.depth])).toEqual([
    ["lobby", 1, 6],
    ["w1", 2, 8.5],
  ]);
  expect(deskPlans(scene)).toHaveLength(4 + 8);
  expect(scene.columns).toBe(2);
});
