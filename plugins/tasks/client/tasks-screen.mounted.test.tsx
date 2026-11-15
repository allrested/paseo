/**
 * @vitest-environment jsdom
 */
// The tasks screen, mounted. The kit's parts are the host's, so react-native's own stand in for
// the scroll view and the fields, and plain elements for the rest; the RPCs are the test's.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Image } from "react-native";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PluginRpcProvider } from "@getpaseo/plugin/client/host";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { LinkedWorkspaces, TaskDetail, TaskList, TaskRow } from "../shared/contracts.js";
import { forgetPlace } from "./new-issue.js";
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
  assignedToMe: true,
  images: [],
  reviewThreads: false,
};
const REQUEST_PAGE: TaskDetail = {
  ...REQUEST,
  description: "Closes **#7**",
  markdown: true,
  details: [["Branches", "7-rate-limit → main"]],
  comments: [],
  earlierComments: 0,
  changes: [],
  assignedToMe: true,
  images: [],
  reviewThreads: false,
};

type Answer = unknown | Error | ((input: never) => unknown);

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
  const value =
    typeof answer === "function" ? (answer as (input: unknown) => unknown)(input) : answer;
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
  forgetPlace();
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
  await press("Connect Jira, GitLab or GitHub");
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
  expect(text()).toContain("No open issues, merge requests or pull requests are assigned to you");
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

// Making an issue, taking a task, and the pictures of a description.

const ONE_TRACKER = { sources: [{ source: "gitlab", kinds: false }] };
const THREE_TRACKERS = {
  sources: [
    { source: "jira", kinds: true },
    { source: "gitlab", kinds: false },
    { source: "github", kinds: false },
  ],
};
const PLACES: Record<string, Array<{ id: string; label: string }>> = {
  jira: [{ id: "BWLT", label: "BWLT · Wallet" }],
  gitlab: [
    { id: "42", label: "shop/web" },
    { id: "43", label: "shop/api" },
  ],
  github: [{ id: "shop/api", label: "shop/api" }],
};
const KINDS = {
  kinds: [
    { id: "10001", label: "Story" },
    { id: "10002", label: "Task" },
    { id: "10004", label: "Bug" },
  ],
};

function formAnswers(trackers: object = ONE_TRACKER): void {
  answers["tasks.sources.list"] = trackers;
  answers["tasks.places.list"] = ({ source }: { source: string }) => ({ places: PLACES[source] });
  answers["tasks.kinds.list"] = KINDS;
  answers["tasks.create"] = { id: "gitlab:issue:42:9" };
}

const labels = () => buttons().map((each) => each.getAttribute("aria-label"));
const radios = () =>
  [...container.querySelectorAll<HTMLElement>('[role="radio"]')].map((each) => [
    each.getAttribute("aria-label"),
    each.getAttribute("aria-checked"),
  ]);
const pick = (label: string) =>
  act(async () =>
    container.querySelector<HTMLElement>(`[role="radio"][aria-label="${label}"]`)?.click(),
  );
const checkbox = () => container.querySelector<HTMLElement>('[role="checkbox"]');
const sent = (method: string) =>
  calls.filter(([name]) => name === method).map(([, input]) => input);
const disabled = (label: string) => button(label).getAttribute("aria-disabled") === "true";

async function remount(params: Record<string, string>): Promise<void> {
  act(() => root.unmount());
  root = createRoot(container);
  await mount(params);
}

test("the list offers a new issue once a tracker is connected, and the form opens on this screen", async () => {
  await mount();
  await press("New issue");
  expect(opened).toEqual([["screen", { screenId: "tasks", params: { new: "issue" } }]]);
});

test("with no tracker connected the list offers no new issue", async () => {
  answers["tasks.list"] = { configured: false, issues: [], mergeRequests: [], problems: [] };
  await mount();
  expect(labels()).not.toContain("New issue");
});

