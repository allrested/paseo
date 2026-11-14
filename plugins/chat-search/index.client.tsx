import { useCallback } from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { SearchScreen } from "./client/search-screen.js";

const SCREEN_ID = "search";
const TITLE = "Search chats";
const ICON = "TextSearch";

function SearchItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: SCREEN_ID }), [openScreen]);
  return <SidebarRow icon={ICON} active={currentScreen?.screenId === SCREEN_ID} onPress={open} />;
}

// A built-in has no row in Settings > Plugins: the sidebar item and the Command Center item are
// the ways in, and Settings > Sidebar can hide the first.
export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: SCREEN_ID, title: TITLE, Component: SearchScreen }),
    client.addSidebarHeaderItem({ id: SCREEN_ID, title: TITLE, Component: SearchItem }),
    client.addCommandCenterItem({
      id: "open-search",
      title: TITLE,
      icon: ICON,
      keywords: ["find", "history", "transcript", "message"],
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
