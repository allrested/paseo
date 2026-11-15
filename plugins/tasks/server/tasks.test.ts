import { expect, test } from "vitest";
import type { Connections, Source } from "../shared/contracts.js";
import { DEFAULT_PROMPT } from "../shared/prompt.js";
import { TrackerError } from "./issue.js";
import { createTasks } from "./tasks.js";
import type { SavedTokens, TokenStore } from "./token-store.js";

const BOTH: Connections = {
  jiraSite: "https://team.atlassian.net",
  jiraEmail: "me@team.test",
  gitlabUrl: "https://git.team.test",
  githubUrl: "",
  promptTemplate: DEFAULT_PROMPT,
};
const NONE: Connections = { ...BOTH, jiraSite: "", jiraEmail: "", gitlabUrl: "" };

const JIRA_ISSUE = {
  key: "BWLT-12",
  fields: { summary: "Add the webhook", status: { name: "In Progress" }, description: null },
};
const GITLAB_ISSUE = {
  iid: 7,
  project_id: 42,
  state: "opened",
  user_notes_count: 1,
  title: "Rate limit the login form",
  description: "Five tries a minute.",
  web_url: "https://git.team.test/shop/web/-/issues/7",
  references: { full: "shop/web#7" },
};

const GITLAB_MR = {
  iid: 12,
  project_id: 42,
  title: "Add the rate limiter",
  description: "Closes #7",
  web_url: "https://git.team.test/shop/web/-/merge_requests/12",
  state: "opened",
  source_branch: "7-rate-limit",
  target_branch: "main",
  references: { full: "shop/web!12" },
  updated_at: "2026-11-14T04:00:00.000Z",
  user_notes_count: 1,
};
const GITLAB_NOTE = {
  id: 31,
  body: "Why 5?",
  author: { username: "rina", name: "Rina Putri" },
  created_at: "2026-11-14T05:00:00.000Z",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

type Respond = (url: URL, init: RequestInit) => Response;

function jiraAnswer(url: URL): Response {
  if (url.pathname.endsWith("/search/jql")) return json({ issues: [JIRA_ISSUE] });
  if (url.pathname.endsWith("/comment")) return json({ comments: [], total: 0 });
  if (url.pathname.endsWith("/transitions")) {
    return json({ transitions: [{ id: "21", name: "Review", to: { name: "In Review" } }] });
  }
  return json(JIRA_ISSUE);
}

function gitlabAnswer(url: URL): Response {
  if (url.pathname.endsWith("/user")) return json({ username: "rina" });
  if (url.pathname.endsWith("/notes")) return json([GITLAB_NOTE]);
  if (url.pathname.endsWith("/api/v4/issues")) return json([GITLAB_ISSUE]);
  if (url.pathname.endsWith("/api/v4/merge_requests")) return json([GITLAB_MR]);
  return json(url.pathname.includes("/merge_requests/") ? GITLAB_MR : GITLAB_ISSUE);
}

const GITHUB_ISSUE = {
  number: 9,
  title: "Cache the price list",
  body: "It is read on every page.",
  html_url: "https://github.com/shop/api/issues/9",
  state: "open",
  repository_url: "https://api.github.com/repos/shop/api",
  comments: 0,
};
const GITHUB_PULL = {
  ...GITHUB_ISSUE,
  number: 10,
  title: "Add the price cache",
  body: "Closes #9",
  html_url: "https://github.com/shop/api/pull/10",
  pull_request: { merged_at: null },
};

function githubAnswer(url: URL): Response {
  if (url.pathname === "/user") return json({ login: "rina", name: "Rina Putri" });
  if (url.pathname === "/search/issues") {
    const pulls = url.searchParams.get("q")?.includes("is:pr");
    return json({ items: [pulls ? GITHUB_PULL : GITHUB_ISSUE] });
  }
  return json(url.pathname.endsWith("/10") ? GITHUB_PULL : GITHUB_ISSUE);
}

interface Setup {
  saved?: Connections;
  tokens?: SavedTokens;
  jira?: Respond;
  gitlab?: Respond;
  github?: Respond;
}

function setup(options: Setup = {}) {
  const saved = options.tokens ?? { jira: "jira-token", gitlab: "gitlab-token" };
  const writes: Array<[Source, string | null]> = [];
  const tokens: TokenStore = {
    read: async () => ({ ...saved }),
    async write(source, token) {
      writes.push([source, token]);
      if (token === null) delete saved[source];
      else saved[source] = token;
    },
  };
  const asked: string[] = [];
  const sent: Array<[method: string, path: string, body: unknown]> = [];
  const request: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    asked.push(url.host + url.pathname);
    if (init.method) sent.push([init.method, url.pathname, JSON.parse(String(init.body))]);
    if (url.host === "team.atlassian.net") return (options.jira ?? jiraAnswer)(url, init);
    if (url.host === "api.github.com") return (options.github ?? githubAnswer)(url, init);
    return (options.gitlab ?? gitlabAnswer)(url, init);
  };
  const logs: string[] = [];
  const tasks = createTasks({
    connections: async () => options.saved ?? BOTH,
    tokens,
    request,
    log: (message) => logs.push(message),
  });
  return { tasks, asked, sent, logs, writes, saved };
}

