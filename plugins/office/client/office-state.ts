import {
  CHAT_MESSAGE_MAX,
  type ChatSnapshot,
  type OfficeEvent,
  type OfficeSnapshot,
} from "../shared/contracts.js";

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
      return {
        ...state,
        activity: event.activity,
        doing: event.doing ?? {},
        checklists: event.checklists ?? {},
      };
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
    // The chat is kept apart: see applyChatEvent.
    case "chat":
      return state;
  }
}

export const EMPTY_CHAT: ChatSnapshot = { messages: [], typing: [] };

/**
 * The chat as `useOffice` keeps it: apart from the floor, so a reaction does not rebuild the
 * floor's model.
 */
export function applyChatEvent(chat: ChatSnapshot | null, event: OfficeEvent): ChatSnapshot | null {
  if (event.type === "snapshot") return event.state.chat ?? null;
  if (event.type !== "chat") return chat;
  const base = chat ?? EMPTY_CHAT;
  const { change } = event;
  switch (change.op) {
    case "add": {
      if (base.messages.some((m) => m.id === change.message.id)) return base;
      return { ...base, messages: [...base.messages, change.message].slice(-CHAT_MESSAGE_MAX) };
    }
    case "update": {
      const known = base.messages.some((m) => m.id === change.message.id);
      const messages = known
        ? base.messages.map((m) => (m.id === change.message.id ? change.message : m))
        : [...base.messages, change.message];
      return { ...base, messages: messages.slice(-CHAT_MESSAGE_MAX) };
    }
    case "typing":
      return { ...base, typing: change.names };
    case "all":
      return { ...base, messages: change.messages };
    case "act":
      return base;
  }
}
