import type { PluginClientContext } from "@getpaseo/plugin/client";
import { CommandsScreen } from "./client/commands-screen.js";
import { LimitsScreen } from "./client/limits-screen.js";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addSettingsScreen({
      id: "commands",
      title: "Commands",
      icon: "Hourglass",
      Component: CommandsScreen,
    }),
    client.addSettingsScreen({
      id: "limits",
      title: "Limits",
      icon: "SlidersHorizontal",
      Component: LimitsScreen,
    }),
    // Built-ins have no row in Settings > Plugins, so this item is the way to their settings. A
    // global item shows once a workspace on the host is open.
    client.addCommandCenterItem({
      id: "open-commands",
      title: "Heavy commands",
      icon: "Hourglass",
      keywords: ["gate", "typecheck", "memory"],
      context: "global",
      onSelect({ openSettings }) {
        openSettings("commands");
      },
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
