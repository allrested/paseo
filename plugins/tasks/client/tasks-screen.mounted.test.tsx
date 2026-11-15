/**
 * @vitest-environment jsdom
 */
// The tasks screen, mounted. The kit's parts are the host's, so react-native's own stand in for
// the scroll view and the fields, and plain elements for the rest; the RPCs are the test's.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PluginRpcProvider } from "@getpaseo/plugin/client/host";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { LinkedWorkspaces, TaskDetail, TaskList, TaskRow } from "../shared/contracts.js";
import { nextTask } from "./next-task.js";
import { forgetSearch } from "./task-list.js";
import { createTasksScreen, splitListWidth } from "./tasks-screen.js";
import { forgetTasks } from "./use-tasks.js";

let toasts: string[];
/** The width the screen is laid out at; jsdom lays nothing out. */
let screenWidth: number | null;

vi.mock("./device.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./device.js")>()),
  useMeasuredWidth: () => ({ width: screenWidth, onLayout: () => {} }),
}));

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView, TextInput, View } = await import("react-native");
  const { createElement } = await import("react");
  const toast = { show: (message: string) => void toasts.push(message), error: () => {} };
  return {
    ScrollView,
    TextInput,
    Icon: ({ name }: { name: string }) => createElement(View, { testID: `icon-${name}` }),
    Markdown: ({ children }: { children: string }) =>
      createElement("div", { "data-markdown": "" }, children),
    ExternalLink: ({ href, children }: { href: string; children: string }) =>
      createElement("a", { href }, children),
    useToast: () => toast,
  };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const NOW = "2026-11-15T12:00:00.000Z";

const ISSUE: TaskRow = {
  id: "jira:BWLT-12",
  source: "jira",
  kind: "issue",
  key: "BWLT-12",
  title: "Add the webhook",
  status: "In Progress",
  url: "https://team.atlassian.net/browse/BWLT-12",
  updatedAt: "2026-11-15T10:00:00.000Z",
};
const REQUEST: TaskRow = {
  id: "gitlab:mr:42:12",
  source: "gitlab",
  kind: "mr",
  key: "shop/web!12",
  title: "Add the rate limiter",
  status: "Open",
  url: "https://git.team.test/shop/web/-/merge_requests/12",
  note: "Review requested",
};
const LIST: TaskList = {
  configured: true,
  issues: [ISSUE],
  mergeRequests: [REQUEST],
  problems: [],
};
const ISSUE_PAGE: TaskDetail = {
  ...ISSUE,
  description: "Send it on *payment*.",
  markdown: false,
  details: [["Type", "Story"]],
  comments: [
    { id: "901", author: "Rina Putri", at: "2026-11-15T11:00:00.000Z", text: "Which env?" },
  ],
  earlierComments: 12,
  changes: [
    { id: "21", label: "In Review" },
    { id: "31", label: "Done" },
  ],
  branch: "BWLT-12-add-the-webhook",
};
const REQUEST_PAGE: TaskDetail = {
  ...REQUEST,
  description: "Closes **#7**",
  markdown: true,
  details: [["Branches", "7-rate-limit → main"]],
  comments: [],
  earlierComments: 0,
  changes: [],
};

type Answer = unknown | Error | (() => unknown);

let calls: Array<[method: string, input: unknown]>;
let answers: Record<string, Answer>;
let opened: unknown[];
let container: HTMLElement;
let root: Root;
/** The workspaces started on a task, and how often the screen read them. */
let linked: LinkedWorkspaces;
let linkedReads: number;
let queries: QueryClient;
/** False for a host from before screens could open a workspace. */
let navigates: boolean;

async function invoke(method: string, input: unknown): Promise<unknown> {
  // Read beside the trackers' own calls, and counted apart from them.
  if (method === "tasks.workspaces.linked") {
    linkedReads += 1;
    return linked;
  }
  calls.push([method, input]);
  const answer = answers[method];
  const value = typeof answer === "function" ? (answer as () => unknown)() : answer;
  if (value instanceof Error) throw value;
  return value;
}

const subscribe = () => {
  throw new Error("The tasks screen subscribes to nothing");
};

const TasksScreen = createTasksScreen({
  openScreen: (input) => void opened.push(["screen", input]),
  openSettings: (id) => void opened.push(["settings", id]),
});

