import { useCallback } from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { OfficeSurface } from "./client/office-surface.js";

const SCREEN_ID = "office";
const PANEL_ID = "office";
const ICON = "Building2";

function OfficeItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: SCREEN_ID }), [openScreen]);
  return <SidebarRow icon={ICON} active={currentScreen?.screenId === SCREEN_ID} onPress={open} />;
}

// A built-in has no row in Settings > Plugins: the sidebar item and the Command Center item are
// the ways in. Settings > Sidebar can hide the item.
export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: SCREEN_ID, title: "Office", Component: OfficeSurface }),
    client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Office", Component: OfficeItem }),
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: "Office",
      icon: ICON,
      Component: OfficeSurface,
    }),
    client.addCommandCenterItem({
      id: "open-office",
      title: "Open office",
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