test("with one tracker the form asks for no tracker, lists its projects, and makes the issue", async () => {
  formAnswers();
  await mount({ new: "issue" });
  await settle();
  expect(headings()).toEqual(["New issue"]);
  expect(text()).toContain("GitLab issue");
  // One tracker: nothing to choose between.
  expect(radios()).toEqual([]);
  expect(sent("tasks.places.list")).toEqual([{ source: "gitlab", query: "" }]);
  expect(disabled("Create issue")).toBe(true);
  await press("shop/web");
  expect(text()).toContain("shop/web");
  expect(field("Search projects")).toBeNull();
  await type("Title", "  Cache the price list ");
  await type("Description", "It is read on every page.");
  expect(text()).toContain("GitLab reads this as Markdown");
  expect(disabled("Create issue")).toBe(false);
  await press("Create issue");
  await settle();
  expect(sent("tasks.create")).toEqual([
    {
      source: "gitlab",
      place: "42",
      title: "  Cache the price list ",
      description: "It is read on every page.",
      assign: true,
    },
  ]);
  expect(opened).toEqual([
    ["screen", { screenId: "tasks", params: { task: "gitlab:issue:42:9" } }],
  ]);
  expect(toasts).toEqual([]);
  // Behind the new task's page the form is empty: going back does not offer the issue again.
  expect(field("Title").value).toBe("");
  expect(field("Description").value).toBe("");
});

test("an issue is not made before it has a place and a title", async () => {
  formAnswers();
  await mount({ new: "issue" });
  await settle();
  await type("Title", "Cache the price list");
  expect(disabled("Create issue")).toBe(true);
  await press("shop/api");
  expect(disabled("Create issue")).toBe(false);
  await type("Title", "   ");
  expect(disabled("Create issue")).toBe(true);
  expect(sent("tasks.create")).toEqual([]);
});

test("with several trackers one is picked, and each lists its own places", async () => {
  formAnswers(THREE_TRACKERS);
  await mount({ new: "issue" });
  await settle();
  expect(radios()).toEqual([
    ["Jira", "true"],
    ["GitLab", "false"],
    ["GitHub", "false"],
  ]);
  expect(text()).toContain("Jira takes this as plain text");
  await pick("GitHub");
  await settle();
  expect(radios()).toEqual([
    ["Jira", "false"],
    ["GitLab", "false"],
    ["GitHub", "true"],
  ]);
  expect(text()).toContain("Repository");
  expect(field("Search repositories")).not.toBeNull();
  expect(sent("tasks.places.list")).toEqual([
    { source: "jira", query: "" },
    { source: "github", query: "" },
  ]);
});

test("a Jira project's kinds are offered once it is picked, the usual one to start with", async () => {
  formAnswers(THREE_TRACKERS);
  answers["tasks.create"] = { id: "jira:BWLT-99" };
  await mount({ new: "issue" });
  await settle();
  expect(sent("tasks.kinds.list")).toEqual([]);
  await press("BWLT · Wallet");
  await settle();
  expect(sent("tasks.kinds.list")).toEqual([{ source: "jira", place: "BWLT" }]);
  expect(radios().slice(3)).toEqual([
    ["Story", "false"],
    ["Task", "true"],
    ["Bug", "false"],
  ]);
  await pick("Bug");
  await type("Title", "The total is wrong");
  await press("Create issue");
  await settle();
  expect(sent("tasks.create")).toEqual([
    {
      source: "jira",
      place: "BWLT",
      kind: "10004",
      title: "The total is wrong",
      description: "",
      assign: true,
    },
  ]);
});

test("changing the place asks for another, and a tracker picked again starts from none", async () => {
  formAnswers(THREE_TRACKERS);
  await mount({ new: "issue" });
  await settle();
  await press("BWLT · Wallet");
  await settle();
  await press("Change project");
  expect(field("Search projects")).not.toBeNull();
  expect(radios()).toHaveLength(3);
  await press("BWLT · Wallet");
  await settle();
  await pick("GitLab");
  await settle();
  // GitLab's issues have no kinds, and Jira's project is not GitLab's.
  expect(radios()).toHaveLength(3);
  expect(labels()).toContain("shop/web");
});

test("typing narrows the places once the words have settled", async () => {
  formAnswers();
  await mount({ new: "issue" });
  await settle();
  await type("Search projects", " api ");
  await settle(350);
  expect(sent("tasks.places.list")).toEqual([
    { source: "gitlab", query: "" },
    { source: "gitlab", query: "api" },
  ]);
});

test("a search that finds no place says so, and an account that sees none says that", async () => {
  formAnswers();
  answers["tasks.places.list"] = { places: [] };
  await mount({ new: "issue" });
  await settle();
  expect(text()).toContain("The saved account sees no projects");
  await type("Search projects", "zzz");
  await settle(350);
  expect(text()).toContain('No project matches "zzz"');
});

