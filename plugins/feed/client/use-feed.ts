import { useCallback, useState } from "react";
import { useSubscription, type PluginSubscriptionState } from "@getpaseo/plugin/client";
import { feedSubscription, type FeedEvent, type FeedState } from "../shared/contracts.js";
import { EMPTY_FEED, applyFeedEvent } from "../shared/feed.js";

const NO_INPUT = {};

export interface LiveFeed {
  state: FeedState;
  /**
   * The feed as the host first sent it: `seenAt` is when it was last opened before this view.
   * Null until the host answers.
   */
  opened: { seenAt: string | null } | null;
  subscription: PluginSubscriptionState;
}

/** The host's feed, kept current while the component is mounted. */
export function useFeed(): LiveFeed {
  const [state, setState] = useState<FeedState>(EMPTY_FEED);
  const [opened, setOpened] = useState<LiveFeed["opened"]>(null);
  const onEvent = useCallback((event: FeedEvent) => {
    setState((current) => applyFeedEvent(current, event));
    if (event.type === "state") setOpened((first) => first ?? { seenAt: event.state.seenAt });
  }, []);
  const subscription = useSubscription(feedSubscription, NO_INPUT, onEvent);
  return { state, opened, subscription };
}
