import { useCallback } from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { ConnectionsScreen } from "./client/connections-screen.js";
import { createTaskField } from "./client/task-field.js";
import { createTasksScreen } from "./client/tasks-screen.js";
import { CONNECTIONS_SCREEN, TASKS_SCREEN, taskAttachments } from "./shared/contracts.js";

const ICON = "CircleDot";
const TITLE = "Tasks";

function TasksItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: TASKS_SCREEN }), [openScreen]);
  return (
    <SidebarRow icon={ICON} active={currentScreen?.screenId === TASKS_SCREEN} onPress={open} />
  );
}

// A built-in has no row in Settings > Plugins: the sidebar item and the Command Center items are
// the ways in. Settings > Sidebar can hide the item.
export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({
      id: TASKS_SCREEN,
      title: TITLE,
      Component: createTasksScreen({
        openScreen: (input) => client.openScreen(input),
        openSettings: (id) => client.openSettings(id),
      }),
    }),
    client.addSidebarHeaderItem({ id: TASKS_SCREEN, title: TITLE, Component: TasksItem }),
    client.addCommandCenterItem({
      id: "open-tasks",
      title: "Open tasks",
      icon: ICON,
      keywords: ["jira", "gitlab", "issue", "ticket", "merge request", "review"],
      context: "global",
      onSelect({ openScreen }) {
        openScreen({ screenId: TASKS_SCREEN });
      },
    }),
    client.addSettingsScreen({
      id: CONNECTIONS_SCREEN,
      title: "Task connections",
      icon: ICON,
      Component: ConnectionsScreen,
    }),
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