test("with no tracker connected the search says so and asks nobody", async () => {
  const { tasks, asked } = setup({ saved: NONE });
  expect(await tasks.search("")).toEqual({ configured: false, tasks: [] });
  expect(asked).toEqual([]);
});

test("an address without its token, or a token without its address, is not a connection", async () => {
  const noTokens = setup({ tokens: {} });
  expect(await noTokens.tasks.search("")).toEqual({ configured: false, tasks: [] });
  const noEmail = setup({ saved: { ...BOTH, jiraEmail: "", gitlabUrl: "" } });
  expect(await noEmail.tasks.search("")).toEqual({ configured: false, tasks: [] });
});

test("the tasks of both trackers list together, each with its branch", async () => {
  const { tasks } = setup();
  expect(await tasks.search("")).toEqual({
    configured: true,
    tasks: [
      {
        id: "jira:BWLT-12",
        label: "BWLT-12 Add the webhook",
        description: "Jira · In Progress",
        key: "BWLT-12",
        url: "https://team.atlassian.net/browse/BWLT-12",
        branch: "BWLT-12-add-the-webhook",
      },
      {
        id: "gitlab:issue:42:7",
        label: "shop/web#7 Rate limit the login form",
        description: "GitLab · Open",
        key: "shop/web#7",
        url: "https://git.team.test/shop/web/-/issues/7",
        branch: "7-rate-limit-the-login-form",
      },
    ],
  });
});

test("only the connected tracker is asked", async () => {
  const { tasks, asked } = setup({ tokens: { gitlab: "gitlab-token" } });
  const found = await tasks.search("");
  expect(found.tasks.map((task) => task.id)).toEqual(["gitlab:issue:42:7"]);
  expect(asked).toEqual(["git.team.test/api/v4/issues"]);
});

test("one tracker that fails does not hide the other's tasks, and its reason is logged", async () => {
  const { tasks, logs } = setup({ gitlab: () => json({}, 401) });
  const found = await tasks.search("");
  expect(found.tasks.map((task) => task.id)).toEqual(["jira:BWLT-12"]);
  expect(logs).toEqual(["[tasks] GitLab rejected the saved sign-in details."]);
});

test("when every tracker fails the search fails with the first reason", async () => {
  const { tasks, logs } = setup({ jira: () => json({}, 500), gitlab: () => json({}, 401) });
  await expect(tasks.search("")).rejects.toThrow("Jira answered HTTP 500.");
  expect(logs).toEqual([]);
});

test("an attachment is the whole task as text, issue or merge request", async () => {
  const { tasks } = setup({ tokens: { gitlab: "gitlab-token" } });
  expect(await tasks.attachments("login")).toEqual({
    items: [
      {
        id: "gitlab:issue:42:7",
        identifier: "shop/web#7",
        title: "Rate limit the login form",
        subtitle: "GitLab · Open",
        url: "https://git.team.test/shop/web/-/issues/7",
        text: [
          "GitLab issue shop/web#7: Rate limit the login form",
          "URL: https://git.team.test/shop/web/-/issues/7",
          "Status: Open",
          "",
          "Five tries a minute.",
        ].join("\n"),
        resourceType: "issue",
      },
      {
        id: "gitlab:mr:42:12",
        identifier: "shop/web!12",
        title: "Add the rate limiter",
        subtitle: "GitLab · Open",
        url: "https://git.team.test/shop/web/-/merge_requests/12",
        text: [
          "GitLab merge request shop/web!12: Add the rate limiter",
          "URL: https://git.team.test/shop/web/-/merge_requests/12",
          "Status: Open",
          "Branches: 7-rate-limit → main",
          "",
          "Closes #7",
        ].join("\n"),
        resourceType: "merge_request",
      },
    ],
  });
});

