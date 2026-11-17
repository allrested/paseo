import { useCallback, useRef, useState } from "react";
import { useSubscription, type PluginSubscriptionState } from "@getpaseo/plugin/client";
import {
  officeStateSubscription,
  type OfficeEvent,
  type OfficeSnapshot,
} from "../shared/contracts.js";
import { EMPTY_OFFICE, applyOfficeEvent } from "./office-state.js";
import { recordOfficeState } from "./activity-feed.js";

const NO_INPUT = {};

export interface OfficeState {
  state: OfficeSnapshot;
  /** True once the first snapshot arrived. */
  loaded: boolean;
  subscription: PluginSubscriptionState;
}

export function useOffice(): OfficeState {
  const [state, setState] = useState<OfficeSnapshot>(EMPTY_OFFICE);
  const [loaded, setLoaded] = useState(false);
  // The state the next event applies to. React may call a state updater while rendering, so the
  // event is applied here, where the feed's store may safely be told.
  const latest = useRef<OfficeSnapshot>(EMPTY_OFFICE);
  // The state this subscription last fed the feed; null until its first. Each subscription brings
  // its own previous state, because two of them do not see the office's events in one order.
  const recorded = useRef<OfficeSnapshot | null>(null);
  const onEvent = useCallback((event: OfficeEvent) => {
    const next = applyOfficeEvent(latest.current, event);
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
  return { state, loaded, subscription };
}
