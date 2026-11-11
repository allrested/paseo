import { useCallback, useState } from "react";
import { useSubscription, type PluginSubscriptionState } from "@getpaseo/plugin/client";
import {
  officeStateSubscription,
  type OfficeEvent,
  type OfficeSnapshot,
} from "../shared/contracts.js";
import { EMPTY_OFFICE, applyOfficeEvent } from "./office-state.js";

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
  const onEvent = useCallback((event: OfficeEvent) => {
    setState((current) => applyOfficeEvent(current, event));
    if (event.type === "snapshot") setLoaded(true);
  }, []);
  const subscription = useSubscription(officeStateSubscription, NO_INPUT, onEvent);
  return { state, loaded, subscription };
}
