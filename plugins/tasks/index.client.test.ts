// What the plugin adds to a client: the tasks screen and the ways to it, the connections screen
// and the way to it, the Task field and the attachment source.
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { expect, test, vi } from "vitest";
import contribute from "./index.client.js";

vi.mock("./client/connections-screen.js", () => ({ ConnectionsScreen: () => null }));
vi.mock("./client/task-field.js", () => ({ createTaskField: () => () => null }));
vi.mock("./client/tasks-screen.js", () => ({ createTasksScreen: () => () => null }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ SidebarRow: () => null }));

interface Added {
  kind: string;
  id: string;
  title?: string;
  onSelect?(actions: {
    openSettings(id: string): void;
    openScreen(input: { screenId: string }): void;
  }): void;
  search?: { name: string };
}

function setup() {
  const added: Added[] = [];
  const removed: string[] = [];
  const add = (kind: string) => (contribution: Omit<Added, "kind">) => {
    added.push({ kind, ...contribution });
    return () => void removed.push(`${kind}:${contribution.id}`);
  };
  const client = {
    addScreen: add("screen"),
    addSidebarHeaderItem: add("sidebar"),
    addSettingsScreen: add("settings"),
    addCommandCenterItem: add("command"),
    addNewWorkspaceItem: add("new-workspace"),
    addAttachmentSource: add("attachment"),
    openSettings: () => {},
    openScreen: () => {},
  } as unknown as PluginClientContext;
  return { added, removed, dispose: contribute(client) };
}

test("adds both screens, the ways to them, the Task field and the attachment source", () => {
  const { added } = setup();
  expect(added.map((each) => [each.kind, each.id, each.title])).toEqual([
    ["screen", "tasks", "Tasks"],
    ["sidebar", "tasks", "Tasks"],
    ["command", "open-tasks", "Open tasks"],
    ["settings", "connections", "Task connections"],
    ["command", "open-connections", "Task connections"],
    ["new-workspace", "task", undefined],
    ["attachment", "tasks", "Task"],
  ]);
  expect(added[6].search?.name).toBe("tasks.attachments.search");
});

test("the Command Center items open the tasks screen and the connections screen", () => {
  const { added } = setup();
  const opened: string[] = [];
  const actions = {
    openSettings: (id: string) => void opened.push(`settings:${id}`),
    openScreen: (input: { screenId: string }) => void opened.push(`screen:${input.screenId}`),
  };
  added[2].onSelect?.(actions);
  added[4].onSelect?.(actions);
  expect(opened).toEqual(["screen:tasks", "settings:connections"]);
});

test("disposing removes everything it added", () => {
  const { removed, dispose } = setup();
  dispose();
  expect(removed).toEqual([
    "screen:tasks",
    "sidebar:tasks",
    "command:open-tasks",
    "settings:connections",
    "command:open-connections",
    "new-workspace:task",
    "attachment:tasks",
  ]);
});
