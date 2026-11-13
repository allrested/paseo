import { useCallback } from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { AndroidSurface } from "./client/android-surface.js";

const SCREEN_ID = "android";
const PANEL_ID = "android";
const ICON = "Smartphone";

function AndroidItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: SCREEN_ID }), [openScreen]);
  return <SidebarRow icon={ICON} active={currentScreen?.screenId === SCREEN_ID} onPress={open} />;
}

// A plugin cannot know the host's state before it mounts, so the screen and the panel are always
// registered and say "No Android device on this host" when there is none. A built-in has no row in
// Settings > Plugins: the sidebar item and the Command Center item are the ways in.
export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: SCREEN_ID, title: "Android", Component: AndroidSurface }),
    client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Android", Component: AndroidItem }),
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: "Android",
      icon: ICON,
      Component: AndroidSurface,
    }),
    client.addCommandCenterItem({
      id: "open-android",
      title: "Open Android device",
      icon: ICON,
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel(PANEL_ID);
      },
    }),
  ];
  return () => {
    for (const remove of removers) void remove();
  };
}