test("places that cannot be read say why, and Try again reads them", async () => {
  formAnswers();
  answers["tasks.places.list"] = failure("GitLab rejected the saved sign-in details.");
  await mount({ new: "issue" });
  await settle();
  expect(alerts()).toEqual(["GitLab rejected the saved sign-in details."]);
  answers["tasks.places.list"] = { places: PLACES.gitlab };
  await press("Try again");
  await settle();
  expect(alerts()).toEqual([]);
  expect(labels()).toContain("shop/web");
});

test("an issue that is not for me is made unassigned", async () => {
  formAnswers();
  await mount({ new: "issue" });
  await settle();
  expect(checkbox()?.getAttribute("aria-checked")).toBe("true");
  await act(async () => checkbox()?.click());
  expect(checkbox()?.getAttribute("aria-checked")).toBe("false");
  await press("shop/web");
  await type("Title", "Cache the price list");
  await press("Create issue");
  await settle();
  expect(sent("tasks.create")).toMatchObject([{ assign: false }]);
});

test("a refused issue keeps what was typed and says why above the buttons", async () => {
  formAnswers();
  answers["tasks.create"] = failure("GitLab refused the change: Title is too long.");
  await mount({ new: "issue" });
  await settle();
  await press("shop/web");
  await type("Title", "Cache the price list");
  await press("Create issue");
  await settle();
  expect(alerts()).toEqual(["GitLab refused the change: Title is too long."]);
  expect(field("Title").value).toBe("Cache the price list");
  expect(opened).toEqual([]);
  // The next try clears it, and one that is taken leaves none.
  answers["tasks.create"] = { id: "gitlab:issue:42:9" };
  await press("Create issue");
  await settle();
  expect(alerts()).toEqual([]);
  expect(opened).toHaveLength(1);
});

test("an issue that is made but not assigned opens, and says what went wrong", async () => {
  formAnswers();
  const warning =
    "The issue is made, but it could not be assigned to you: GitLab answered HTTP 403.";
  answers["tasks.create"] = { id: "gitlab:issue:42:9", warning };
  await mount({ new: "issue" });
  await settle();
  await press("shop/web");
  await type("Title", "Cache the price list");
  await press("Create issue");
  await settle();
  expect(toasts).toEqual([warning]);
  expect(opened).toEqual([
    ["screen", { screenId: "tasks", params: { task: "gitlab:issue:42:9" } }],
  ]);
});

test("the next form starts where the last issue went", async () => {
  formAnswers(THREE_TRACKERS);
  await mount({ new: "issue" });
  await settle();
  await pick("GitLab");
  await settle();
  await press("shop/api");
  await type("Title", "Cache the price list");
  await press("Create issue");
  await settle();
  await remount({ new: "issue" });
  await settle();
  expect(radios()).toEqual([
    ["Jira", "false"],
    ["GitLab", "true"],
    ["GitHub", "false"],
  ]);
  expect(text()).toContain("shop/api");
  expect(field("Search projects")).toBeNull();
});

test("a new issue makes the list beside the form read again", async () => {
  formAnswers();
  await mount({ new: "issue" }, false);
  await settle();
  expect(sent("tasks.list")).toHaveLength(1);
  await press("shop/web");
  await type("Title", "Cache the price list");
  await press("Create issue");
  await settle();
  expect(sent("tasks.list")).toHaveLength(2);
});

test("Cancel returns to the list, and the form with no tracker leads to the connections", async () => {
  formAnswers();
  await mount({ new: "issue" });
  await settle();
  await press("Cancel");
  expect(opened).toEqual([["screen", { screenId: "tasks" }]]);
  queries.clear();
  answers["tasks.sources.list"] = { sources: [] };
  await remount({ new: "issue" });
  await settle();
  expect(text()).toContain("No tracker is connected");
  await press("Connect Jira, GitLab or GitHub");
  expect(opened.at(-1)).toEqual(["settings", "connections"]);
});

test("a form that cannot learn the trackers says why, and Try again asks", async () => {
  answers["tasks.sources.list"] = failure("The task connections cannot be read: disk full");
  await mount({ new: "issue" });
  await settle();
  expect(alerts()).toEqual(["The task connections cannot be read: disk full"]);
  formAnswers();
  await press("Try again");
  await settle();
  expect(headings()).toEqual(["New issue"]);
});

test("on a window with no room for both, the form has its own way back", async () => {
  formAnswers();
  screenWidth = 600;
  await mount({ new: "issue" }, false);
  await settle();
  await press("Back to the list");
  expect(opened).toEqual([["screen", { screenId: "tasks" }]]);
});