function props(params: Record<string, string>, compact = true): PluginScreenProps {
  return {
    theme: { colors: new Proxy({}, { get: () => "#808080" }) },
    layout: { compact, platform: "web" },
    host: { id: "host", label: "Host" },
    params,
    ...(navigates
      ? {
          navigation: {
            openWorkspace: (input: object) => void opened.push(["workspace", input]),
            openAgent: () => {},
          },
        }
      : {}),
  } as unknown as PluginScreenProps;
}

const settle = (ms = 0) =>
  act(async () => void (await new Promise((done) => setTimeout(done, ms))));

async function mount(params: Record<string, string> = {}, compact = true): Promise<void> {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queries}>
        <PluginRpcProvider invoke={invoke} subscribe={subscribe}>
          <TasksScreen {...props(params, compact)} />
        </PluginRpcProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
}

const text = () => container.textContent ?? "";
const buttons = () => [...container.querySelectorAll<HTMLElement>('[role="button"]')];
const button = (label: string) => {
  const found = buttons().find((each) => each.getAttribute("aria-label") === label);
  if (!found)
    throw new Error(
      `No button "${label}" among ${buttons()
        .map((each) => each.getAttribute("aria-label"))
        .join(", ")}`,
    );
  return found;
};
const press = (label: string) => act(async () => button(label).click());
const headings = () =>
  [...container.querySelectorAll('[role="heading"]')].map((heading) => heading.textContent);
const alerts = () =>
  [...container.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent);
const field = (label: string) =>
  container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLTextAreaElement;

async function type(label: string, value: string): Promise<void> {
  const element = field(label);
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const failure = (sentence: string) =>
  new Error(`Request failed: ${sentence} requestType=plugin.rpc.invoke.request code=handler_error`);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  calls = [];
  opened = [];
  toasts = [];
  screenWidth = 860;
  answers = {
    "tasks.list": LIST,
    "tasks.detail": ISSUE_PAGE,
    "tasks.comments.add": ISSUE_PAGE,
    "tasks.status.change": ISSUE_PAGE,
  };
  linked = { workspaceIds: [], linked: [] };
  linkedReads = 0;
  navigates = true;
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  forgetTasks();
  forgetSearch();
  nextTask.set(null);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  queries.clear();
  container.remove();
  vi.useRealTimers();
});

test("the list shows my issues and merge requests, each with where it stands", async () => {
  await mount();
  expect(calls).toEqual([["tasks.list", { query: "" }]]);
  expect(headings()).toEqual(["Issues", "Merge requests"]);
  const rows = buttons().filter((each) =>
    each.getAttribute("aria-label")?.endsWith("Open the task"),
  );
  expect(rows.map((row) => row.textContent)).toEqual([
    "BWLT-12 Add the webhookIn Progress · 2 h ago · Jira",
    "shop/web!12 Add the rate limiterReview requested · GitLab",
  ]);
  expect(rows[0].getAttribute("aria-label")).toBe("BWLT-12 Add the webhook. Open the task");
});

test("pressing a row opens that task on this screen", async () => {
  await mount();
  await press("shop/web!12 Add the rate limiter. Open the task");
  expect(opened).toEqual([["screen", { screenId: "tasks", params: { task: "gitlab:mr:42:12" } }]]);
});

test("with no tracker connected the list says so and leads to the connections", async () => {
  answers["tasks.list"] = { configured: false, issues: [], mergeRequests: [], problems: [] };
  await mount();
  expect(text()).toContain("No tracker is connected");
  await press("Connect Jira or GitLab");
  expect(opened).toEqual([["settings", "connections"]]);
});

test("a list that cannot be read says why, and Try again reads it", async () => {
  answers["tasks.list"] = failure("Jira answered HTTP 500.");
  await mount();
  expect(alerts()).toEqual(["Jira answered HTTP 500."]);
  expect(headings()).toEqual([]);
  answers["tasks.list"] = LIST;
  await press("Try again");
  await settle();
  expect(alerts()).toEqual([]);
  expect(headings()).toEqual(["Issues", "Merge requests"]);
});

test("a list that failed in part names the failure above the rows it has", async () => {
  answers["tasks.list"] = {
    ...LIST,
    mergeRequests: [],
    problems: ["GitLab is limiting requests. Try again shortly."],
  };
  await mount();
  expect(alerts()).toEqual(["GitLab is limiting requests. Try again shortly."]);
  expect(headings()).toEqual(["Issues"]);
});