test("attaching with no tracker connected says where to connect one", async () => {
  const { tasks } = setup({ saved: NONE });
  const error = await tasks.attachments("").catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(TrackerError);
  expect(error).toMatchObject({
    message: 'No tracker is connected. Open the Command Center and pick "Task connections".',
  });
});

test("the token state says which trackers have one, never the token", async () => {
  const { tasks } = setup({ tokens: { jira: "jira-token" } });
  const state = await tasks.tokens();
  expect(state).toEqual({
    jira: { hasToken: true },
    gitlab: { hasToken: false },
    github: { hasToken: false },
  });
  expect(JSON.stringify(state)).not.toContain("jira-token");
});

test("a token is saved trimmed, and an empty one removes it", async () => {
  const { tasks, writes } = setup({ tokens: {} });
  expect(await tasks.setToken({ source: "gitlab", token: "  glpat-abc\n" })).toEqual({
    jira: { hasToken: false },
    gitlab: { hasToken: true },
    github: { hasToken: false },
  });
  expect(await tasks.setToken({ source: "gitlab", token: "   " })).toEqual({
    jira: { hasToken: false },
    gitlab: { hasToken: false },
    github: { hasToken: false },
  });
  expect(writes).toEqual([
    ["gitlab", "glpat-abc"],
    ["gitlab", null],
  ]);
});

test("a connection test signs in and names the account", async () => {
  const { tasks, asked } = setup({ jira: () => json({ displayName: "Rina Putri" }) });
  // Nothing else is asked for a test.
  expect(await tasks.test("jira")).toEqual({ account: "Rina Putri" });
  expect(asked).toEqual(["team.atlassian.net/rest/api/3/myself"]);
});

test("a connection test of a tracker that is not set up says what is missing", async () => {
  const { tasks, asked } = setup({ tokens: { jira: "jira-token" } });
  await expect(tasks.test("gitlab")).rejects.toThrow(
    "Save the GitLab address and access token first.",
  );
  const noJira = setup({ saved: NONE });
  await expect(noJira.tasks.test("jira")).rejects.toThrow(
    "Save the Jira site, email and API token first.",
  );
  expect(asked).toEqual([]);
});

test("a connection test passes the tracker's refusal on", async () => {
  const { tasks } = setup({ gitlab: () => json({}, 403) });
  await expect(tasks.test("gitlab")).rejects.toThrow("GitLab rejected the saved sign-in details.");
});

test("the list holds every tracker's issues and merge requests", async () => {
  const { tasks } = setup();
  expect(await tasks.list("")).toEqual({
    configured: true,
    issues: [
      {
        id: "jira:BWLT-12",
        source: "jira",
        kind: "issue",
        key: "BWLT-12",
        title: "Add the webhook",
        status: "In Progress",
        url: "https://team.atlassian.net/browse/BWLT-12",
      },
      {
        id: "gitlab:issue:42:7",
        source: "gitlab",
        kind: "issue",
        key: "shop/web#7",
        title: "Rate limit the login form",
        status: "Open",
        url: "https://git.team.test/shop/web/-/issues/7",
      },
    ],
    mergeRequests: [
      {
        id: "gitlab:mr:42:12",
        source: "gitlab",
        kind: "mr",
        key: "shop/web!12",
        title: "Add the rate limiter",
        status: "Open",
        url: "https://git.team.test/shop/web/-/merge_requests/12",
        updatedAt: "2026-11-14T04:00:00.000Z",
        note: "Review requested",
      },
    ],
    problems: [],
  });
});

test("with no tracker connected the list says so and asks nobody", async () => {
  const { tasks, asked } = setup({ saved: NONE });
  expect(await tasks.list("")).toEqual({
    configured: false,
    issues: [],
    mergeRequests: [],
    problems: [],
  });
  expect(asked).toEqual([]);
});

test("a list that fails is named once, and the others still show", async () => {
  const { tasks, logs } = setup({
    gitlab: (url) => (url.pathname.endsWith("/issues") ? json([GITLAB_ISSUE]) : json({}, 429)),
  });
  const list = await tasks.list("");
  expect(list.issues.map((row) => row.id)).toEqual(["jira:BWLT-12", "gitlab:issue:42:7"]);
  expect(list.mergeRequests).toEqual([]);
  expect(list.problems).toEqual(["GitLab is limiting requests. Try again shortly."]);
  expect(logs).toEqual(["[tasks] GitLab is limiting requests. Try again shortly."]);
});

