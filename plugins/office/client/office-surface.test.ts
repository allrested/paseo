import { expect, test } from "vitest";
import {
  IDLE_SWITCH,
  chosenView,
  hasTouchScreen,
  keptSelection,
  nextFocusRequest,
  nextSwitchStep,
  officeView,
  problemText,
  savedView,
  switchSync,
  switchUnsaved,
  viewOnDevice,
  viewOptions,
  type PointerFacts,
  type StoredSwitch,
  type SwitchEvent,
  type SwitchStep,
  type SwitchSync,
} from "./office-surface.js";

function agents(...ids: string[]): ReadonlyMap<string, unknown> {
  return new Map(ids.map((id): [string, unknown] => [id, { id }]));
}

test("the saved view is the device's choice once it was read", () => {
  const choices = [
    savedView({ status: "ready", values: { threeD: true, view: "2d" } }),
    savedView({ status: "ready", values: { threeD: true, view: "list" } }),
    savedView({ status: "ready", values: { threeD: false, view: "3d" } }),
  ];
  expect(choices).toEqual(["2d", "list", "3d"]);
});

test("a setting from before there were three views keeps what its 3D switch said", () => {
  const choices = [
    savedView({ status: "ready", values: { threeD: true } }),
    savedView({ status: "ready", values: { threeD: false } }),
  ];
  // On chose nothing a device could not draw: it is left to the device. Off was the list.
  expect(choices).toEqual(["auto", "list"]);
  expect([chosenView({ threeD: true }), chosenView({ threeD: false })]).toEqual([null, "list"]);
});

test("the saved view is not known while the device's setting is being read", () => {
  expect(savedView({ status: "loading" })).toEqual(null);
});

test("a setting that cannot be read leaves the view to the device", () => {
  expect([savedView({ status: "error" }), savedView({ status: "invalid" })]).toEqual([
    "auto",
    "auto",
  ]);
});

test("a device that can draw 3D shows it where nobody chose, and the 2D office where it cannot", () => {
  expect([viewOnDevice("auto", true), viewOnDevice("auto", false)]).toEqual(["3d", "2d"]);
});

test("a 3D choice on a device that cannot draw it is the 2D office", () => {
  expect(viewOnDevice("3d", false)).toEqual("2d");
});

test("the 2D office and the list are shown wherever they were chosen", () => {
  const views = [
    viewOnDevice("2d", true),
    viewOnDevice("2d", false),
    viewOnDevice("list", true),
    viewOnDevice("list", false),
  ];
  expect(views).toEqual(["2d", "2d", "list", "list"]);
});

test("the switch offers 3D only where the device can draw it", () => {
  expect([viewOptions(true), viewOptions(false)]).toEqual([
    ["3d", "2d", "list"],
    ["2d", "list"],
  ]);
});

test("the surface shows the chosen view", () => {
  const views = [
    officeView({ choice: "3d", problem: null }),
    officeView({ choice: "2d", problem: null }),
    officeView({ choice: "list", problem: null }),
  ];
  expect(views).toEqual(["3d", "2d", "list"]);
});

test("the view waits while the choice is not known", () => {
  expect(officeView({ choice: null, problem: "lost" })).toEqual("pending");
});

test("a 3D failure gives way to the 2D office", () => {
  expect(officeView({ choice: "3d", problem: "lost" })).toEqual("2d");
});

