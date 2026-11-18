import { useCallback } from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { ActivityPanel } from "./client/activity-panel.js";
import { ChatPanel } from "./client/chat-panel.js";
import { ACTIVITY_SCREEN, CHAT_SCREEN, SESSIONS_SCREEN } from "./client/office-link.js";
import { OfficeSettings } from "./client/office-settings.js";
import { createOfficeSurface } from "./client/office-surface.js";
import { SessionsPanel } from "./client/sessions-panel.js";

const SCREEN_ID = "office";
const PANEL_ID = "office";
const ICON = "Building2";

function OfficeItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: SCREEN_ID }), [openScreen]);
  return <SidebarRow icon={ICON} active={currentScreen?.screenId === SCREEN_ID} onPress={open} />;
}

// The sidebar item and the two Command Center items (the office, its settings) are the ways in;
// Settings > Sidebar can hide the sidebar item. The office's settings are a screen of the app's
// Settings.
export default function contribute(client: PluginClientContext) {
  const Surface = createOfficeSurface(() => client.openSettings(SCREEN_ID));
  const removers = [
    client.addScreen({ id: SCREEN_ID, title: "Office", Component: Surface }),
    client.addScreen({
      id: SESSIONS_SCREEN,
      title: "Sessions",
      Component: SessionsPanel,
    }),
    client.addScreen({
      id: ACTIVITY_SCREEN,
      title: "Activity",
      Component: ActivityPanel,
    }),
    client.addScreen({ id: CHAT_SCREEN, title: "Chat", Component: ChatPanel }),
    client.addSettingsScreen({
      id: SCREEN_ID,
      title: "Office",
      icon: ICON,
      Component: OfficeSettings,
    }),
    client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Office", Component: OfficeItem }),
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: "Office",
      icon: ICON,
      Component: Surface,
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
    client.addCommandCenterItem({
      id: "open-office-settings",
      title: "Office settings",
      icon: ICON,
      keywords: ["office", "wake", "notes", "incidents", "view"],
      context: "global",
      onSelect({ openSettings: open }) {
        open(SCREEN_ID);
      },
    }),
  ];
  return () => {
    for (const remove of removers) void remove();
  };
}