test("an empty list says so, and a search that finds nothing names what was typed", async () => {
  answers["tasks.list"] = { ...LIST, issues: [], mergeRequests: [] };
  await mount();
  expect(text()).toContain("No open issues or merge requests are assigned to you");
  await type("Search tasks", " webhook ");
  await settle(350);
  expect(calls.at(-1)).toEqual(["tasks.list", { query: "webhook" }]);
  expect(text()).toContain('Nothing matches "webhook"');
});

test("typing asks once the words have settled, not for every letter", async () => {
  await mount();
  await type("Search tasks", "w");
  await type("Search tasks", "we");
  await type("Search tasks", "web");
  await settle(350);
  expect(calls.map(([, input]) => (input as { query: string }).query)).toEqual(["", "web"]);
});

test("Refresh reads the list again", async () => {
  await mount();
  await press("Refresh the list");
  await settle();
  expect(calls).toEqual([
    ["tasks.list", { query: "" }],
    ["tasks.list", { query: "" }],
  ]);
});

test("a Jira issue's page shows its facts, its text as written, and its newest comments", async () => {
  await mount({ task: "jira:BWLT-12" });
  expect(calls).toEqual([["tasks.detail", { id: "jira:BWLT-12" }]]);
  expect(headings()).toEqual(["Add the webhook", "Description", "Comments"]);
  expect(text()).toContain("BWLT-12 · Jira issue");
  expect(text()).toContain("StatusIn Progress");
  expect(text()).toContain("TypeStory");
  expect(text()).toContain("Updated2 h ago");
  // Jira's text is plain: its asterisks are not emphasis.
  expect(text()).toContain("Send it on *payment*.");
  expect(container.querySelector("[data-markdown]")).toBeNull();
  expect(text()).toContain("12 earlier comments are on Jira");
  expect(text()).toContain("Rina Putri · 1 h agoWhich env?");
  expect(container.querySelector("a")?.getAttribute("href")).toBe(ISSUE.url);
  expect(container.querySelector("a")?.textContent).toBe("Open in Jira");
});

test("a merge request's page reads Markdown, and offers neither a move nor a workspace", async () => {
  answers["tasks.detail"] = REQUEST_PAGE;
  await mount({ task: "gitlab:mr:42:12" });
  expect(text()).toContain("shop/web!12 · GitLab merge request");
  expect(text()).toContain("Branches7-rate-limit → main");
  expect(container.querySelector("[data-markdown]")?.textContent).toBe("Closes **#7**");
  expect(text()).toContain("No comments yet");
  expect(text()).not.toContain("Move to");
  expect(buttons().map((each) => each.getAttribute("aria-label"))).toEqual(["Post comment"]);
});

test("a task with no description says so", async () => {
  answers["tasks.detail"] = { ...ISSUE_PAGE, description: "" };
  await mount({ task: "jira:BWLT-12" });
  expect(text()).toContain("No description");
});

test("a page that cannot be read says why, and Try again reads it", async () => {
  answers["tasks.detail"] = failure("Jira has no such issue, or the saved account cannot see it.");
  await mount({ task: "jira:BWLT-999" });
  expect(alerts()).toEqual(["Jira has no such issue, or the saved account cannot see it."]);
  answers["tasks.detail"] = ISSUE_PAGE;
  await press("Try again");
  await settle();
  expect(headings()).toContain("Add the webhook");
});

test("a move is sent, and the page shows the task as it then is", async () => {
  answers["tasks.status.change"] = {
    ...ISSUE_PAGE,
    status: "In Review",
    changes: [{ id: "31", label: "Done" }],
  };
  await mount({ task: "jira:BWLT-12" });
  await press("In Review");
  await settle();
  expect(calls.at(-1)).toEqual(["tasks.status.change", { id: "jira:BWLT-12", change: "21" }]);
  expect(text()).toContain("StatusIn Review");
  expect(buttons().map((each) => each.getAttribute("aria-label"))).not.toContain("In Review");
});

test("a refused move keeps the task as it was and says why under the button", async () => {
  answers["tasks.status.change"] = failure("Jira refused the change: Pick a resolution.");
  await mount({ task: "jira:BWLT-12" });
  await press("Done");
  await settle();
  expect(alerts()).toEqual(["Jira refused the change: Pick a resolution."]);
  expect(text()).toContain("StatusIn Progress");
});

