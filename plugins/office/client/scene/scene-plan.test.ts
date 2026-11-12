import { expect, test } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import type { OfficeAgent, OfficeSnapshot } from "../../shared/contracts.js";
import { EMPTY_LAYOUT_MEMORY, layoutOffice } from "../layout.js";
import { buildOfficeModel } from "../model.js";
import { scenePalette, sceneVisor, visorColor } from "./palette.js";
import {
  DESK_OFFSET_Z,
  WALK_MS,
  WAVE_MS,
  animationNeed,
  buildScenePlan,
  overflowTail,
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
    lamp: "off",
    lampColor: "#8a8a8a",
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

test("the plan has a robot per seated agent with its lamp, screen and visor", () => {
  const scene = plan([
    agent("run", { status: "running" }),
    agent("ask", { status: "running", permissions: [PERMISSION] }),
    agent("err", { status: "error" }),
    agent("new", { status: "initializing" }),
    agent("off"),
  ]);
  // One lamp each, four states. Only a typing robot's desk is lit: one that waits for an answer
  // is not working, and its amber lamp is the light at that desk.
  expect(
    scene.robots.map((item) => [
      item.agentId,
      item.pose,
      item.lamp,
      item.lampColor,
      item.screenLit,
    ]),
  ).toEqual([
    ["ask", "raised", "warning", PALETTE.lightWarning, false],
    ["err", "slumped", "danger", PALETTE.lightDanger, false],
    ["new", "walking", "off", PALETTE.lampOff, false],
    ["off", "idle", "off", PALETTE.lampOff, false],
    ["run", "typing", "steady", PALETTE.lampOn, true],
  ]);
  // The visor is the identity colour for a dark surface in a light theme too: heads are graphite.
  expect(new Set(scene.robots.map((item) => item.visor))).toEqual(new Set(["#6cae96"]));
  expect(scene.rooms.map((room) => [room.roomId, room.label, room.overflow])).toEqual([
    ["lobby", "Lobby", 0],
    ["w1", "main", 0],
  ]);
});

test("a room label says in words how many agents have no desk", () => {
  expect(roomLabel("main", 0)).toBe("main");
  expect(roomLabel("main", 6)).toBe("main, 6 more");
  // The count is the label's tail, so a plate can shorten the name and keep the count.
  expect(overflowTail(0)).toBe("");
  expect(roomLabel("main", 6).endsWith(overflowTail(6))).toBe(true);
});

test("typing bobs the arms and sways the head unless motion is reduced", () => {
  const typing = robot({ pose: "typing" });
  const moving = robotFrame(typing, 0, 1000, false);
  const still = robotFrame(typing, 0, 1000, true);
  expect(moving.armLeft).not.toBe(moving.armRight);
  expect(moving.nod).not.toBe(still.nod);
  // It looks down at its desk.
  expect(still).toEqual({
    x: 10,
    z: 4,
    lift: 0,
    heading: 0,
    lean: 0.08,
    nod: 0.2,
    tilt: 0,
    armLeft: -1.2,
    armRight: -1.2,
    armSway: 0,
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
  expect(arrived).toEqual({
    x: 10,
    z: 4,
    lift: 0,
    heading: 0,
    lean: 0,
    nod: 0,
    tilt: 0,
    armLeft: 0,
    armRight: 0,
    armSway: 0,
  });
  expect(robotFrame(walker, 0, 0, true)).toEqual(arrived);
});

test("the other poses are fixed", () => {
  expect(robotFrame(robot({ pose: "idle" }), 0, 0, false)).toEqual({
    x: 10,
    z: 4,
    lift: 0,
    heading: 0,
    lean: -0.3,
    nod: -0.1,
    tilt: 0.16,
    armLeft: 0,
    armRight: 0,
    armSway: 0,
  });
  // Desk by desk the resting heads lie to the other side, so a quiet room is not one stamp.
  expect(robotFrame(robot({ pose: "idle", seatIndex: 1 }), 0, 0, false).tilt).toBe(0.16);
  expect(robotFrame(robot({ pose: "idle", seatIndex: 2 }), 0, 0, false).tilt).toBe(-0.16);
  expect(robotFrame(robot({ pose: "raised" }), 0, 0, false)).toEqual({
    x: 10,
    z: 4,
    lift: 0.32,
    heading: 0,
    lean: 0,
    nod: 0,
    tilt: 0,
    armLeft: 0,
    armRight: Math.PI,
    armSway: 0,
  });
  expect(robotFrame(robot({ pose: "slumped" }), 0, 0, false)).toEqual({
    x: 10,
    z: 4,
    lift: -0.08,
    heading: 0,
    lean: 0.55,
    nod: 0.3,
    tilt: 0.3,
    armLeft: 0.25,
    armRight: 0.25,
    armSway: 0,
  });
});

test("a robot that starts to wait waves once, then holds its hand still", () => {
  const waiting = robot({ pose: "raised" });
  const began = 5000;
  const still = { ...robotFrame(waiting, 0, began, false, began) };
  expect(still.armSway).toBe(0);
  // A quarter of the way in, the raised arm is out to one side; nothing else moves.
  const early = robotFrame(waiting, 0, began + WAVE_MS / 4, false, began);
  expect(Math.abs(early.armSway)).toBeGreaterThan(0.1);
  expect(Math.abs(early.armSway)).toBeLessThan(0.5);
  expect({ ...early, armSway: 0 }).toEqual(still);
  // It swings to both sides, and less each time.
  const sways = [0.1, 0.3, 0.5, 0.7, 0.9].map(
    (part) => robotFrame(waiting, 0, began + WAVE_MS * part, false, began).armSway,
  );
  expect(sways.some((sway) => sway > 0) && sways.some((sway) => sway < 0)).toBe(true);
  expect(Math.abs(sways[4] ?? 1)).toBeLessThan(Math.abs(sways[0] ?? 0));
  // Then the hand is still, for as long as the robot waits.
  expect(robotFrame(waiting, 0, began + WAVE_MS, false, began)).toEqual(still);
  expect(robotFrame(waiting, 0, began + 60_000, false, began)).toEqual(still);
  // With reduced motion it never waves.
  expect(robotFrame(waiting, 0, began + WAVE_MS / 4, true, began)).toEqual(still);
});

test("the scene animates smoothly while a robot waves, then not at all", () => {
  const entered = new Map([["r", 0]]);
  const posed = new Map([["r", 5000]]);
  const waiting = robot({ agentId: "r", pose: "raised" });
  expect(animationNeed([waiting], entered, 5000 + WAVE_MS / 2, false, posed)).toBe("smooth");
  expect(animationNeed([waiting], entered, 5000 + WAVE_MS, false, posed)).toBe("none");
  expect(animationNeed([waiting], entered, 5000 + WAVE_MS / 2, true, posed)).toBe("none");
  // A robot the scene has no time for does not wave.
  expect(animationNeed([robot({ agentId: "x", pose: "raised" })], entered, 100, false, posed)).toBe(
    "none",
  );
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

test("a robot's visor is the palette's scene visor, so a warm provider colour is muted", () => {
  const scene = plan([agent("c"), agent("p", { provider: "pi" })]);
  expect(scene.robots.map((item) => [item.agentId, item.visor])).toEqual([
    ["c", sceneVisor("claude", PALETTE)],
    ["p", sceneVisor("pi", PALETTE)],
  ]);
  // Pi's identity colour is the app's red, too close to the danger lamp to be used as it is.
  expect(sceneVisor("pi", PALETTE)).not.toBe(visorColor("pi", true));
});