test("when nothing answers the list fails with the first reason", async () => {
  const { tasks } = setup({ jira: () => json({}, 500), gitlab: () => json({}, 401) });
  await expect(tasks.list("")).rejects.toThrow("Jira answered HTTP 500.");
});

test("a task's page is the task, its comments, its moves and, for an issue, its branch", async () => {
  const { tasks } = setup();
  expect(await tasks.detail("jira:BWLT-12")).toEqual({
    id: "jira:BWLT-12",
    source: "jira",
    kind: "issue",
    key: "BWLT-12",
    title: "Add the webhook",
    status: "In Progress",
    url: "https://team.atlassian.net/browse/BWLT-12",
    description: "",
    markdown: false,
    details: [],
    comments: [],
    earlierComments: 0,
    changes: [{ id: "21", label: "In Review" }],
    branch: "BWLT-12-add-the-webhook",
    assignedToMe: false,
    images: [],
    reviewThreads: false,
  });
  const request = await tasks.detail("gitlab:mr:42:12");
  expect(request).toMatchObject({
    id: "gitlab:mr:42:12",
    kind: "mr",
    markdown: true,
    description: "Closes #7",
    details: [["Branches", "7-rate-limit → main"]],
    comments: [{ id: "31", author: "Rina Putri", at: "2026-11-14T05:00:00.000Z", text: "Why 5?" }],
    changes: [],
  });
  // A merge request has its branch already.
  expect(request).not.toHaveProperty("branch");
});

test("a long description is cut, and says so", async () => {
  const { tasks } = setup({
    gitlab: (url) =>
      url.pathname.endsWith("/issues/7")
        ? json({ ...GITLAB_ISSUE, description: "x".repeat(20_500) })
        : gitlabAnswer(url),
  });
  const detail = await tasks.detail("gitlab:issue:42:7");
  expect(detail.description).toBe(
    `${"x".repeat(20_000)}\n\n[Cut here. The rest is on the task's page.]`,
  );
});

test("an id that names no tracker, or one that is not set up, is refused", async () => {
  const { tasks, asked } = setup({ tokens: { jira: "jira-token" } });
  for (const id of ["", "BWLT-12", "linear:1", ":x"]) {
    await expect(tasks.detail(id)).rejects.toThrow("That is no task Paseo knows.");
  }
  await expect(tasks.detail("gitlab:issue:42:7")).rejects.toThrow(
    "Save the GitLab address and access token first.",
  );
  await expect(tasks.comment({ id: "gitlab:issue:42:7", text: "hi" })).rejects.toThrow(
    "Save the GitLab address and access token first.",
  );
  expect(asked).toEqual([]);
});

test("a comment is posted trimmed, then the task is read again", async () => {
  const { tasks, sent, asked } = setup();
  const detail = await tasks.comment({ id: "gitlab:mr:42:12", text: "  LGTM\n" });
  expect(sent).toEqual([["POST", "/api/v4/projects/42/merge_requests/12/notes", { body: "LGTM" }]]);
  expect(asked).toEqual([
    "git.team.test/api/v4/projects/42/merge_requests/12/notes",
    "git.team.test/api/v4/projects/42/merge_requests/12",
    "git.team.test/api/v4/projects/42/merge_requests/12/notes",
    "git.team.test/api/v4/user",
  ]);
  expect(detail.id).toBe("gitlab:mr:42:12");
});

test("an empty comment is refused and nothing is sent", async () => {
  const { tasks, asked } = setup();
  await expect(tasks.comment({ id: "jira:BWLT-12", text: " \n " })).rejects.toThrow(
    "Write the comment first.",
  );
  expect(asked).toEqual([]);
});

test("a status change is sent, then the task is read again", async () => {
  const { tasks, sent } = setup();
  const detail = await tasks.change({ id: "jira:BWLT-12", change: "21" });
  expect(sent).toEqual([
    ["POST", "/rest/api/3/issue/BWLT-12/transitions", { transition: { id: "21" } }],
  ]);
  expect(detail.changes).toEqual([{ id: "21", label: "In Review" }]);
});

test("a refused change is the error, and the task is not read again", async () => {
  const { tasks, asked } = setup({
    jira: (url, init) =>
      init.method ? json({ errorMessages: ["Pick a resolution."] }, 400) : jiraAnswer(url),
  });
  await expect(tasks.change({ id: "jira:BWLT-12", change: "31" })).rejects.toThrow(
    "Jira refused the change: Pick a resolution.",
  );
  expect(asked).toEqual(["team.atlassian.net/rest/api/3/issue/BWLT-12/transitions"]);
});