test("a 3D failure changes nothing while another view is chosen", () => {
  const views = [
    officeView({ choice: "2d", problem: "lost" }),
    officeView({ choice: "list", problem: "lost" }),
  ];
  expect(views).toEqual(["2d", "list"]);
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

// The sync is the same for any switch; these run it with two sides, as a switch with on and off.
type Step = SwitchStep<boolean>;
type Event = SwitchEvent<boolean>;
type Sync = SwitchSync<boolean>;

const WAIT: Step = { kind: "wait" };
const SETTLE: Step = { kind: "settle" };
const GIVE_UP: Step = { kind: "give-up" };

function stored(value: boolean | null, revision: string): StoredSwitch<boolean> {
  return { value, revision };
}

function save(value: boolean, against: string, retry = false): Step {
  return { kind: "save", value, against, retry };
}

function tap(value: boolean): Event {
  return { type: "tap", value };
}

function returned(ok: boolean): Event {
  return { type: "returned", stored: ok };
}

const CHECKED: Event = { type: "checked" };

/** The surface starting the save a step asks for. */
function start(step: Step | undefined): Event {
  if (step?.kind !== "save") throw new Error(`expected a save, got ${step?.kind}`);
  return { type: "start", value: step.value, against: step.against, retry: step.retry };
}

function apply(sync: Sync, ...events: Event[]): Sync {
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
  const steps: Step[] = [];
  let sync: Sync = apply(IDLE_SWITCH, tap(false));
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
  const steps: Step[] = [];
  let sync: Sync = apply(IDLE_SWITCH, tap(false));
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
  let sync: Sync = apply(IDLE_SWITCH, tap(false));
  const step = nextSwitchStep(sync, stored(true, "r0"));
  sync = apply(sync, start(step), tap(true), tap(false), returned(true));
  expect(nextSwitchStep(sync, stored(false, "r1"))).toEqual(SETTLE);
});

test("a refused save is judged only after the store was read again", () => {
  let sync: Sync = apply(IDLE_SWITCH, tap(false));
  sync = apply(sync, start(nextSwitchStep(sync, stored(true, "r0"))), returned(false));
  expect(nextSwitchStep(sync, stored(true, "r0"))).toEqual(WAIT);
});

test("a save refused for another reason gives up and keeps the tapped side", () => {
  let sync: Sync = apply(IDLE_SWITCH, tap(false));
  sync = apply(sync, start(nextSwitchStep(sync, stored(true, "r0"))), returned(false), CHECKED);
  // The store did not move, so the save was not refused for a conflict: no retry, ever.
  const steps = [
    nextSwitchStep(sync, stored(true, "r0")),
    nextSwitchStep(sync, stored(true, "r0")),
  ];
  expect({ steps, wanted: sync.wanted }).toEqual({ steps: [GIVE_UP, GIVE_UP], wanted: false });
});

test("a conflict retries once against the store's revision, and a second conflict gives up", () => {
  const steps: Step[] = [];
  let sync: Sync = apply(IDLE_SWITCH, tap(false));
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
  let sync: Sync = apply(IDLE_SWITCH, tap(false));
  sync = apply(sync, start(nextSwitchStep(sync, stored(true, "r0"))), returned(false), CHECKED);
  expect(nextSwitchStep(sync, stored(false, "r1"))).toEqual(SETTLE);
});

test("a tap after giving up tries again", () => {
  let sync: Sync = apply(IDLE_SWITCH, tap(false));
  sync = apply(sync, start(nextSwitchStep(sync, stored(true, "r0"))), returned(false), CHECKED);
  sync = apply(sync, tap(true), tap(false));
  expect(nextSwitchStep(sync, stored(true, "r0"))).toEqual(save(false, "r0"));
});

test("a stored value that cannot be read is overwritten by the tap", () => {
  const sync = apply(IDLE_SWITCH, tap(true));
  expect(nextSwitchStep(sync, stored(null, "missing"))).toEqual(save(true, "missing"));
});

test("a view chosen where the device held none is saved against its revision", () => {
  const sync = switchSync<"3d" | "2d" | "list">(IDLE_SWITCH, { type: "tap", value: "2d" });
  const steps = [
    nextSwitchStep(sync, { value: null, revision: "r0" }),
    nextSwitchStep(sync, { value: "list", revision: "r0" }),
    nextSwitchStep(sync, { value: "2d", revision: "r0" }),
  ];
  expect(steps).toEqual([
    { kind: "save", value: "2d", against: "r0", retry: false },
    { kind: "save", value: "2d", against: "r0", retry: false },
    { kind: "settle" },
  ]);
});

test("a strip tap asks for its agent with a nonce the view has not seen", () => {
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

function giveUp(revision: string): Event {
  return { type: "give-up", revision };
}

test("a tap while a save is stored but not yet read keeps that save in flight", () => {
  let sync: Sync = apply(IDLE_SWITCH, tap(false));
  sync = apply(sync, start(nextSwitchStep(sync, stored(true, "r0"))), returned(true), tap(true));
  expect({ phase: sync.save?.phase, wanted: sync.wanted }).toEqual({
    phase: "saved",
    wanted: true,
  });
  expect(nextSwitchStep(sync, stored(true, "r0"))).toEqual(WAIT);
});

test("a refused save whose tap already matches the store settles instead of giving up", () => {
  let sync: Sync = apply(IDLE_SWITCH, tap(false));
  sync = apply(sync, start(nextSwitchStep(sync, stored(true, "r0"))), tap(true));
  sync = apply(sync, returned(false), CHECKED);
  expect(nextSwitchStep(sync, stored(true, "r0"))).toEqual(SETTLE);
});

test("after giving up, a change stored from elsewhere wins and nothing is saved again", () => {
  let sync: Sync = apply(IDLE_SWITCH, tap(false));
  sync = apply(sync, start(nextSwitchStep(sync, stored(true, "r0"))), returned(false), CHECKED);
  expect(nextSwitchStep(sync, stored(true, "r0"))).toEqual(GIVE_UP);
  sync = apply(sync, giveUp("r0"));
  const steps = [
    nextSwitchStep(sync, stored(true, "r0")),
    nextSwitchStep(sync, stored(true, "r1")),
  ];
  expect(steps).toEqual([GIVE_UP, SETTLE]);
});

test("after a second conflict gives up, a later writer is not overwritten", () => {
  let sync: Sync = apply(IDLE_SWITCH, tap(false));
  sync = apply(sync, start(nextSwitchStep(sync, stored(true, "r0"))), returned(false), CHECKED);
  sync = apply(sync, start(nextSwitchStep(sync, stored(true, "r1"))), returned(false), CHECKED);
  expect(nextSwitchStep(sync, stored(true, "r2"))).toEqual(GIVE_UP);
  sync = apply(sync, giveUp("r2"));
  expect(nextSwitchStep(sync, stored(true, "r3"))).toEqual(SETTLE);
});

test("giving up twice for the same revision changes nothing", () => {
  let sync: Sync = apply(IDLE_SWITCH, tap(false));
  sync = apply(sync, start(nextSwitchStep(sync, stored(true, "r0"))), returned(false), CHECKED);
  const once = apply(sync, giveUp("r0"));
  const same: boolean = apply(once, giveUp("r0")) === once;
  expect(same).toEqual(true);
});

test("a switch whose save was refused for good is unsaved until the next tap or a change from elsewhere", () => {
  let sync: Sync = apply(IDLE_SWITCH, tap(false));
  const before = [switchUnsaved(IDLE_SWITCH), switchUnsaved(sync)];
  sync = apply(sync, start(nextSwitchStep(sync, stored(true, "r0"))), returned(false), CHECKED);
  // Refused, but the surface has not given up yet: the store is still being read.
  const refused = switchUnsaved(sync);
  sync = apply(sync, giveUp("r0"));
  const givenUp = switchUnsaved(sync);
  const after = [
    switchUnsaved(apply(sync, tap(true))),
    switchUnsaved(apply(sync, { type: "settle" })),
  ];
  expect({ before, refused, givenUp, after }).toEqual({
    before: [false, false],
    refused: false,
    givenUp: true,
    after: [false, false],
  });
});
