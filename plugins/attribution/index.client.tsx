import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AttributionPanel } from "./client/attribution-panel.js";

const PANEL_ID = "attribution";
const ICON = "Highlighter";

// A built-in has no row in Settings > Plugins: the workspace panel and the Command Center item
// are the ways in.
export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: "Attribution",
      icon: ICON,
      Component: AttributionPanel,
    }),
    client.addCommandCenterItem({
      id: "show-attribution",
      title: "Show line attribution",
      icon: ICON,
      keywords: ["blame", "who wrote", "agent lines", "authors"],
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