test("a tracker is kept while its sign-in stays the same, and made again when it changes", async () => {
  const { tasks, asked, saved } = setup({ tokens: { gitlab: "gitlab-token" } });
  const users = () => asked.filter((path) => path.endsWith("/user")).length;
  await tasks.list("");
  await tasks.list("");
  expect(users()).toBe(1);
  saved.gitlab = "another-token";
  await tasks.list("");
  expect(users()).toBe(2);
});

const LINK = {
  name: "BWLT-12-add-the-webhook",
  key: "BWLT-12",
  url: "https://team.atlassian.net/browse/BWLT-12",
  taskId: "jira:BWLT-12",
};
const GITLAB_LINK = {
  workspaceId: "wks_3",
  name: "7-rate-limit",
  key: "shop/web#7",
  url: "https://git.team.test/shop/web/-/issues/7",
  taskId: "gitlab:issue:42:7",
};

function standing(key: string): Respond {
  return () =>
    json({
      ...JIRA_ISSUE,
      fields: { ...JIRA_ISSUE.fields, status: { name: "In Review", statusCategory: { key } } },
    });
}

test("a linked workspace carries how its task stands now, and a task is asked once", async () => {
  const { tasks, asked } = setup({ jira: standing("indeterminate") });
  const found = {
    workspaceIds: ["wks_1", "wks_2", "wks_3", "wks_4"],
    linked: [{ workspaceId: "wks_1", ...LINK }, { workspaceId: "wks_2", ...LINK }, GITLAB_LINK],
  };
  expect(await tasks.linked(found)).toEqual({
    workspaceIds: ["wks_1", "wks_2", "wks_3", "wks_4"],
    linked: [
      { workspaceId: "wks_1", ...LINK, status: "In Review", phase: "doing" },
      { workspaceId: "wks_2", ...LINK, status: "In Review", phase: "doing" },
      { ...GITLAB_LINK, status: "Open", phase: "todo" },
    ],
  });
  expect(asked.toSorted()).toEqual([
    "git.team.test/api/v4/projects/42/issues/7",
    "team.atlassian.net/rest/api/3/issue/BWLT-12",
  ]);
});

test("a task that is gone, or a tracker that fails, leaves its workspace linked with no status", async () => {
  const { tasks, logs } = setup({
    jira: () => json({ errorMessages: ["Issue does not exist"] }, 404),
    gitlab: () => json({}, 500),
  });
  const found = {
    workspaceIds: ["wks_1", "wks_3"],
    linked: [{ workspaceId: "wks_1", ...LINK }, GITLAB_LINK],
  };
  expect(await tasks.linked(found)).toEqual(found);
  expect(logs).toEqual(["[tasks] GitLab answered HTTP 500."]);
});

test("a link with no task id, or to a tracker that is not connected, asks nobody", async () => {
  const { tasks, asked } = setup({ tokens: { gitlab: "gitlab-token" } });
  const { taskId: _none, ...byKey } = GITLAB_LINK;
  const found = {
    workspaceIds: ["wks_1", "wks_3"],
    linked: [{ workspaceId: "wks_1", ...LINK }, byKey],
  };
  expect(await tasks.linked(found)).toEqual(found);
  expect(asked).toEqual([]);
});

test("with nothing linked the trackers and the saved sign-in are left alone", async () => {
  const { tasks, asked } = setup();
  expect(await tasks.linked({ workspaceIds: ["wks_9"], linked: [] })).toEqual({
    workspaceIds: ["wks_9"],
    linked: [],
  });
  expect(asked).toEqual([]);
});

test("a task's prompt is the saved template filled with the task", async () => {
  const { tasks } = setup({
    saved: { ...BOTH, promptTemplate: "Plan {key} ({title}). {description} See {url}" },
  });
  expect(await tasks.prompt("gitlab:issue:42:7")).toEqual({
    text: "Plan shop/web#7 (Rate limit the login form). Five tries a minute. See https://git.team.test/shop/web/-/issues/7",
  });
});

test("a prompt for a task that cannot be read is the tracker's refusal", async () => {
  const { tasks } = setup({ jira: () => json({}, 404) });
  await expect(tasks.prompt("jira:BWLT-999")).rejects.toThrow(
    "Jira has no such task, or the saved account cannot see it.",
  );
});

