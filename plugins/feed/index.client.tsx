import { useCallback, useMemo } from "react";
import { Text, type TextStyle } from "react-native";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { FeedScreen } from "./client/feed-screen.js";
import { countLabel } from "./client/format.js";
import { useFeed } from "./client/use-feed.js";
import { newCount } from "./shared/feed.js";

const SCREEN_ID = "feed";
const TITLE = "Feed";
const ICON = "Inbox";

// The row carries how many entries came since the feed was last opened, on any device.
function FeedItem({ currentScreen, openScreen, theme }: PluginSidebarItemProps) {
  const { state } = useFeed();
  const count = newCount(state);
  const open = useCallback(() => openScreen({ screenId: SCREEN_ID }), [openScreen]);
  const countStyle = useMemo(
    (): TextStyle => ({
      color: theme.colors.foreground,
      fontSize: 12,
      fontWeight: "500",
      fontVariant: ["tabular-nums"],
    }),
    [theme],
  );
  const trailing = useMemo(
    () =>
      count === 0 ? undefined : (
        <Text accessibilityLabel={countLabel(count)} style={countStyle}>
          {count}
        </Text>
      ),
    [count, countStyle],
  );
  return (
    <SidebarRow
      icon={ICON}
      active={currentScreen?.screenId === SCREEN_ID}
      onPress={open}
      trailing={trailing}
    />
  );
}

// A built-in has no row in Settings > Plugins: the sidebar item and the Command Center item are
// the ways in. Settings > Sidebar can hide the item.
export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: SCREEN_ID, title: TITLE, Component: FeedScreen }),
    client.addSidebarHeaderItem({ id: SCREEN_ID, title: TITLE, Component: FeedItem }),
    client.addCommandCenterItem({
      id: "open-feed",
      title: "Open feed",
      icon: ICON,
      keywords: ["finished", "failed", "permission", "inbox", "activity"],
      context: "global",
      onSelect({ openScreen }) {
        openScreen({ screenId: SCREEN_ID });
      },
    }),
  ];
  return () => {
    for (const remove of removers) void remove();
  };
}
