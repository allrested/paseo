import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DefinitionsScreen } from "./client/definitions-screen.js";
import { ServersScreen } from "./client/servers-screen.js";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addSettingsScreen({
      id: "servers",
      title: "Servers",
      icon: "Server",
      Component: ServersScreen,
    }),
    client.addSettingsScreen({
      id: "definitions",
      title: "Definitions",
      icon: "FileBraces",
      Component: DefinitionsScreen,
    }),
    // Built-ins have no row in Settings > Plugins, so this item is the way to their settings.
    client.addCommandCenterItem({
      id: "open-servers",
      title: "Shared MCP servers",
      icon: "Server",
      keywords: ["mcp"],
      context: "global",
      onSelect({ openSettings }) {
        openSettings("servers");
      },
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
