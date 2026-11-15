/**
 * @vitest-environment jsdom
 */
// The New workspace screen's Task field, mounted. The Combobox is the host's, so a stand-in keeps
// what the field passed it and the test plays the user: it opens the list and picks a row.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { FieldItem } from "./picker.js";
import { createTaskField } from "./task-field.js";

interface Shown {
  title: string;
  value: { id: string; label: string } | null;
  search(event: { query: string }): Promise<readonly FieldItem[]>;
  onSelect(event: { item: FieldItem }): void | Promise<void>;
}

let shown: Shown;
let metadata: Record<string, unknown>;
let commands: Array<[string, unknown]>;
let found: { configured: boolean; tasks: object[] } | Error;
let queries: string[];

vi.mock("@getpaseo/plugin/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/plugin/client")>()),
  useNewWorkspace: () => ({
    metadata,
    setBranch: async (name: string | null) => void commands.push(["setBranch", name]),
    setMetadata: async (patch: object) => void commands.push(["setMetadata", patch]),
  }),
  useRpc:
    () =>
    async ({ query }: { query: string }) => {
      queries.push(query);
      if (found instanceof Error) throw found;
      return found;
    },
}));

vi.mock("@getpaseo/plugin/client/ui", () => ({
  Combobox: (props: Shown) => {
    shown = props;
    return null;
  },
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const TASK = {
  id: "jira:BWLT-12",
  label: "BWLT-12 Add the webhook",
  description: "Jira · In Progress",
  key: "BWLT-12",
  url: "https://team.atlassian.net/browse/BWLT-12",
  branch: "BWLT-12-add-the-webhook",
};

let container: HTMLElement;
let root: Root;
let opened: string[];

async function mount(): Promise<void> {
  const TaskField = createTaskField((id) => void opened.push(id));
  await act(async () => root.render(<TaskField />));
}

beforeEach(() => {
  metadata = {};
  commands = [];
  queries = [];
  opened = [];
  found = { configured: true, tasks: [TASK] };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("the field is empty until a task is picked, and lists what the host found", async () => {
  await mount();
  expect(shown.title).toBe("Task");
  expect(shown.value).toBeNull();
  expect(await shown.search({ query: "web" })).toEqual([{ kind: "task", ...TASK }]);
  expect(queries).toEqual(["web"]);
});

test("a pick names the branch after the task and leaves its key and link on the workspace", async () => {
  await mount();
  const [item] = await shown.search({ query: "" });
  await shown.onSelect({ item });
  expect(commands).toEqual([
    ["setBranch", "BWLT-12-add-the-webhook"],
    [
      "setMetadata",
      { "tasks.key": "BWLT-12", "tasks.url": "https://team.atlassian.net/browse/BWLT-12" },
    ],
  ]);
  expect(opened).toEqual([]);
});

test("a picked task shows by its key, and No task undoes the pick", async () => {
  metadata = { "tasks.key": "BWLT-12", "tasks.url": TASK.url };
  await mount();
  expect(shown.value).toEqual({ id: "BWLT-12", label: "BWLT-12" });
  const items = await shown.search({ query: "" });
  expect(items.map((item) => item.label)).toEqual(["No task", "BWLT-12 Add the webhook"]);
  await shown.onSelect({ item: items[0] });
  expect(commands).toEqual([
    ["setBranch", null],
    ["setMetadata", { "tasks.key": null, "tasks.url": null }],
  ]);
});

test("a failed search fails with the tracker's own sentence", async () => {
  found = new Error(
    "Request failed: Jira answered HTTP 500. requestType=plugin.rpc.invoke.request code=handler_error",
  );
  await mount();
  await expect(shown.search({ query: "" })).rejects.toThrow(/^Jira answered HTTP 500\.$/);
});

test("with no tracker connected the one row opens the connections and changes nothing", async () => {
  found = { configured: false, tasks: [] };
  await mount();
  const items = await shown.search({ query: "" });
  expect(items.map((item) => item.label)).toEqual(["Connect Jira or GitLab"]);
  await shown.onSelect({ item: items[0] });
  expect(opened).toEqual(["connections"]);
  expect(commands).toEqual([]);
});
