import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ConnectionsScreen } from "./client/connections-screen.js";
import { createTaskField } from "./client/task-field.js";
import { CONNECTIONS_SCREEN, taskAttachments } from "./shared/contracts.js";

const ICON = "CircleDot";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addSettingsScreen({
      id: CONNECTIONS_SCREEN,
      title: "Task connections",
      icon: ICON,
      Component: ConnectionsScreen,
    }),
    // Built-ins have no row in Settings > Plugins, so this item is the way to the screen.
    client.addCommandCenterItem({
      id: "open-connections",
      title: "Task connections",
      icon: ICON,
      keywords: ["jira", "gitlab", "issue", "ticket", "tracker"],
      context: "global",
      onSelect({ openSettings }) {
        openSettings(CONNECTIONS_SCREEN);
      },
    }),
    client.addNewWorkspaceItem({
      id: "task",
      Component: createTaskField((id) => client.openSettings(id)),
    }),
    client.addAttachmentSource(taskAttachments),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