test("a comment is posted as typed, shown, and the box is emptied", async () => {
  const posted = { id: "902", author: "Me", at: NOW, text: "On dev." };
  answers["tasks.comments.add"] = { ...ISSUE_PAGE, comments: [...ISSUE_PAGE.comments, posted] };
  await mount({ task: "jira:BWLT-12" });
  expect(button("Post comment").getAttribute("aria-disabled")).toBe("true");
  expect(text()).toContain("Posts to Jira as the account saved on this host");
  await type("Write a comment", "On dev.");
  await press("Post comment");
  await settle();
  expect(calls.at(-1)).toEqual(["tasks.comments.add", { id: "jira:BWLT-12", text: "On dev." }]);
  expect(text()).toContain("Me · just nowOn dev.");
  expect(field("Write a comment").value).toBe("");
});

test("a refused comment stays in the box, with the reason under the button", async () => {
  answers["tasks.comments.add"] = failure(
    "GitLab did not allow the change. Check what the saved token may do.",
  );
  await mount({ task: "jira:BWLT-12" });
  await type("Write a comment", "LGTM");
  await press("Post comment");
  await settle();
  expect(alerts()).toEqual(["GitLab did not allow the change. Check what the saved token may do."]);
  expect(field("Write a comment").value).toBe("LGTM");
});

test("an issue can be handed to the next workspace, and taken back", async () => {
  await mount({ task: "jira:BWLT-12" });
  await press("Use for the next workspace");
  expect(nextTask.get()).toEqual({
    id: "jira:BWLT-12",
    key: "BWLT-12",
    url: ISSUE.url,
    branch: "BWLT-12-add-the-webhook",
  });
  expect(toasts).toEqual(["New workspace will start on BWLT-12"]);
  await press("Do not use for the next workspace");
  expect(nextTask.get()).toBeNull();
});

test("on a wide layout the list stays beside the open task, and marks its row", async () => {
  await mount({ task: "jira:BWLT-12" }, false);
  expect(calls.map(([method]) => method).sort()).toEqual(["tasks.detail", "tasks.list"]);
  expect(headings()).toEqual([
    "Issues",
    "Merge requests",
    "Add the webhook",
    "Description",
    "Comments",
  ]);
  expect(button("BWLT-12 Add the webhook. Open the task").getAttribute("aria-selected")).toBe(
    "true",
  );
  expect(
    button("shop/web!12 Add the rate limiter. Open the task").getAttribute("aria-selected"),
  ).not.toBe("true");
});

test("a move shows on the task's row beside the page, without asking the trackers again", async () => {
  answers["tasks.status.change"] = { ...ISSUE_PAGE, status: "In Review", updatedAt: NOW };
  await mount({ task: "jira:BWLT-12" }, false);
  await press("In Review");
  await settle();
  expect(button("BWLT-12 Add the webhook. Open the task").textContent).toBe(
    "BWLT-12 Add the webhookIn Review · just now · Jira",
  );
  expect(calls.filter(([method]) => method === "tasks.list")).toHaveLength(1);
});

test("a wide window whose screen has no room for both shows one at a time, with a way back", async () => {
  // A tablet with the sidebar docked: 820 wide, 500 left for the screen.
  screenWidth = 500;
  await mount({}, false);
  expect(headings()).toEqual(["Issues", "Merge requests"]);
  expect(text()).not.toContain("Pick a task to read it");
  await mount({ task: "jira:BWLT-12" }, false);
  expect(text()).not.toContain("Merge requests");
  await press("Back to the list");
  expect(opened).toEqual([["screen", { screenId: "tasks" }]]);
});

test("a phone's page has no way back of its own: the header has it", async () => {
  await mount({ task: "jira:BWLT-12" });
  expect(buttons().map((each) => each.getAttribute("aria-label"))).not.toContain(
    "Back to the list",
  );
});

test("nothing is shown on a wide window before the screen knows its width", async () => {
  screenWidth = null;
  await mount({ task: "jira:BWLT-12" }, false);
  expect(text()).toBe("");
  expect(calls).toEqual([]);
});

test("the list gives way before the page does, and both need 640", () => {
  expect(splitListWidth(1200)).toBe(320);
  expect(splitListWidth(720)).toBe(320);
  expect(splitListWidth(680)).toBe(280);
  expect(splitListWidth(640)).toBe(240);
  expect(splitListWidth(639)).toBeNull();
});

