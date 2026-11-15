import { expect, test } from "vitest";
import type { Connections, Source } from "../shared/contracts.js";
import { TrackerError } from "./issue.js";
import { createTasks } from "./tasks.js";
import type { SavedTokens, TokenStore } from "./token-store.js";

const BOTH: Connections = {
  jiraSite: "https://team.atlassian.net",
  jiraEmail: "me@team.test",
  gitlabUrl: "https://git.team.test",
};
const NONE: Connections = { jiraSite: "", jiraEmail: "", gitlabUrl: "" };

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

interface Setup {
  saved?: Connections;
  tokens?: SavedTokens;
  jira?: Respond;
  gitlab?: Respond;
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
  expect(state).toEqual({ jira: { hasToken: true }, gitlab: { hasToken: false } });
  expect(JSON.stringify(state)).not.toContain("jira-token");
});

test("a token is saved trimmed, and an empty one removes it", async () => {
  const { tasks, writes } = setup({ tokens: {} });
  expect(await tasks.setToken({ source: "gitlab", token: "  glpat-abc\n" })).toEqual({
    jira: { hasToken: false },
    gitlab: { hasToken: true },
  });
  expect(await tasks.setToken({ source: "gitlab", token: "   " })).toEqual({
    jira: { hasToken: false },
    gitlab: { hasToken: false },
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
      url.pathname.endsWith("/notes")
        ? json([])
        : json({ ...GITLAB_ISSUE, description: "x".repeat(20_500) }),
  });
  const detail = await tasks.detail("gitlab:issue:42:7");
  expect(detail.description).toBe(
    `${"x".repeat(20_000)}\n\n[Cut here. The rest is on the task's page.]`,
  );
});

test("an id that names no tracker, or one that is not set up, is refused", async () => {
  const { tasks, asked } = setup({ tokens: { jira: "jira-token" } });
  for (const id of ["", "BWLT-12", "github:1", ":x"]) {
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
