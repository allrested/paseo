import { expect, test } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import type { OfficeAgent, OfficeSnapshot, Post } from "../../shared/contracts.js";
import { EMPTY_LAYOUT_MEMORY, layoutOffice } from "../layout.js";
import { buildOfficeModel } from "../model.js";
import { fakeOffice } from "./fake-office.js";
import { scenePalette, sceneVisor, visorColor } from "./palette.js";
import {
  BOARD_CENTER_Y,
  DESK_OFFSET_Z,
  DESK_SIZE,
  NOTE_FADE_MS,
  NOTE_SLOTS,
  PLANE_MS,
  WALK_MS,
  WAVE_MS,
  animationNeed,
  buildScenePlan,
  noteFade,
  overflowTail,
  planeFrame,
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

function plan(agents: readonly OfficeAgent[], posts: readonly Post[] = []) {
  const state: OfficeSnapshot = {
    agents: [...agents],
    workspaces: [{ id: "w1", name: "main", projectName: "paseo" }],
    activity: {},
    boards: { w1: [...posts] },
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
    lean: 0.5,
    nod: -0.4,
    tilt: 0.9,
    armLeft: -0.5,
    armRight: -0.5,
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

/** To a millionth of a unit: sums in another order differ in the last bit. */
function tidy(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function fakePlan() {
  const model = buildOfficeModel(fakeOffice());
  const { layout } = layoutOffice(model, EMPTY_LAYOUT_MEMORY);
  return buildScenePlan(model, layout, PALETTE);
}

/** A post on the board of room w1, made `seq` minutes past nine. */
function post(seq: number, fields: Partial<Post> = {}): Post {
  const at = `2026-11-11T09:${String(seq).padStart(2, "0")}:00.000Z`;
  return {
    id: `p${seq}`,
    seq,
    board: "w1",
    kind: "task",
    text: "t",
    author: "user",
    state: "open",
    createdAt: at,
    updatedAt: at,
    ...fields,
  };
}

test("tasks and notes stand on the whiteboard; a claimed task is on the front of its claimer's desk", () => {
  const scene = fakePlan();
  const notes = new Map(scene.notes.map((note) => [note.postId, note]));
  const claimer = scene.robots.find((item) => item.agentId === "Hub tests");
  const onDesk = notes.get("p2");
  expect({ ...onDesk, z: tidy(onDesk?.z ?? 0) }).toEqual({
    postId: "p2",
    roomId: "w-main",
    x: claimer?.seat.x ?? 0,
    y: DESK_SIZE.height / 2,
    // On the desk's front face, the note's middle 0.03 off it.
    z: tidy((claimer?.seat.z ?? 0) + DESK_OFFSET_Z + DESK_SIZE.depth / 2 + 0.03),
    color: PALETTE.noteClaimed,
    onDesk: true,
  });
  const main = scene.rooms.find((room) => room.roomId === "w-main");
  // The oldest open task has the first place: top left.
  const first = notes.get("p4");
  expect({ ...first, y: tidy(first?.y ?? 0), z: tidy(first?.z ?? 0) }).toEqual({
    postId: "p4",
    roomId: "w-main",
    x: (main?.board.x ?? 0) - 1.5,
    y: tidy(BOARD_CENTER_Y + 0.4),
    z: tidy((main?.board.z ?? 0) + 0.06),
    color: PALETTE.noteTask,
    onDesk: false,
  });
  expect([notes.get("p3")?.onDesk, notes.get("p3")?.color, notes.get("p1")?.roomId]).toEqual([
    false,
    PALETTE.noteNote,
    "lobby",
  ]);
});

test("a whiteboard holds eight notes in two rows of four, oldest open tasks first; the rest stay off it", () => {
  const posts = Array.from({ length: 10 }, (_, index) => post(index + 1));
  const scene = plan([agent("a")], [post(11, { kind: "note", state: undefined }), ...posts]);
  const board = scene.rooms.find((room) => room.roomId === "w1")?.board ?? { x: 0, z: 0 };
  expect(NOTE_SLOTS).toBe(8);
  expect(scene.notes.map((note) => note.postId)).toEqual([
    "p1",
    "p2",
    "p3",
    "p4",
    "p5",
    "p6",
    "p7",
    "p8",
  ]);
  expect(
    scene.notes.map((note) => [tidy(note.x - board.x), tidy(note.y - BOARD_CENTER_Y)]),
  ).toEqual([
    [-1.5, 0.4],
    [-0.5, 0.4],
    [0.5, 0.4],
    [1.5, 0.4],
    [-1.5, -0.4],
    [-0.5, -0.4],
    [0.5, -0.4],
    [1.5, -0.4],
  ]);
});

test("a task claimed by an agent without a desk stays on the whiteboard; one on a desk takes no place there", () => {
  const scene = plan(
    [agent("a")],
    [
      post(1, { state: "claimed", claimedBy: "gone" }),
      post(2, { state: "claimed", claimedBy: "a" }),
      post(3),
      post(4, { kind: "note", state: undefined }),
      // Open again, with the name of who had it left on the post.
      post(5, { claimedBy: "a" }),
    ],
  );
  const board = scene.rooms.find((room) => room.roomId === "w1")?.board ?? { x: 0, z: 0 };
  // Board order is open tasks, then claimed ones, then notes.
  expect(
    scene.notes.map((note) => [
      note.postId,
      note.onDesk,
      note.color,
      note.onDesk ? null : tidy(note.x - board.x),
    ]),
  ).toEqual([
    ["p3", false, PALETTE.noteTask, -1.5],
    ["p5", false, PALETTE.noteTask, -0.5],
    ["p1", false, PALETTE.noteClaimed, 0.5],
    ["p2", true, PALETTE.noteClaimed, null],
    ["p4", false, PALETTE.noteNote, 1.5],
  ]);
});

test("tasks claimed by one agent are fanned on its desk, each in front of the one before", () => {
  const claimed = { state: "claimed" as const, claimedBy: "a" };
  const scene = plan(
    [agent("a")],
    [post(1, claimed), post(2, claimed), post(3, claimed), post(4, claimed)],
  );
  const seat = scene.robots[0]?.seat ?? { x: 0, z: 0 };
  const front = seat.z + DESK_OFFSET_Z + DESK_SIZE.depth / 2;
  expect(
    scene.notes.map((note) => [
      note.postId,
      tidy(note.x - seat.x),
      tidy(note.y - DESK_SIZE.height / 2),
      tidy(note.z - front),
    ]),
  ).toEqual([
    ["p1", 0, 0, 0.03],
    ["p2", 0.12, -0.05, 0.06],
    ["p3", 0.24, -0.1, 0.09],
    // The desk's front is no wider: from here on a note only comes forward.
    ["p4", 0.24, -0.1, 0.12],
  ]);
});

test("a post that names a seated agent is a mention from its author's seat to the target's", () => {
  const scene = fakePlan();
  const seat = (id: string) => scene.robots.find((item) => item.agentId === id)?.seat;
  expect(scene.mentions).toEqual([
    { postId: "p2", from: seat("Refactor hub"), to: seat("Hub tests") },
  ]);
});

test("the user's post leaves from the whiteboard; a post for an agent without a desk, or for its own author, is no mention", () => {
  const scene = plan(
    [agent("a")],
    [post(1, { to: "a" }), post(2, { to: "gone" }), post(3), post(4, { author: "a", to: "a" })],
  );
  const board = scene.rooms.find((room) => room.roomId === "w1")?.board;
  expect(scene.mentions).toEqual([{ postId: "p1", from: board, to: scene.robots[0]?.seat }]);
});

test("a plane arcs from start to end and then is done", () => {
  const mention = { postId: "p9", from: { x: 0, z: 0 }, to: { x: 10, z: 0 } };
  expect(planeFrame(mention, 0, 0)).toEqual({
    x: 0,
    y: 1.4,
    z: 0,
    heading: Math.PI / 2,
    done: false,
  });
  const middle = planeFrame(mention, 0, PLANE_MS / 2);
  expect([middle.x, middle.y, middle.done]).toEqual([5, 3.4, false]);
  expect(planeFrame(mention, 0, PLANE_MS).done).toBe(true);
  // A plane asked for before its start (a frame's clock can run behind) waits at the start.
  expect(planeFrame(mention, 100, 0).x).toBe(0);
});

test("a short hop is a low arc: a plane rises by a third of the way it has to go, at most 2", () => {
  const hop = { postId: "p9", from: { x: 0, z: 0 }, to: { x: 0, z: 3 } };
  expect(planeFrame(hop, 0, PLANE_MS / 2).y).toBeCloseTo(1.4 + 1, 9);
  const far = { postId: "p9", from: { x: 0, z: 0 }, to: { x: 30, z: 40 } };
  expect(planeFrame(far, 0, PLANE_MS / 2).y).toBeCloseTo(1.4 + 2, 9);
});

test("a removed note fades from full to nothing", () => {
  expect(noteFade(0, 0)).toBe(1);
  expect(noteFade(0, NOTE_FADE_MS / 2)).toBe(0.5);
  expect(noteFade(0, NOTE_FADE_MS * 2)).toBe(0);
});
