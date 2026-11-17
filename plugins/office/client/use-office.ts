import { useCallback, useRef, useState } from "react";
import { useSubscription, type PluginSubscriptionState } from "@getpaseo/plugin/client";
import {
  officeStateSubscription,
  type ChatSnapshot,
  type OfficeEvent,
  type OfficeSnapshot,
} from "../shared/contracts.js";
import { EMPTY_OFFICE, applyChatEvent, applyOfficeEvent } from "./office-state.js";
import { recordOfficeState } from "./activity-feed.js";
import { emitChatAct } from "./chat-acts.js";

const NO_INPUT = {};

export interface OfficeState {
  state: OfficeSnapshot;
  /** True once the first snapshot arrived. */
  loaded: boolean;
  subscription: PluginSubscriptionState;
  /**
   * The team chat, kept apart from `state` so a typing or reaction change does not rebuild the
   * floor. Null until the office's server has loaded it.
   */
  chat: ChatSnapshot | null;
}

export function useOffice(): OfficeState {
  const [state, setState] = useState<OfficeSnapshot>(EMPTY_OFFICE);
  const [loaded, setLoaded] = useState(false);
  const [chat, setChat] = useState<ChatSnapshot | null>(null);
  // The state the next event applies to. React may call a state updater while rendering, so the
  // event is applied here, where the feed's store may safely be told.
  const latest = useRef<OfficeSnapshot>(EMPTY_OFFICE);
  const chatLatest = useRef<ChatSnapshot | null>(null);
  // The state this subscription last fed the feed; null until its first. Each subscription brings
  // its own previous state, because two of them do not see the office's events in one order.
  const recorded = useRef<OfficeSnapshot | null>(null);
  const onEvent = useCallback((event: OfficeEvent) => {
    // A chat change never sets the floor's state.
    if (event.type === "chat") {
      if (event.change.op === "act") emitChatAct(event.change);
      chatLatest.current = applyChatEvent(chatLatest.current, event);
      setChat(chatLatest.current);
      return;
    }
    let floorEvent: OfficeEvent = event;
    if (event.type === "snapshot") {
      const { chat: snapshotChat, ...floor } = event.state;
      floorEvent = { type: "snapshot", state: floor };
      chatLatest.current = snapshotChat ?? null;
      setChat(chatLatest.current);
    }
    const next = applyOfficeEvent(latest.current, floorEvent);
    // The feed is fed the pair this subscription came from and has now, never the event. Its first
    // state has no before it, so opening the office does not fill the feed. The store makes the
    // same change seen by two subscriptions one event: a step or a permission by its id, a status
    // change by its agent, kind and the STATUS_SAME_MS window.
    recordOfficeState(recorded.current, next);
    latest.current = next;
    recorded.current = next;
    setState(next);
    if (event.type === "snapshot") setLoaded(true);
  }, []);
  const subscription = useSubscription(officeStateSubscription, NO_INPUT, onEvent);
  return { state, loaded, subscription, chat };
}