test("a task that is another's can be taken, and then no longer offers it", async () => {
  answers["tasks.detail"] = { ...ISSUE_PAGE, assignedToMe: false };
  answers["tasks.assign"] = {
    ...ISSUE_PAGE,
    details: [...ISSUE_PAGE.details, ["Assignee", "Rina Putri"]],
  };
  await mount({ task: "jira:BWLT-12" }, false);
  expect(sent("tasks.list")).toHaveLength(1);
  await press("Assign to me");
  await settle();
  expect(sent("tasks.assign")).toEqual([{ id: "jira:BWLT-12" }]);
  expect(text()).toContain("AssigneeRina Putri");
  expect(labels()).not.toContain("Assign to me");
  // It is among mine now: the list beside the page reads again.
  expect(sent("tasks.list")).toHaveLength(2);
});

test("a task that is mine offers no taking, and a refused one says why", async () => {
  await mount({ task: "jira:BWLT-12" });
  expect(labels()).not.toContain("Assign to me");
  forgetTasks();
  answers["tasks.detail"] = { ...ISSUE_PAGE, assignedToMe: false };
  answers["tasks.assign"] = failure("Jira does not let the saved account do that.");
  await remount({ task: "jira:BWLT-12" });
  await press("Assign to me");
  await settle();
  expect(alerts()).toEqual(["Jira does not let the saved account do that."]);
  expect(labels()).toContain("Assign to me");
});

const pictures = () =>
  [...container.querySelectorAll<HTMLElement>('[role="img"]')].map((each) =>
    each.getAttribute("aria-label"),
  );
const PNG = { mime: "image/png", data: "iVBORw0KGgo=" };

test("the pictures of a description are read one by one and shown under its text", async () => {
  vi.spyOn(Image, "getSize").mockImplementation((_uri, success) => success(400, 200));
  answers["tasks.detail"] = {
    ...ISSUE_PAGE,
    description: "Before: (image: error.png)",
    images: [
      { id: "10001", name: "error.png" },
      { id: "10003", name: "after" },
    ],
  };
  answers["tasks.images.read"] = PNG;
  await mount({ task: "jira:BWLT-12" });
  await settle();
  expect(sent("tasks.images.read")).toEqual([
    { id: "jira:BWLT-12", image: "10001" },
    { id: "jira:BWLT-12", image: "10003" },
  ]);
  expect(pictures()).toEqual(["error.png", "after"]);
});

test("a picture that cannot be read says why beside its name, and Try again reads it", async () => {
  vi.spyOn(Image, "getSize").mockImplementation((_uri, success) => success(400, 200));
  answers["tasks.detail"] = { ...ISSUE_PAGE, images: [{ id: "10001", name: "error.png" }] };
  answers["tasks.images.read"] = failure("The image is too large to show here.");
  await mount({ task: "jira:BWLT-12" });
  await settle();
  expect(text()).toContain("error.png: The image is too large to show here.");
  expect(pictures()).toEqual([]);
  answers["tasks.images.read"] = PNG;
  await press("Try again");
  await settle();
  expect(pictures()).toEqual(["error.png"]);
});

test("a file that is no picture the app can draw says so", async () => {
  vi.spyOn(Image, "getSize").mockImplementation((_uri, _success, failed) =>
    failed?.(new Error("decode")),
  );
  answers["tasks.detail"] = { ...ISSUE_PAGE, images: [{ id: "10001", name: "error.svg" }] };
  answers["tasks.images.read"] = { mime: "image/svg+xml", data: "PHN2Zy8+" };
  await mount({ task: "jira:BWLT-12" });
  await settle();
  expect(text()).toContain("error.svg: this picture cannot be drawn here");
});

test("a task with many pictures reads four, and the rest when asked", async () => {
  vi.spyOn(Image, "getSize").mockImplementation((_uri, success) => success(400, 200));
  const images = [1, 2, 3, 4, 5, 6].map((at) => ({ id: `${at}`, name: `shot ${at}` }));
  answers["tasks.detail"] = { ...ISSUE_PAGE, images };
  answers["tasks.images.read"] = PNG;
  await mount({ task: "jira:BWLT-12" });
  await settle();
  expect(sent("tasks.images.read")).toHaveLength(4);
  await press("Show 2 more pictures");
  await settle();
  expect(sent("tasks.images.read")).toHaveLength(6);
  expect(pictures()).toHaveLength(6);
});

