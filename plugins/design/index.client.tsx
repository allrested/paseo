import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DesignsPanel } from "./client/designs-panel.js";

const PANEL_ID = "designs";
const ICON = "PenTool";

// A built-in has no row in Settings > Plugins: the workspace panel and the Command Center item
// are the ways in.
export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: "Designs",
      icon: ICON,
      Component: DesignsPanel,
    }),
    client.addCommandCenterItem({
      id: "open-designs",
      title: "Open designs",
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
