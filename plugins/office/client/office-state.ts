import type { OfficeEvent, OfficeSnapshot } from "../shared/contracts.js";

export const EMPTY_OFFICE: OfficeSnapshot = {
  agents: [],
  workspaces: [],
  activity: {},
  boards: {},
  wake: { paused: false, queued: {} },
};

export function applyOfficeEvent(state: OfficeSnapshot, event: OfficeEvent): OfficeSnapshot {
  switch (event.type) {
    case "snapshot":
      return event.state;
    case "agents":
      return { ...state, agents: event.agents };
    case "workspaces":
      return { ...state, workspaces: event.workspaces };
    case "activity":
      return { ...state, activity: event.activity };
    case "board":
      return { ...state, boards: { ...state.boards, [event.board]: event.posts } };
    case "board-removed":
      return {
        ...state,
        boards: Object.fromEntries(
          Object.entries(state.boards).filter(([board]) => board !== event.board),
        ),
      };
    case "wake":
      return { ...state, wake: event.wake };
  }
}
