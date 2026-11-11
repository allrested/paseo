import { expect, test } from "vitest";
import {
  hasTouchScreen,
  keptSelection,
  nextFocusRequest,
  sceneModelFor,
  officeView,
  problemText,
  IDLE_SWITCH,
  nextSwitchStep,
  savedThreeD,
  switchSync,
  type OfficeView,
  type PointerFacts,
  type StoredSwitch,
  type SwitchEvent,
  type SwitchStep,
  type SwitchSync,
  type ThreeDSetting,
} from "./office-surface.js";
import { buildOfficeModel, type OfficeModel } from "./model.js";
import { EMPTY_OFFICE } from "./office-state.js";

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

test("a reason that already starts with Unable to is shown as it is", () => {
  const texts: string[] = [
    problemText("Unable to show the 3D view", "Unable to create a WebGL2 context"),
    problemText("Unable to load the office", "  Unable to reach the host. "),
  ];
  expect(texts).toEqual(["Unable to create a WebGL2 context", "Unable to reach the host."]);
});

const WAIT: SwitchStep = { kind: "wait" };
const SETTLE: SwitchStep = { kind: "settle" };
const GIVE_UP: SwitchStep = { kind: "give-up" };

function stored(value: boolean | null, revision: string): StoredSwitch {
  return { value, revision };
}

function save(value: boolean, against: string, retry = false): SwitchStep {
  return { kind: "save", value, against, retry };
}

function tap(value: boolean): SwitchEvent {
  return { type: "tap", value };
}

function returned(ok: boolean): SwitchEvent {
  return { type: "returned", stored: ok };
}

const CHECKED: SwitchEvent = { type: "checked" };

/** The surface starting the save a step asks for. */
function start(step: SwitchStep): SwitchEvent {
  if (step.kind !== "save") throw new Error(`expected a save, got ${step.kind}`);
  return { type: "start", value: step.value, against: step.against, retry: step.retry };
}

function apply(sync: SwitchSync, ...events: SwitchEvent[]): SwitchSync {
  return events.reduce((state, event) => switchSync(state, event), sync);
}

test("nothing tapped leaves the switch to the stored value", () => {
  expect(nextSwitchStep(IDLE_SWITCH, stored(true, "r0"))).toEqual({ kind: "idle" });
});

test("a tap while the setting is still read waits for its revision", () => {
  const sync = apply(IDLE_SWITCH, tap(false));
  expect(nextSwitchStep(sync, null)).toEqual(WAIT);
});

test("a tap while the first save is in flight does not start a second save at once", () => {
  const first = apply(IDLE_SWITCH, tap(false));
  const step = nextSwitchStep(first, stored(true, "r0"));
  const second = apply(first, start(step), tap(true));
  expect([step, nextSwitchStep(second, stored(true, "r0")), second.wanted]).toEqual([
    save(false, "r0"),
    WAIT,
    true,
  ]);
});

test("off then on quickly ends stored on, saved in tap order", () => {
  const steps: SwitchStep[] = [];
  let sync = apply(IDLE_SWITCH, tap(false));
  steps.push(nextSwitchStep(sync, stored(true, "r0")));
  sync = apply(sync, start(steps[0]), tap(true), returned(true));
  // Stored, but the store's new revision has not been read yet.
  steps.push(nextSwitchStep(sync, stored(true, "r0")));
  steps.push(nextSwitchStep(sync, stored(false, "r1")));
  sync = apply(sync, start(steps[2]), returned(true));
  steps.push(nextSwitchStep(sync, stored(true, "r2")));
  sync = apply(sync, { type: "settle" });
  expect({ steps, sync }).toEqual({
    steps: [save(false, "r0"), WAIT, save(true, "r1"), SETTLE],
    sync: IDLE_SWITCH,
  });
});

test("three taps end stored on the third", () => {
  const steps: SwitchStep[] = [];
  let sync = apply(IDLE_SWITCH, tap(false));
  steps.push(nextSwitchStep(sync, stored(true, "r0")));
  sync = apply(sync, start(steps[0]), tap(true), returned(true));
  steps.push(nextSwitchStep(sync, stored(false, "r1")));
  sync = apply(sync, start(steps[1]), tap(false));
  steps.push(nextSwitchStep(sync, stored(false, "r1")));
  sync = apply(sync, returned(true));
  steps.push(nextSwitchStep(sync, stored(true, "r2")));
  sync = apply(sync, start(steps[3]), returned(true));
  steps.push(nextSwitchStep(sync, stored(false, "r3")));
  expect(steps).toEqual([save(false, "r0"), save(true, "r1"), WAIT, save(false, "r2"), SETTLE]);
});

