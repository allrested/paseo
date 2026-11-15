import { useCallback } from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { StatsScreen } from "./client/stats-screen.js";

const SCREEN_ID = "stats";
const TITLE = "Stats";
const ICON = "ChartColumn";

function StatsItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: SCREEN_ID }), [openScreen]);
  return <SidebarRow icon={ICON} active={currentScreen?.screenId === SCREEN_ID} onPress={open} />;
}

// A built-in has no row in Settings > Plugins: the sidebar item and the Command Center item are
// the ways in. Settings > Sidebar can hide the item.
export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: SCREEN_ID, title: TITLE, Component: StatsScreen }),
    client.addSidebarHeaderItem({ id: SCREEN_ID, title: TITLE, Component: StatsItem }),
    client.addCommandCenterItem({
      id: "open-stats",
      title: "Agent stats",
      icon: ICON,
      keywords: ["stats", "turns", "time", "usage", "activity", "chart"],
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