test("Space picks a chip and turns the check, as a browser's own controls do", async () => {
  formAnswers(THREE_TRACKERS);
  await mount({ new: "issue" });
  await settle();
  const space = (element: HTMLElement | null) =>
    act(async () => {
      element?.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
      );
    });
  await space(checkbox());
  expect(checkbox()?.getAttribute("aria-checked")).toBe("false");
  await space(container.querySelector<HTMLElement>('[role="radio"][aria-label="GitHub"]'));
  await settle();
  expect(radios()).toEqual([
    ["Jira", "false"],
    ["GitLab", "false"],
    ["GitHub", "true"],
  ]);
});

// A merge request's review threads.

const OPEN_THREAD = {
  id: "87805b7c09016a7058e91bdbe7b29d1f284a39e6",
  resolved: false,
  where: "src/limiter.ts:27",
  notes: [
    { id: "42", author: "Rina Putri", at: "2026-11-15T10:00:00.000Z", text: "Why **5**?" },
    { id: "43", author: "Dimas", at: "2026-11-15T11:00:00.000Z", text: "The login default." },
  ],
};
const WHOLE_THREAD = {
  id: "4444444444444444444444444444444444444444",
  resolved: false,
  notes: [{ id: "46", author: "Rina Putri", at: "", text: "Split this in two?" }],
};
const DONE_THREAD = {
  id: "3333333333333333333333333333333333333333",
  resolved: true,
  resolvedBy: "Dimas",
  where: "src/limiter.test.ts:4",
  notes: [{ id: "44", author: "Rina Putri", at: "", text: "Add a test for the cooldown." }],
};
const REVIEW = { threads: [OPEN_THREAD, WHOLE_THREAD, DONE_THREAD], more: false };

async function review(threads: object = REVIEW): Promise<void> {
  answers["tasks.detail"] = { ...REQUEST_PAGE, reviewThreads: true };
  answers["tasks.threads.list"] = threads;
  await mount({ task: "gitlab:mr:42:12" });
  await settle();
}

test("a merge request's open threads show in full, each with where it is and what was said", async () => {
  await review();
  expect(sent("tasks.threads.list")).toEqual([{ id: "gitlab:mr:42:12" }]);
  expect(headings()).toEqual(["Add the rate limiter", "Description", "Review threads", "Comments"]);
  expect(text()).toContain("2 open · 1 resolved");
  expect(text()).toContain("src/limiter.ts:27");
  expect(text()).toContain("Rina Putri · 2 h agoWhy **5**?");
  expect(text()).toContain("Dimas · 1 h agoThe login default.");
  expect(text()).toContain("On the whole merge request");
  // GitLab writes Markdown: a thread's note is rendered as the description is.
  expect(
    [...container.querySelectorAll("[data-markdown]")].map((each) => each.textContent),
  ).toContain("Why **5**?");
  // A resolved thread waits behind its button.
  expect(text()).not.toContain("Add a test for the cooldown.");
  expect(labels()).toEqual(
    expect.arrayContaining([
      "Reply on src/limiter.ts:27",
      "Resolve the thread on src/limiter.ts:27",
      "Reply on Rina Putri's thread",
      "Resolve the thread on Rina Putri's thread",
      "Show 1 resolved thread",
    ]),
  );
});

test("the resolved threads show on a press, each with who resolved it and a way to open it again", async () => {
  await review();
  await press("Show 1 resolved thread");
  expect(text()).toContain("src/limiter.test.ts:4");
  expect(text()).toContain("Resolved by Dimas");
  expect(text()).toContain("Add a test for the cooldown.");
  expect(labels()).toContain("Reopen the thread on src/limiter.test.ts:4");
  await press("Hide the resolved thread");
  expect(text()).not.toContain("Add a test for the cooldown.");
});

