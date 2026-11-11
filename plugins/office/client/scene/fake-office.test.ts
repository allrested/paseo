import { expect, test } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import { EMPTY_LAYOUT_MEMORY, layoutOffice } from "../layout.js";
import { buildOfficeModel } from "../model.js";
import { fakeOffice } from "./fake-office.js";
import { scenePalette } from "./palette.js";
import { buildScenePlan } from "./scene-plan.js";

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

test("the fake office shows every pose, a side desk, an overflow and the lobby", () => {
  const model = buildOfficeModel(fakeOffice());
  const { layout } = layoutOffice(model, EMPTY_LAYOUT_MEMORY);
  const plan = buildScenePlan(model, layout, scenePalette(THEME));
  expect(new Set(plan.robots.map((robot) => robot.pose))).toEqual(
    new Set(["typing", "idle", "raised", "slumped", "walking"]),
  );
  expect(plan.robots.some((robot) => robot.side)).toBe(true);
  expect(plan.rooms.map((room) => room.label)).toEqual([
    "Lobby",
    "main",
    "docs-site",
    "terraform",
    "load-test +2",
  ]);
  expect(model.attention.map((entry) => entry.reason)).toEqual(["permission", "error"]);
});

test("the child agent sits at the side desk of its parent's cell", () => {
  const model = buildOfficeModel(fakeOffice());
  const { layout } = layoutOffice(model, EMPTY_LAYOUT_MEMORY);
  const plan = buildScenePlan(model, layout, scenePalette(THEME));
  const parent = layout.seatOf.get("Refactor hub");
  const child = layout.seatOf.get("Hub tests");
  if (parent === undefined || child === undefined) throw new Error("both agents have a seat");
  expect([parent.roomId, parent.side, parent.index % 2]).toEqual(["w-main", false, 0]);
  expect([child.roomId, child.side, child.index]).toEqual(["w-main", true, parent.index + 1]);
  // Same cell: the side seat is 1.2 to the right of the main seat (0.65 - -0.55), same row.
  expect(child.x - parent.x).toBeCloseTo(1.2, 9);
  expect(child.z).toBe(parent.z);
  const robot = plan.robots.find((candidate) => candidate.agentId === "Hub tests");
  expect([robot?.side, robot?.seat]).toEqual([true, { x: child.x, z: child.z }]);
});

test("the lobby and main boards hold the fake posts, oldest first", () => {
  const model = buildOfficeModel(fakeOffice());
  expect(model.rooms.map((room) => [room.id, room.posts.map((post) => post.id)])).toEqual([
    ["lobby", ["p1"]],
    ["w-main", ["p2", "p3", "p4"]],
    ["w-docs", []],
    ["w-infra", []],
    ["w-load", []],
  ]);
});