test("taps that come back to the stored side settle without another save", () => {
  let sync = apply(IDLE_SWITCH, tap(false));
  const step = nextSwitchStep(sync, stored(true, "r0"));
  sync = apply(sync, start(step), tap(true), tap(false), returned(true));
  expect(nextSwitchStep(sync, stored(false, "r1"))).toEqual(SETTLE);
});

test("a refused save is judged only after the store was read again", () => {
  let sync = apply(IDLE_SWITCH, tap(false));
  sync = apply(sync, start(nextSwitchStep(sync, stored(true, "r0"))), returned(false));
  expect(nextSwitchStep(sync, stored(true, "r0"))).toEqual(WAIT);
});

test("a save refused for another reason gives up and keeps the tapped side", () => {
  let sync = apply(IDLE_SWITCH, tap(false));
  sync = apply(sync, start(nextSwitchStep(sync, stored(true, "r0"))), returned(false), CHECKED);
  // The store did not move, so the save was not refused for a conflict: no retry, ever.
  const steps = [
    nextSwitchStep(sync, stored(true, "r0")),
    nextSwitchStep(sync, stored(true, "r0")),
  ];
  expect({ steps, wanted: sync.wanted }).toEqual({ steps: [GIVE_UP, GIVE_UP], wanted: false });
});

test("a conflict retries once against the store's revision, and a second conflict gives up", () => {
  const steps: SwitchStep[] = [];
  let sync = apply(IDLE_SWITCH, tap(false));
  steps.push(nextSwitchStep(sync, stored(true, "r0")));
  sync = apply(sync, start(steps[0]), returned(false), CHECKED);
  // Another writer stored a revision of its own meanwhile.
  steps.push(nextSwitchStep(sync, stored(true, "r1")));
  sync = apply(sync, start(steps[1]), returned(false), CHECKED);
  steps.push(nextSwitchStep(sync, stored(true, "r2")));
  steps.push(nextSwitchStep(sync, stored(true, "r2")));
  expect({ steps, wanted: sync.wanted }).toEqual({
    steps: [save(false, "r0"), save(false, "r1", true), GIVE_UP, GIVE_UP],
    wanted: false,
  });
});

test("a conflict whose writer stored the tapped side settles without a retry", () => {
  let sync = apply(IDLE_SWITCH, tap(false));
  sync = apply(sync, start(nextSwitchStep(sync, stored(true, "r0"))), returned(false), CHECKED);
  expect(nextSwitchStep(sync, stored(false, "r1"))).toEqual(SETTLE);
});

test("a tap after giving up tries again", () => {
  let sync = apply(IDLE_SWITCH, tap(false));
  sync = apply(sync, start(nextSwitchStep(sync, stored(true, "r0"))), returned(false), CHECKED);
  sync = apply(sync, tap(true), tap(false));
  expect(nextSwitchStep(sync, stored(true, "r0"))).toEqual(save(false, "r0"));
});

test("a stored value that cannot be read is overwritten by the tap", () => {
  const sync = apply(IDLE_SWITCH, tap(true));
  expect(nextSwitchStep(sync, stored(null, "missing"))).toEqual(save(true, "missing"));
});

function liveModel(): OfficeModel {
  return buildOfficeModel({
    ...EMPTY_OFFICE,
    workspaces: [{ id: "w1", name: "main", projectName: "paseo" }],
  });
}

test("the scene draws the live model, the one the list view shows", () => {
  const model = liveModel();
  expect(sceneModelFor("scene", model) === model).toEqual(true);
});

test("no scene model while the list, the fallback or the wait is shown", () => {
  const model = liveModel();
  const views: OfficeView[] = ["structure", "fallback", "pending"];
  expect(views.map((shown) => sceneModelFor(shown, model))).toEqual([null, null, null]);
});

test("a strip tap asks the camera for its robot with a nonce the scene has not seen", () => {
  const first = nextFocusRequest(null, "a1");
  const again = nextFocusRequest(first, "a1");
  const other = nextFocusRequest(again, "a2");
  // The scene treats nonce 0 as already handled, so the first request starts at 1.
  expect([first, again, other]).toEqual([
    { agentId: "a1", nonce: 1 },
    { agentId: "a1", nonce: 2 },
    { agentId: "a2", nonce: 3 },
  ]);
});
