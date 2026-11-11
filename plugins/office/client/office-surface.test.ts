import { expect, test } from "vitest";
import {
  keptSelection,
  officeView,
  savedThreeD,
  type OfficeView,
  type ThreeDSetting,
} from "./office-surface.js";

function agents(...ids: string[]): ReadonlyMap<string, unknown> {
  return new Map(ids.map((id): [string, unknown] => [id, { id }]));
}

function saved(setting: ThreeDSetting): boolean | null {
  return savedThreeD(setting);
}

function view(available: boolean, threeD: boolean | null, problem: string | null): OfficeView {
  return officeView({ available, threeD, problem });
}

test("the saved switch is the device's choice once it was read", () => {
  const choices = [
    saved({ status: "ready", values: { threeD: true } }),
    saved({ status: "ready", values: { threeD: false } }),
  ];
  expect(choices).toEqual([true, false]);
});

test("the saved switch is not known while the device's setting is being read", () => {
  expect(saved({ status: "loading" })).toEqual(null);
});

test("a setting that cannot be read counts as on, the default", () => {
  const choices = [saved({ status: "error" }), saved({ status: "invalid" })];
  expect(choices).toEqual([true, true]);
});

test("3D on shows the scene", () => {
  expect(view(true, true, null)).toEqual("scene");
});

test("3D off shows the structure view", () => {
  expect(view(true, false, null)).toEqual("structure");
});

test("the view waits while the switch is not known", () => {
  expect(view(true, null, null)).toEqual("pending");
});

test("a device without 3D shows the structure view whatever the switch says", () => {
  const views = [view(false, true, null), view(false, null, null), view(false, true, "lost")];
  expect(views).toEqual(["structure", "structure", "structure"]);
});

test("a 3D failure falls back to the structure view with a way to try again", () => {
  expect(view(true, true, "lost")).toEqual("fallback");
});

test("a 3D failure does not show while 3D is off", () => {
  expect(view(true, false, "lost")).toEqual("structure");
});

test("a selected agent still in the model is kept", () => {
  const kept: string | null = keptSelection("a1", agents("a1", "a2"), true);
  expect(kept).toEqual("a1");
});

test("a selected agent that left the model is dropped", () => {
  const kept: string | null = keptSelection("a1", agents("a2"), true);
  expect(kept).toEqual(null);
});

test("the selection is dropped when the subscription is not live", () => {
  const kept: string | null = keptSelection("a1", agents("a1"), false);
  expect(kept).toEqual(null);
});

test("no selection stays none", () => {
  const kept: string | null = keptSelection(null, agents("a1"), true);
  expect(kept).toEqual(null);
});
