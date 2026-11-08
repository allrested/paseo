import { useCallback } from "react";
import type {
  PluginClientContext,
  PluginOpenScreenInput,
  PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { AccountsScreen } from "./client/accounts-screen.js";

const SCREEN_ID = "accounts";
const TITLE = "Claude accounts";
const ICON = "Users";
const OPEN_ACCOUNTS: PluginOpenScreenInput = { screenId: SCREEN_ID };

function AccountsItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen(OPEN_ACCOUNTS), [openScreen]);
  return <SidebarRow icon={ICON} active={currentScreen?.screenId === SCREEN_ID} onPress={open} />;
}

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: SCREEN_ID, title: TITLE, Component: AccountsScreen }),
    // A footer item shows without a workspace, so the screen is reachable on a fresh host.
    client.addSidebarFooterItem({ id: "accounts", title: TITLE, Component: AccountsItem }),
    client.addCommandCenterItem({
      id: "open-accounts",
      title: TITLE,
      icon: ICON,
      keywords: ["claude", "account", "login", "usage"],
      context: "global",
      onSelect({ openScreen }) {
        openScreen(OPEN_ACCOUNTS);
      },
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
