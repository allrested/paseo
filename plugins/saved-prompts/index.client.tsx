import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PromptsControl } from "./client/prompts-control.js";
import { PromptsScreen } from "./client/prompts-screen.js";
import { insertSavedPrompt } from "./client/slash.js";
import { promptsRpc } from "./client/store.js";

const SCREEN_ID = "prompts";
const ICON = "Bookmark";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addSettingsScreen({
      id: SCREEN_ID,
      title: "Saved prompts",
      icon: ICON,
      Component: PromptsScreen,
    }),
    // Built-ins have no row in Settings > Plugins, so this item is the way to the list.
    client.addCommandCenterItem({
      id: "open-prompts",
      title: "Saved prompts",
      icon: ICON,
      keywords: ["prompt", "snippet", "template"],
      context: "global",
      onSelect({ openSettings }) {
        openSettings(SCREEN_ID);
      },
    }),
    // One command for every prompt: the host reads a plugin's commands when it loads, so a
    // command per saved prompt would not follow the list.
    client.addSlashCommand({
      name: "prompt",
      description: "Put a saved prompt in the composer",
      argumentHint: "<name>",
      context: "agent",
      onSubmit: ({ args, agent, rpc, composers }) =>
        insertSavedPrompt({
          args,
          read: () => rpc(promptsRpc.read, {}),
          composer: composers({ agentId: agent.id })[0],
        }),
    }),
    client.addComposerItem({ id: "prompts", Component: PromptsControl }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