test("GitHub is connected by its token alone, and lists its issues and pull requests", async () => {
  const { tasks, asked } = setup({ saved: NONE, tokens: { github: "ghp-token" } });
  const list = await tasks.list("");
  expect(list.configured).toBe(true);
  expect(list.issues.map((row) => [row.id, row.status])).toEqual([
    ["github:issue:shop/api:9", "Open"],
  ]);
  expect(list.mergeRequests.map((row) => [row.id, row.note])).toEqual([
    ["github:mr:shop/api:10", "Review requested"],
  ]);
  expect(new Set(asked)).toEqual(new Set(["api.github.com/search/issues"]));
  expect(await tasks.test("github")).toEqual({ account: "Rina Putri (@rina)" });
  const { tasks: tasksOf } = await tasks.search("");
  expect(tasksOf[0]).toMatchObject({ key: "shop/api#9", branch: "9-cache-the-price-list" });
});

test("GitHub with no token is not a connection, and a test of it says what is missing", async () => {
  const { tasks, asked } = setup({ saved: NONE, tokens: {} });
  expect((await tasks.list("")).configured).toBe(false);
  await expect(tasks.test("github")).rejects.toThrow("Save the GitHub access token first.");
  expect(asked).toEqual([]);
});

test("an attached pull request is named as GitHub names it", async () => {
  const { tasks } = setup({ saved: NONE, tokens: { github: "ghp-token" } });
  const { items } = await tasks.attachments("");
  const pull = items.find((item) => item.id === "github:mr:shop/api:10");
  expect(pull?.text.split("\n")[0]).toBe("GitHub pull request shop/api#10: Add the price cache");
  expect(pull?.resourceType).toBe("merge_request");
});

const ALL_TOKENS = { jira: "jira-token", gitlab: "gitlab-token", github: "github-token" };

test("a new issue can go to every connected tracker, and only Jira's issues have kinds", async () => {
  const { tasks, asked } = setup({ tokens: ALL_TOKENS });
  expect(await tasks.sources()).toEqual({
    sources: [
      { source: "jira", kinds: true },
      { source: "gitlab", kinds: false },
      { source: "github", kinds: false },
    ],
  });
  expect(await setup({ saved: NONE, tokens: {} }).tasks.sources()).toEqual({ sources: [] });
  expect(asked).toEqual([]);
});

test("the places and kinds are asked of the tracker that is named", async () => {
  const { tasks, asked } = setup({
    jira: (url) =>
      url.pathname.endsWith("/issuetypes")
        ? json({ issueTypes: [{ id: "10001", name: "Story" }] })
        : json({ values: [{ key: "BWLT", name: "Wallet" }] }),
    gitlab: () => json([{ id: 42, path_with_namespace: "shop/web" }]),
  });
  expect(await tasks.places({ source: "jira", query: "wal" })).toEqual({
    places: [{ id: "BWLT", label: "BWLT · Wallet" }],
  });
  expect(await tasks.places({ source: "gitlab", query: "" })).toEqual({
    places: [{ id: "42", label: "shop/web" }],
  });
  expect(await tasks.kinds({ source: "jira", place: "BWLT" })).toEqual({
    kinds: [{ id: "10001", label: "Story" }],
  });
  expect(asked).toEqual([
    "team.atlassian.net/rest/api/3/project/search",
    "git.team.test/api/v4/projects",
    "team.atlassian.net/rest/api/3/issue/createmeta/BWLT/issuetypes",
  ]);
  // GitLab's issues have no kinds: nothing is asked.
  expect(await tasks.kinds({ source: "gitlab", place: "42" })).toEqual({ kinds: [] });
  expect(asked).toHaveLength(3);
  await expect(tasks.places({ source: "github", query: "" })).rejects.toThrow(
    "Save the GitHub access token first.",
  );
});

test("a new issue is made, then assigned to me, and answers with the id its page opens by", async () => {
  const { tasks, sent } = setup({
    gitlab: (url, init) => {
      if (url.pathname.endsWith("/user")) return json({ id: 7, username: "rina" });
      return init.method === "POST" ? json({ iid: 9, project_id: 42 }, 201) : json(GITLAB_ISSUE);
    },
  });
  const made = await tasks.create({
    source: "gitlab",
    place: "42",
    title: "  Cache the price list ",
    description: " It is read on every page.\n",
    assign: true,
  });
  expect(made).toEqual({ id: "gitlab:issue:42:9" });
  expect(sent).toEqual([
    [
      "POST",
      "/api/v4/projects/42/issues",
      { title: "Cache the price list", description: "It is read on every page." },
    ],
    ["PUT", "/api/v4/projects/42/issues/9", { assignee_ids: [7] }],
  ]);
});

