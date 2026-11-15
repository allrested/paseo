import type { PluginAttachmentItem } from "@getpaseo/plugin";
import {
  SOURCE_NAME,
  type Connections,
  type Source,
  type Task,
  type Tokens,
} from "../shared/contracts.js";
import { taskBranch } from "../shared/branch.js";
import { createGitlab } from "./gitlab.js";
import { TrackerError, errorMessage, type Issue, type Tracker } from "./issue.js";
import { createJira } from "./jira.js";
import { issueText } from "./text.js";
import type { TokenStore } from "./token-store.js";

export interface TasksDeps {
  /** The saved addresses. Rejects when they cannot be read. */
  connections(): Promise<Connections>;
  tokens: TokenStore;
  request: typeof fetch;
  log(message: string): void;
}

export interface Tasks {
  /** `configured` is false while no tracker has both an address and a token. */
  search(query: string): Promise<{ configured: boolean; tasks: Task[] }>;
  attachments(query: string): Promise<{ items: PluginAttachmentItem[] }>;
  tokens(): Promise<Tokens>;
  setToken(input: { source: Source; token: string }): Promise<Tokens>;
  test(source: Source): Promise<{ account: string }>;
}

const NOT_CONNECTED =
  'No tracker is connected. Open the Command Center and pick "Task connections".';
const NEEDS: Record<Source, string> = {
  jira: "Save the Jira site, email and API token first.",
  gitlab: "Save the GitLab address and access token first.",
};

function subtitle(issue: Issue): string {
  return `${SOURCE_NAME[issue.source]} · ${issue.status}`;
}

function toTask(issue: Issue): Task {
  return {
    id: `${issue.source}:${issue.key}`,
    label: `${issue.key} ${issue.title}`.trim(),
    description: subtitle(issue),
    key: issue.key,
    url: issue.url,
    branch: taskBranch(issue.branchPrefix, issue.title),
  };
}

function toAttachment(issue: Issue): PluginAttachmentItem {
  return {
    id: `${issue.source}:${issue.key}`,
    identifier: issue.key,
    title: issue.title,
    subtitle: subtitle(issue),
    url: issue.url,
    text: issueText(issue),
    resourceType: "issue",
  };
}

export function createTasks(deps: TasksDeps): Tasks {
  const { request, log } = deps;

  /** The trackers that have everything they need to sign in. */
  async function trackers(): Promise<Tracker[]> {
    const [saved, tokens] = await Promise.all([deps.connections(), deps.tokens.read()]);
    const list: Tracker[] = [];
    if (saved.jiraSite && saved.jiraEmail && tokens.jira) {
      list.push(
        createJira({ site: saved.jiraSite, email: saved.jiraEmail, token: tokens.jira, request }),
      );
    }
    if (saved.gitlabUrl && tokens.gitlab) {
      list.push(createGitlab({ url: saved.gitlabUrl, token: tokens.gitlab, request }));
    }
    return list;
  }

  /**
   * Every connected tracker's answer. One tracker that fails does not hide the other's tasks: its
   * reason is logged and the connection test shows it. When none answers, the first reason is
   * the error.
   */
  async function issues(query: string): Promise<{ configured: boolean; issues: Issue[] }> {
    const list = await trackers();
    if (list.length === 0) return { configured: false, issues: [] };
    const results = await Promise.allSettled(list.map((tracker) => tracker.search(query)));
    const found: Issue[] = [];
    const failures: unknown[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") found.push(...result.value);
      else failures.push(result.reason);
    }
    if (failures.length === results.length) throw failures[0];
    for (const failure of failures) log(`[tasks] ${errorMessage(failure)}`);
    return { configured: true, issues: found };
  }

  async function tokenState(): Promise<Tokens> {
    const tokens = await deps.tokens.read();
    return {
      jira: { hasToken: Boolean(tokens.jira) },
      gitlab: { hasToken: Boolean(tokens.gitlab) },
    };
  }

  return {
    async search(query) {
      const found = await issues(query);
      return { configured: found.configured, tasks: found.issues.map(toTask) };
    },
    async attachments(query) {
      const found = await issues(query);
      if (!found.configured) throw new TrackerError(NOT_CONNECTED);
      return { items: found.issues.map(toAttachment) };
    },
    tokens: tokenState,
    async setToken({ source, token }) {
      const trimmed = token.trim();
      await deps.tokens.write(source, trimmed === "" ? null : trimmed);
      return tokenState();
    },
    async test(source) {
      const tracker = (await trackers()).find((candidate) => candidate.source === source);
      if (!tracker) throw new TrackerError(NEEDS[source]);
      return { account: await tracker.account() };
    },
  };
}
