import { useCallback } from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { ResourcesScreen } from "./client/resources-screen.js";

const SCREEN_ID = "resources";

function ResourcesItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: SCREEN_ID }), [openScreen]);
  return <SidebarRow icon="Gauge" active={currentScreen?.screenId === SCREEN_ID} onPress={open} />;
}

// The sidebar item is the way in: a built-in has no row in Settings > Plugins, and users can hide
// the item in Settings > Sidebar.
export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: SCREEN_ID, title: "Resources", Component: ResourcesScreen }),
    client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Resources", Component: ResourcesItem }),
  ];
  return () => {
    for (const remove of removers) void remove();
  };
}
