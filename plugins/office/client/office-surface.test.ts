import { expect, test } from "vitest";
import {
  hasTouchScreen,
  keptSelection,
  officeView,
  problemText,
  savedThreeD,
  settlesSwitch,
  type OfficeView,
  type PointerFacts,
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

const MOUSE: PointerFacts = { anyCoarse: false, touchPoints: 0 };

test("a native app is a touch screen, and nothing is asked of a window", () => {
  const touch = [hasTouchScreen("ios", null), hasTouchScreen("android", null)];
  expect(touch).toEqual([true, true]);
});

test("a browser with a coarse pointer or touch points is a touch screen", () => {
  const touch = [
    hasTouchScreen("web", { anyCoarse: true, touchPoints: 0 }),
    hasTouchScreen("web", { anyCoarse: false, touchPoints: 5 }),
  ];
  expect(touch).toEqual([true, true]);
});

test("a browser with a mouse only is not a touch screen", () => {
  expect(hasTouchScreen("web", MOUSE)).toEqual(false);
});

test("a browser that cannot be asked counts as a mouse", () => {
  expect(hasTouchScreen("web", null)).toEqual(false);
});

test("a reason from outside joins the failure as one sentence", () => {
  const texts: string[] = [
    problemText("Unable to show the 3D view", "Unexpected three.js build"),
    problemText("Unable to show the 3D view", "Error creating WebGL context."),
    problemText("Unable to load the office", "  Timed out after 15 s. "),
  ];
  expect(texts).toEqual([
    "Unable to show the 3D view: unexpected three.js build",
    "Unable to show the 3D view: error creating WebGL context",
    "Unable to load the office: timed out after 15 s",
  ]);
});

test("a reason already written mid-sentence is kept", () => {
  const text: string = problemText("Unable to show the 3D view", "the host did not answer");
  expect(text).toEqual("Unable to show the 3D view: the host did not answer");
});

test("a name at the start of a reason keeps its capital", () => {
  const texts: string[] = [
    problemText("Unable to show the 3D view", "WebGL2 is not available"),
    problemText("Unable to load the office", "Paseo API is disposed"),
    problemText("Unable to load the office", "RPC office.subscribe failed"),
  ];
  expect(texts).toEqual([
    "Unable to show the 3D view: WebGL2 is not available",
    "Unable to load the office: Paseo API is disposed",
    "Unable to load the office: RPC office.subscribe failed",
  ]);
});

test("an empty reason leaves no colon behind", () => {
  const texts: string[] = [
    problemText("Unable to load the office", ""),
    problemText("Unable to load the office", " . "),
  ];
  expect(texts).toEqual(["Unable to load the office", "Unable to load the office"]);
});

test("the last tap's save settles the switch once it is stored", () => {
  expect(settlesSwitch(true, 2, 2)).toEqual(true);
});

test("an older tap's save does not settle the switch after a newer tap", () => {
  expect(settlesSwitch(true, 1, 2)).toEqual(false);
});

test("a save that was not stored leaves the tapped side showing", () => {
  expect(settlesSwitch(false, 2, 2)).toEqual(false);
});

test("a save that returns after the surface closed settles nothing", () => {
  // Closing the surface counts as one more turn.
  expect(settlesSwitch(true, 2, 3)).toEqual(false);
});