test("an issue that is not to be assigned is only made", async () => {
  const { tasks, sent } = setup({ jira: () => json({ key: "BWLT-99" }, 201) });
  const made = await tasks.create({
    source: "jira",
    place: "BWLT",
    kind: "10001",
    title: "Add the webhook",
    description: "",
    assign: false,
  });
  expect(made).toEqual({ id: "jira:BWLT-99" });
  expect(sent.map(([method, path]) => [method, path])).toEqual([["POST", "/rest/api/3/issue"]]);
});

test("an issue that cannot be assigned is still made, and the answer says what went wrong", async () => {
  const { tasks, logs } = setup({
    tokens: ALL_TOKENS,
    github: (url, init) => {
      if (url.pathname === "/user") return json({ login: "rina" });
      if (url.pathname.endsWith("/assignees")) return json({ message: "Forbidden" }, 403);
      return init.method === "POST" ? json({ number: 9 }, 201) : json(GITHUB_ISSUE);
    },
  });
  const made = await tasks.create({
    source: "github",
    place: "shop/api",
    title: "Cache the price list",
    description: "",
    assign: true,
  });
  expect(made.id).toBe("github:issue:shop/api:9");
  expect(made.warning).toMatch(/^The issue is made, but it could not be assigned to you: /);
  expect(logs).toHaveLength(1);
});

test("an issue with no title, or for a tracker that is not connected, is refused and nothing is sent", async () => {
  const { tasks, sent, asked } = setup();
  const issue = { place: "42", description: "", assign: true };
  await expect(tasks.create({ ...issue, source: "gitlab", title: "  " })).rejects.toThrow(
    "Write the title first.",
  );
  await expect(tasks.create({ ...issue, source: "github", title: "t" })).rejects.toThrow(
    "Save the GitHub access token first.",
  );
  expect(sent).toEqual([]);
  expect(asked).toEqual([]);
});

test("assigning a task to me sends it and answers with the task as it then is", async () => {
  let assigned = false;
  const { tasks, sent } = setup({
    jira: (url, init) => {
      if (url.pathname.endsWith("/myself")) return json({ accountId: "acc-me", displayName: "Me" });
      if (init.method === "PUT") {
        assigned = true;
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith("/issue/BWLT-12") && assigned) {
        return json({
          ...JIRA_ISSUE,
          fields: { ...JIRA_ISSUE.fields, assignee: { accountId: "acc-me", displayName: "Me" } },
        });
      }
      return jiraAnswer(url);
    },
  });
  expect((await tasks.detail("jira:BWLT-12")).assignedToMe).toBe(false);
  const detail = await tasks.assign("jira:BWLT-12");
  expect(sent).toEqual([["PUT", "/rest/api/3/issue/BWLT-12/assignee", { accountId: "acc-me" }]]);
  expect(detail.assignedToMe).toBe(true);
  expect(detail.details).toContainEqual(["Assignee", "Me"]);
});

test("a task's picture is read by the tracker and handed over in base64", async () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10]);
  const { tasks, asked } = setup({
    gitlab: () => new Response(png, { headers: { "Content-Type": "image/png; charset=binary" } }),
  });
  const image = await tasks.image({
    id: "gitlab:issue:42:7",
    image: "0123456789abcdef0123456789abcdef/before.png",
  });
  expect(image).toEqual({ mime: "image/png", data: Buffer.from(png).toString("base64") });
  expect(asked).toEqual([
    "git.team.test/api/v4/projects/42/uploads/0123456789abcdef0123456789abcdef/before.png",
  ]);
  await expect(tasks.image({ id: "linear:1", image: "x" })).rejects.toThrow(
    "That is no task Paseo knows.",
  );
});

test("a task's page lists the pictures its description held", async () => {
  const { tasks } = setup({
    gitlab: (url) => {
      if (url.pathname.endsWith("/user")) return json({ id: 7, username: "rina" });
      if (url.pathname.endsWith("/notes")) return json([]);
      return json({
        ...GITLAB_ISSUE,
        description: "See ![shot](/uploads/0123456789abcdef0123456789abcdef/a.png)",
        assignees: [{ id: 7, username: "rina" }],
      });
    },
  });
  expect(await tasks.detail("gitlab:issue:42:7")).toMatchObject({
    description: "See (image: shot)",
    images: [{ id: "0123456789abcdef0123456789abcdef/a.png", name: "shot" }],
    assignedToMe: true,
  });
});

