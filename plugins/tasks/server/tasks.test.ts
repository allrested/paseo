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
  title: "Rate limit the login form",
  description: "Five tries a minute.",
  web_url: "https://git.team.test/shop/web/-/issues/7",
  references: { full: "shop/web#7" },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

interface Setup {
  saved?: Connections;
  tokens?: SavedTokens;
  jira?: () => Response;
  gitlab?: () => Response;
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
  const request: typeof fetch = async (input) => {
    const url = new URL(String(input));
    asked.push(url.host + url.pathname);
    if (url.host === "team.atlassian.net") {
      return (options.jira ?? (() => json({ issues: [JIRA_ISSUE] })))();
    }
    return (options.gitlab ?? (() => json([GITLAB_ISSUE])))();
  };
  const logs: string[] = [];
  const tasks = createTasks({
    connections: async () => options.saved ?? BOTH,
    tokens,
    request,
    log: (message) => logs.push(message),
  });
  return { tasks, asked, logs, writes };
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
        id: "gitlab:shop/web#7",
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
  expect(found.tasks.map((task) => task.id)).toEqual(["gitlab:shop/web#7"]);
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

test("an attachment is the whole task as text", async () => {
  const { tasks } = setup({ tokens: { gitlab: "gitlab-token" } });
  expect(await tasks.attachments("login")).toEqual({
    items: [
      {
        id: "gitlab:shop/web#7",
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