test("a reply is written in the thread's own box, sent, and the thread shows it", async () => {
  await review();
  expect(field("Write a reply on src/limiter.ts:27")).toBeNull();
  await press("Reply on src/limiter.ts:27");
  expect(disabled("Post the reply on src/limiter.ts:27")).toBe(true);
  await type("Write a reply on src/limiter.ts:27", "Raised to 10.");
  const answered = {
    ...OPEN_THREAD,
    notes: [...OPEN_THREAD.notes, { id: "47", author: "Fake Me", at: NOW, text: "Raised to 10." }],
  };
  answers["tasks.threads.reply"] = { threads: [answered, WHOLE_THREAD, DONE_THREAD], more: false };
  await press("Post the reply on src/limiter.ts:27");
  await settle();
  expect(sent("tasks.threads.reply")).toEqual([
    { id: "gitlab:mr:42:12", thread: OPEN_THREAD.id, text: "Raised to 10." },
  ]);
  expect(text()).toContain("Fake Me · just nowRaised to 10.");
  // The box closes once the reply is in, and the threads are not read a second time.
  expect(field("Write a reply on src/limiter.ts:27")).toBeNull();
  expect(sent("tasks.threads.list")).toHaveLength(1);
});

test("a refused reply stays in its box with the reason, and Cancel closes the box", async () => {
  await review();
  await press("Reply on Rina Putri's thread");
  await type("Write a reply on Rina Putri's thread", "One is enough.");
  answers["tasks.threads.reply"] = failure(
    "GitLab did not allow the change. Check what the saved token may do.",
  );
  await press("Post the reply on Rina Putri's thread");
  await settle();
  expect(alerts()).toEqual(["GitLab did not allow the change. Check what the saved token may do."]);
  expect(field("Write a reply on Rina Putri's thread").value).toBe("One is enough.");
  await press("Cancel the reply on Rina Putri's thread");
  expect(field("Write a reply on Rina Putri's thread")).toBeNull();
});

test("resolving a thread sends it, and the thread joins the resolved ones", async () => {
  await review();
  answers["tasks.threads.resolve"] = {
    threads: [WHOLE_THREAD, { ...OPEN_THREAD, resolved: true, resolvedBy: "Fake Me" }, DONE_THREAD],
    more: false,
  };
  await press("Resolve the thread on src/limiter.ts:27");
  await settle();
  expect(sent("tasks.threads.resolve")).toEqual([
    { id: "gitlab:mr:42:12", thread: OPEN_THREAD.id, resolved: true },
  ]);
  expect(text()).toContain("1 open · 2 resolved");
  expect(text()).not.toContain("The login default.");
  await press("Show 2 resolved threads");
  expect(text()).toContain("Resolved by Fake Me");
  answers["tasks.threads.resolve"] = REVIEW;
  await press("Reopen the thread on src/limiter.ts:27");
  await settle();
  expect(sent("tasks.threads.resolve").at(-1)).toEqual({
    id: "gitlab:mr:42:12",
    thread: OPEN_THREAD.id,
    resolved: false,
  });
  expect(text()).toContain("2 open · 1 resolved");
});

test("a thread that cannot be resolved says why under its button and stays open", async () => {
  await review();
  answers["tasks.threads.resolve"] = failure(
    "GitLab did not allow the change. Check what the saved token may do.",
  );
  await press("Resolve the thread on src/limiter.ts:27");
  await settle();
  expect(alerts()).toEqual(["GitLab did not allow the change. Check what the saved token may do."]);
  expect(text()).toContain("2 open · 1 resolved");
});

test("a review with every thread resolved says so, and one with none says that", async () => {
  await review({ threads: [DONE_THREAD], more: false });
  expect(text()).toContain("The one thread is resolved");
  expect(labels()).toContain("Show 1 resolved thread");
  queries.clear();
  act(() => root.unmount());
  root = createRoot(container);
  await review({ threads: [], more: false });
  expect(text()).toContain("No review threads");
});

test("a review longer than was read says where the rest is", async () => {
  await review({ threads: [OPEN_THREAD], more: true });
  expect(text()).toContain("GitLab holds more threads than are shown here");
});

test("threads that cannot be read say why, and Try again reads them; the page stays", async () => {
  await review(failure("GitLab rejected the saved sign-in details."));
  expect(alerts()).toEqual(["GitLab rejected the saved sign-in details."]);
  expect(headings()).toContain("Comments");
  answers["tasks.threads.list"] = REVIEW;
  await press("Try again");
  await settle();
  expect(alerts()).toEqual([]);
  expect(text()).toContain("2 open · 1 resolved");
});

test("a task whose review Paseo does not read asks for no threads", async () => {
  answers["tasks.detail"] = REQUEST_PAGE;
  await mount({ task: "gitlab:mr:42:12" });
  await settle();
  expect(sent("tasks.threads.list")).toEqual([]);
  expect(headings()).not.toContain("Review threads");
});
