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
