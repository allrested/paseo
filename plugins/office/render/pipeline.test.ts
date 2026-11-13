import { expect, test } from "vitest";
import { buildOfficeModel } from "../client/model.js";
import { EMPTY_OFFICE, applyOfficeEvent } from "../client/office-state.js";
import { fakeOffice } from "../client/scene/fake-office.js";
import { LIGHT_THEME_COLORS } from "../client/scene/fake-theme.js";
import { scenePalette } from "../client/scene/palette.js";
import {
  NO_LAYOUT,
  NO_ROOMS,
  UNMEASURED,
  columnsNow,
  nextLayout,
  shapeAfterResize,
} from "../client/scene/scene-layout.js";
import { buildScenePlan, type ScenePlan } from "../client/scene/scene-plan.js";
import type { OfficeEvent, OfficeSnapshot } from "../shared/contracts.js";
import { createRenderPipeline } from "./pipeline.js";

const palette = scenePalette({ colors: LIGHT_THEME_COLORS });
const PHONE = { width: 390, height: 700 };

/** The plan the office client draws after these events, by its own functions. */
function clientPlanFor(events: OfficeEvent[], size: { width: number; height: number }): ScenePlan {
  const shape = shapeAfterResize(UNMEASURED, size.width, size.height);
  let state: OfficeSnapshot = EMPTY_OFFICE;
  let layout = NO_LAYOUT;
  let plan: ScenePlan = NO_ROOMS;
  for (const event of events) {
    state = applyOfficeEvent(state, event);
    const model = buildOfficeModel(state);
    layout = nextLayout(layout, model, columnsNow(shape, model.rooms.length, layout.columns));
    plan = layout.layout === null ? NO_ROOMS : buildScenePlan(model, layout.layout, palette);
  }
  return plan;
}

function emptyOffice(): OfficeSnapshot {
  return { ...fakeOffice(), agents: [], workspaces: [], boards: {}, activity: {} };
}

test("draws the plan the client draws for the same events", () => {
  const office = fakeOffice();
  const events: OfficeEvent[] = [
    { type: "snapshot", state: office },
    { type: "agents", agents: office.agents.slice(0, 5) },
  ];
  const pipeline = createRenderPipeline(palette);
  pipeline.resize(PHONE.width, PHONE.height);

  let plan: ScenePlan | null = null;
  for (const event of events) plan = pipeline.apply(event);

  expect(plan).toEqual(clientPlanFor(events, PHONE));
  expect(plan?.rooms.length).toBeGreaterThan(0);
});

test("an office with no agents and no workspaces draws what the client draws", () => {
  const snapshot: OfficeEvent = { type: "snapshot", state: emptyOffice() };
  const pipeline = createRenderPipeline(palette);
  pipeline.resize(PHONE.width, PHONE.height);

  expect(pipeline.apply(snapshot)).toEqual(clientPlanFor([snapshot], PHONE));
});

test("returns null before the view has a size", () => {
  const pipeline = createRenderPipeline(palette);

  expect(pipeline.apply({ type: "snapshot", state: fakeOffice() })).toBeNull();
});

test("the first size after the snapshot returns the plan", () => {
  const snapshot: OfficeEvent = { type: "snapshot", state: fakeOffice() };
  const pipeline = createRenderPipeline(palette);
  pipeline.apply(snapshot);

  expect(pipeline.resize(PHONE.width, PHONE.height)).toEqual(clientPlanFor([snapshot], PHONE));
});

test("a resize that changes the column count returns a new plan", () => {
  const pipeline = createRenderPipeline(palette);
  pipeline.resize(PHONE.width, PHONE.height);
  const narrow = pipeline.apply({ type: "snapshot", state: fakeOffice() });

  const wide = pipeline.resize(1600, 700);

  expect(wide?.columns).toBeGreaterThan(narrow?.columns ?? 0);
});

test("a resize to the same size, or to nothing, returns null", () => {
  const pipeline = createRenderPipeline(palette);
  pipeline.resize(PHONE.width, PHONE.height);
  pipeline.apply({ type: "snapshot", state: fakeOffice() });

  expect(pipeline.resize(PHONE.width, PHONE.height)).toBeNull();
  expect(pipeline.resize(0, 0)).toBeNull();
});

test("a board change that the scene shows returns the client's plan", () => {
  const office = fakeOffice();
  const events: OfficeEvent[] = [
    { type: "snapshot", state: office },
    { type: "board", board: "w-docs", posts: office.boards["w-main"] ?? [] },
  ];
  const pipeline = createRenderPipeline(palette);
  pipeline.resize(PHONE.width, PHONE.height);

  let plan: ScenePlan | null = null;
  for (const event of events) plan = pipeline.apply(event);

  expect(plan).toEqual(clientPlanFor(events, PHONE));
});
