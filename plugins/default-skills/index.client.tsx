import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SkillsScreen } from "./client/skills-screen.js";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addSettingsScreen({
      id: "skills",
      title: "Skills",
      icon: "BookOpen",
      Component: SkillsScreen,
    }),
    // Built-ins have no row in Settings > Plugins, so this item is the way to their settings. A
    // global item shows once a workspace on the host is open.
    client.addCommandCenterItem({
      id: "open-skills",
      title: "Default skills",
      icon: "BookOpen",
      keywords: ["claude", "skills", "ub-mode", "antislop", "design"],
      context: "global",
      onSelect({ openSettings }) {
        openSettings("skills");
      },
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
