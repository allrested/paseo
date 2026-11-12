// Where the office camera goes next: the whole office, a room or a robot. Pure, so the order of
// focus requests, framing and the user's own moves is unit tested.

/** A room asked for by the host or a plate tap, or a robot asked for by the host. */
export type FocusTarget = { roomId: string } | { agentId: string };

/** What the camera should show now; `"office"` frames the whole office. */
export type FocusGoal = "office" | FocusTarget;

export interface FocusState {
  /** True until the user or a focus request moves the camera: the view then follows the office. */
  following: boolean;
  /** The office has been framed since it was last laid out anew. */
  framed: boolean;
  /** A room asked for before it could be shown: applied once, then dropped. */
  pending: FocusTarget | null;
}

export interface FocusStep {
  state: FocusState;
  goal: FocusGoal | null;
}

export const INITIAL_FOCUS: FocusState = { following: true, framed: false, pending: null };

/**
 * A focus request from the host or a plate tap. `shown` is true when its room or robot is in the
 * plan. Shown on a framed office, it fires once and replaces any older request. A room otherwise
 * waits, replacing any older request, until `settle` can show it (a workspace tab opened before
 * its room arrived). A robot that cannot be shown now is dropped and changes nothing: an agent
 * without a desk ("+N") or one that left must not pull the camera when it gets a desk later, and
 * the first view shows the whole office before any robot.
 */
export function requestFocus(state: FocusState, target: FocusTarget, shown: boolean): FocusStep {
  const ready = shown && state.framed;
  if (!ready && "agentId" in target) return { state, goal: null };
  if (!ready) return { state: { ...state, pending: target }, goal: null };
  return { state: { ...state, following: false, pending: null }, goal: target };
}

/** The user dragged, pinched or turned the wheel. */
export function takeCamera(state: FocusState): FocusState {
  return { ...state, following: false, pending: null };
}

/**
 * A scene that starts with the camera the user left in an earlier one (3D off and on, "Try 3D
 * again"). The view is theirs already, so the office is not framed, and a room asked for at the
 * start, the workspace tab's own, is dropped.
 */
export function resumeCamera(state: FocusState): FocusState {
  return { ...state, following: false, framed: true, pending: null };
}

/** A new plan. `reset` is true for a new grid or an emptied office: both are framed again. */
export function replan(state: FocusState, reset: boolean): FocusState {
  return reset ? { ...state, following: true, framed: false } : state;
}

/**
 * After a new plan or a new size. `ready` is false while the view has no size or the office has
 * no room. A pending focus whose room or robot is shown fires now, once. Otherwise the whole
 * office is framed when it never was, and again while it follows.
 */
export function settle(
  state: FocusState,
  ready: boolean,
  shown: (target: FocusTarget) => boolean,
): FocusStep {
  if (!ready) return { state, goal: null };
  const { pending } = state;
  if (pending !== null && shown(pending)) {
    return { state: { following: false, framed: true, pending: null }, goal: pending };
  }
  if (state.framed && !state.following) return { state, goal: null };
  return { state: { ...state, framed: true }, goal: "office" };
}
