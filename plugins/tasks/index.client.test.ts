// What the plugin adds to a client: the connections screen, the way to it, the Task field and the
// attachment source.
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { expect, test, vi } from "vitest";
import contribute from "./index.client.js";

vi.mock("./client/connections-screen.js", () => ({ ConnectionsScreen: () => null }));
vi.mock("./client/task-field.js", () => ({ createTaskField: () => () => null }));

interface Added {
  kind: string;
  id: string;
  title?: string;
  onSelect?(actions: { openSettings(id: string): void }): void;
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
    addSettingsScreen: add("settings"),
    addCommandCenterItem: add("command"),
    addNewWorkspaceItem: add("new-workspace"),
    addAttachmentSource: add("attachment"),
    openSettings: () => {},
  } as unknown as PluginClientContext;
  return { added, removed, dispose: contribute(client) };
}

test("adds the screen, a Command Center item for it, the Task field and the attachment source", () => {
  const { added } = setup();
  expect(added.map((each) => [each.kind, each.id, each.title])).toEqual([
    ["settings", "connections", "Task connections"],
    ["command", "open-connections", "Task connections"],
    ["new-workspace", "task", undefined],
    ["attachment", "tasks", "Task"],
  ]);
  expect(added[3].search?.name).toBe("tasks.attachments.search");
});

test("the Command Center item opens the connections screen", () => {
  const { added } = setup();
  const opened: string[] = [];
  added[1].onSelect?.({ openSettings: (id) => void opened.push(id) });
  expect(opened).toEqual(["connections"]);
});

test("disposing removes everything it added", () => {
  const { removed, dispose } = setup();
  dispose();
  expect(removed).toEqual([
    "settings:connections",
    "command:open-connections",
    "new-workspace:task",
    "attachment:tasks",
  ]);
});