const OPEN_THREAD = "87805b7c09016a7058e91bdbe7b29d1f284a39e6";
const DONE_THREAD = "3333333333333333333333333333333333333333";
const threadNote = (id: number, body: string, resolved: boolean) => ({
  id,
  body,
  author: { username: "rina", name: "Rina Putri" },
  created_at: "2026-11-14T04:00:00.000Z",
  resolvable: true,
  resolved,
});
const DISCUSSIONS = [
  { id: DONE_THREAD, notes: [threadNote(44, "Add a test.", true)] },
  { id: OPEN_THREAD, notes: [threadNote(42, "Why 5?", false)] },
];

function reviewAnswer(url: URL): Response {
  return url.pathname.includes("/discussions") ? json(DISCUSSIONS) : gitlabAnswer(url);
}

test("only a GitLab merge request's page says it has review threads to read", async () => {
  const { tasks } = setup({ tokens: ALL_TOKENS });
  expect((await tasks.detail("gitlab:mr:42:12")).reviewThreads).toBe(true);
  expect((await tasks.detail("gitlab:issue:42:7")).reviewThreads).toBe(false);
  expect((await tasks.detail("github:mr:shop/api:10")).reviewThreads).toBe(false);
});

test("a merge request's threads come with the open ones first", async () => {
  const { tasks, asked } = setup({ gitlab: reviewAnswer });
  const review = await tasks.threads("gitlab:mr:42:12");
  expect(review.threads.map((thread) => [thread.id, thread.resolved])).toEqual([
    [OPEN_THREAD, false],
    [DONE_THREAD, true],
  ]);
  expect(review.more).toBe(false);
  expect(asked).toEqual(["git.team.test/api/v4/projects/42/merge_requests/12/discussions"]);
});

test("a reply is trimmed and sent to its thread, and the threads are read again", async () => {
  const { tasks, sent, asked } = setup({ gitlab: reviewAnswer });
  const review = await tasks.replyThread({
    id: "gitlab:mr:42:12",
    thread: OPEN_THREAD,
    text: "  Raised to 10.\n",
  });
  expect(sent).toEqual([
    [
      "POST",
      `/api/v4/projects/42/merge_requests/12/discussions/${OPEN_THREAD}/notes`,
      { body: "Raised to 10." },
    ],
  ]);
  expect(asked).toHaveLength(2);
  expect(review.threads).toHaveLength(2);
  await expect(
    tasks.replyThread({ id: "gitlab:mr:42:12", thread: OPEN_THREAD, text: " \n" }),
  ).rejects.toThrow("Write the reply first.");
  expect(sent).toHaveLength(1);
});

test("a thread is resolved and opened again, and the threads are read again", async () => {
  const { tasks, sent } = setup({ gitlab: reviewAnswer });
  await tasks.resolveThread({ id: "gitlab:mr:42:12", thread: OPEN_THREAD, resolved: true });
  await tasks.resolveThread({ id: "gitlab:mr:42:12", thread: DONE_THREAD, resolved: false });
  expect(sent.map(([method, path]) => [method, path])).toEqual([
    ["PUT", `/api/v4/projects/42/merge_requests/12/discussions/${OPEN_THREAD}`],
    ["PUT", `/api/v4/projects/42/merge_requests/12/discussions/${DONE_THREAD}`],
  ]);
});

test("a tracker whose review Paseo does not read says so, and nothing is asked of it", async () => {
  const { tasks, asked } = setup({ tokens: ALL_TOKENS });
  await expect(tasks.threads("github:mr:shop/api:10")).rejects.toThrow(
    "Paseo does not read GitHub's review threads here.",
  );
  await expect(tasks.threads("jira:BWLT-12")).rejects.toThrow(
    "Paseo does not read Jira's review threads here.",
  );
  expect(asked).toEqual([]);
});

test("a long thread note is cut like a comment", async () => {
  const { tasks } = setup({
    gitlab: () => json([{ id: OPEN_THREAD, notes: [threadNote(1, "x".repeat(30_000), false)] }]),
  });
  const review = await tasks.threads("gitlab:mr:42:12");
  expect(review.threads[0].notes[0].text).toMatch(
    /\[Cut here\. The rest is on the task's page\.\]$/,
  );
});