test("on a wide layout with no task open the side says to pick one", async () => {
  await mount({}, false);
  expect(text()).toContain("Pick a task to read it");
  expect(calls).toEqual([["tasks.list", { query: "" }]]);
});

test("going back to the list shows what it held at once, then reads it again", async () => {
  await mount();
  await mount({ task: "jira:BWLT-12" });
  answers["tasks.list"] = () => new Promise(() => {});
  await mount();
  // The answer is still on its way, and the rows are up.
  expect(headings()).toEqual(["Issues", "Merge requests"]);
  expect(calls.filter(([method]) => method === "tasks.list")).toHaveLength(2);
});

const WORKSPACE = {
  workspaceId: "wks_1",
  name: "BWLT-12-add-the-webhook",
  key: "BWLT-12",
  url: ISSUE.url,
  taskId: "jira:BWLT-12",
  status: "In Progress",
  phase: "doing" as const,
};

test("a task that has a workspace opens it from its page", async () => {
  linked = { workspaceIds: ["wks_1"], linked: [WORKSPACE] };
  await mount({ task: "jira:BWLT-12" });
  await press("Open workspace");
  expect(opened).toEqual([["workspace", { workspaceId: "wks_1" }]]);
  // A second workspace can still be started on it.
  expect(button("Use for the next workspace")).toBeTruthy();
});

test("a task with several workspaces names each; one with none offers none", async () => {
  linked = {
    workspaceIds: ["wks_1", "wks_2", "wks_3"],
    linked: [
      WORKSPACE,
      { ...WORKSPACE, workspaceId: "wks_2", name: "BWLT-12-second-try" },
      { ...WORKSPACE, workspaceId: "wks_3", name: "other", key: "BWLT-13", taskId: "jira:BWLT-13" },
    ],
  };
  await mount({ task: "jira:BWLT-12" });
  const labels = buttons().map((each) => each.getAttribute("aria-label"));
  expect(labels.filter((label) => label?.startsWith("Open"))).toEqual([
    "Open BWLT-12-add-the-webhook",
    "Open BWLT-12-second-try",
  ]);
  await press("Open BWLT-12-second-try");
  expect(opened).toEqual([["workspace", { workspaceId: "wks_2" }]]);
  answers["tasks.detail"] = REQUEST_PAGE;
  await mount({ task: "gitlab:mr:42:12" });
  expect(buttons().some((each) => each.getAttribute("aria-label")?.startsWith("Open "))).toBe(
    false,
  );
});

test("a workspace from before the task's id was kept is found by its key", async () => {
  const { taskId: _none, ...byKey } = WORKSPACE;
  linked = { workspaceIds: ["wks_1"], linked: [byKey] };
  await mount({ task: "jira:BWLT-12" });
  expect(button("Open workspace")).toBeTruthy();
});

test("a host that cannot open a workspace from a screen offers no button for it", async () => {
  navigates = false;
  linked = { workspaceIds: ["wks_1"], linked: [WORKSPACE] };
  await mount({ task: "jira:BWLT-12" });
  expect(buttons().some((each) => each.getAttribute("aria-label") === "Open workspace")).toBe(
    false,
  );
});

test("a row whose task has a workspace is marked, and says so aloud", async () => {
  linked = { workspaceIds: ["wks_1"], linked: [WORKSPACE] };
  await mount();
  const row = button("BWLT-12 Add the webhook. Has a workspace. Open the task");
  expect(row.querySelector('[data-testid="icon-FolderGit2"]')).not.toBeNull();
  const other = button("shop/web!12 Add the rate limiter. Open the task");
  expect(other.querySelector('[data-testid="icon-FolderGit2"]')).toBeNull();
});

test("the list and the page beside it read the linked workspaces once between them", async () => {
  linked = { workspaceIds: ["wks_1"], linked: [WORKSPACE] };
  await mount({ task: "jira:BWLT-12" }, false);
  expect(linkedReads).toBe(1);
});

test("a move reads the linked workspaces again, so the sidebar's badge follows", async () => {
  linked = { workspaceIds: ["wks_1"], linked: [WORKSPACE] };
  answers["tasks.status.change"] = { ...ISSUE_PAGE, status: "In Review", updatedAt: NOW };
  await mount({ task: "jira:BWLT-12" });
  expect(linkedReads).toBe(1);
  await press("In Review");
  await settle();
  expect(linkedReads).toBe(2);
});
