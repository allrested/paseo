import { expect, test } from "vitest";
import {
  INITIAL_FOCUS,
  replan,
  requestFocus,
  settle,
  takeCamera,
  type FocusState,
  type FocusTarget,
} from "./focus.js";

/** Framed once, then the user moved the camera. */
const MOVED: FocusState = { following: false, framed: true, pending: null };
const ROOM: FocusTarget = { roomId: "w-new" };
const AGENT: FocusTarget = { agentId: "Fix links" };

function shownAll(): boolean {
  return true;
}

function shownNone(): boolean {
  return false;
}

test("a room asked for before it exists is framed once when it arrives, and never again", () => {
  const asked = requestFocus(MOVED, ROOM, false);
  expect(asked).toEqual({ state: { ...MOVED, pending: ROOM }, goal: null });
  const arrived = settle(asked.state, true, shownAll);
  expect(arrived).toEqual({ state: MOVED, goal: ROOM });
  expect(settle(arrived.state, true, shownAll)).toEqual({ state: MOVED, goal: null });
});

test("a focus on a room that is shown fires at once and clears an older pending room", () => {
  const waiting: FocusState = { ...MOVED, pending: ROOM };
  const plate: FocusTarget = { roomId: "w-main" };
  expect(requestFocus(waiting, plate, true)).toEqual({ state: MOVED, goal: plate });
});

test("a focus on an agent drops an older pending room", () => {
  const waiting: FocusState = { ...MOVED, pending: ROOM };
  const focused = requestFocus(waiting, AGENT, true);
  expect(focused).toEqual({ state: MOVED, goal: AGENT });
  expect(settle(focused.state, true, shownAll)).toEqual({ state: MOVED, goal: null });
});

test("a focus while the office follows stops it following", () => {
  const following: FocusState = { following: true, framed: true, pending: null };
  expect(requestFocus(following, AGENT, true)).toEqual({ state: MOVED, goal: AGENT });
});

test("moving the camera drops a pending focus and stops following", () => {
  const waiting: FocusState = { following: true, framed: true, pending: ROOM };
  expect(takeCamera(waiting)).toEqual(MOVED);
});

test("the office is framed once even when the camera was moved before the first framing", () => {
  const early = takeCamera(INITIAL_FOCUS);
  expect(settle(early, false, shownAll)).toEqual({ state: early, goal: null });
  const first = settle(early, true, shownAll);
  expect(first).toEqual({ state: MOVED, goal: "office" });
  expect(settle(first.state, true, shownAll)).toEqual({ state: MOVED, goal: null });
});

test("an agent asked for before the first framing is dropped, and the whole office is shown first", () => {
  const asked = requestFocus(INITIAL_FOCUS, AGENT, true);
  expect(asked).toEqual({ state: INITIAL_FOCUS, goal: null });
  expect(settle(asked.state, true, shownAll)).toEqual({
    state: { ...INITIAL_FOCUS, framed: true },
    goal: "office",
  });
});

test("an agent with no robot in the plan is dropped and does not pull the camera later", () => {
  const asked = requestFocus(MOVED, AGENT, false);
  expect(asked).toEqual({ state: MOVED, goal: null });
  // The agent gets a desk after an unrelated update: the camera stays where the user left it.
  expect(settle(asked.state, true, shownAll)).toEqual({ state: MOVED, goal: null });
});

test("an agent that cannot be shown leaves an older pending room waiting", () => {
  const waiting: FocusState = { ...MOVED, pending: ROOM };
  expect(requestFocus(waiting, AGENT, false)).toEqual({ state: waiting, goal: null });
});

test("a room asked for before the first framing is shown at the first framing", () => {
  const asked = requestFocus(INITIAL_FOCUS, ROOM, true);
  expect(settle(asked.state, true, shownAll)).toEqual({ state: MOVED, goal: ROOM });
});

test("while following, a missing focus stays pending and the office is framed", () => {
  const waiting: FocusState = { following: true, framed: false, pending: ROOM };
  const framed = settle(waiting, true, shownNone);
  expect(framed).toEqual({ state: { ...waiting, framed: true }, goal: "office" });
  expect(settle(framed.state, true, shownNone)).toEqual({ state: framed.state, goal: "office" });
  expect(settle(framed.state, true, shownAll)).toEqual({ state: MOVED, goal: ROOM });
});

test("nothing is framed while there is no size or no room", () => {
  expect(settle(INITIAL_FOCUS, false, shownAll)).toEqual({ state: INITIAL_FOCUS, goal: null });
});

test("a new grid or an emptied office follows again and frames again, keeping a pending focus", () => {
  const waiting: FocusState = { ...MOVED, pending: ROOM };
  expect(replan(waiting, true)).toEqual({ following: true, framed: false, pending: ROOM });
  expect(replan(waiting, false)).toEqual(waiting);
});
