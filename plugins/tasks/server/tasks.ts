import type { PluginAttachmentItem } from "@getpaseo/plugin";
import {
  SOURCE_NAME,
  SourceSchema,
  type Connections,
  type LinkedWorkspaces,
  type Source,
  type Task,
  type TaskDetail,
  type TaskList,
  type TaskRow,
  type Tokens,
} from "../shared/contracts.js";
import { taskBranch } from "../shared/branch.js";
import { fillPrompt } from "../shared/prompt.js";
import { createGitlab } from "./gitlab.js";
import { TrackerError, errorMessage, type Issue, type IssueDetail, type Tracker } from "./issue.js";
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
  /** The tasks screen's list: issues and merge requests of every connected tracker. */
  list(query: string): Promise<TaskList>;
  detail(id: string): Promise<TaskDetail>;
  /** Posts a comment and answers with the task as it then is. */
  comment(input: { id: string; text: string }): Promise<TaskDetail>;
  /** Moves the task and answers with it as it then is. */
  change(input: { id: string; change: string }): Promise<TaskDetail>;
  /**
   * The linked workspaces, each with how its task stands now. It never rejects: a task that is
   * gone, or a tracker that cannot be asked, leaves the workspace linked with no status.
   */
  linked(found: LinkedWorkspaces): Promise<LinkedWorkspaces>;
  /** The saved prompt template filled with one task. */
  prompt(id: string): Promise<{ text: string }>;
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
/** What a task's page shows of a long description or comment; the rest is on the tracker. */
const TEXT_MAX = 20_000;
// The sidebar asks how every linked task stands: a few at a time, and no more than this many.
const ASKED_AT_ONCE = 6;
const ASKED_MAX = 60;

function subtitle(issue: Issue): string {
  return `${SOURCE_NAME[issue.source]} · ${issue.status}`;
}

function taskId(issue: Issue): string {
  return `${issue.source}:${issue.id}`;
}

function toTask(issue: Issue): Task {
  return {
    id: taskId(issue),
    label: `${issue.key} ${issue.title}`.trim(),
    description: subtitle(issue),
    key: issue.key,
    url: issue.url,
    branch: taskBranch(issue.branchPrefix, issue.title),
  };
}

function toAttachment(issue: Issue): PluginAttachmentItem {
  return {
    id: taskId(issue),
    identifier: issue.key,
    title: issue.title,
    subtitle: subtitle(issue),
    url: issue.url,
    text: issueText(issue),
    resourceType: issue.kind === "mr" ? "merge_request" : "issue",
  };
}

function toRow(issue: Issue): TaskRow {
  return {
    id: taskId(issue),
    source: issue.source,
    kind: issue.kind,
    key: issue.key,
    title: issue.title,
    status: issue.status,
    url: issue.url,
    ...(issue.updatedAt === undefined ? {} : { updatedAt: issue.updatedAt }),
    ...(issue.note === undefined ? {} : { note: issue.note }),
  };
}

function cut(text: string): string {
  if (text.length <= TEXT_MAX) return text;
  return `${text.slice(0, TEXT_MAX)}\n\n[Cut here. The rest is on the task's page.]`;
}

function toDetail(detail: IssueDetail): TaskDetail {
  return {
    ...toRow(detail),
    description: cut(detail.description),
    markdown: detail.markdown,
    details: detail.details,
    comments: detail.comments.map((comment) => ({ ...comment, text: cut(comment.text) })),
    earlierComments: detail.earlierComments,
    changes: detail.changes,
    // A merge request has its branch already.
    ...(detail.kind === "issue" ? { branch: taskBranch(detail.branchPrefix, detail.title) } : {}),
  };
}

/** Each tracker's issues, and its merge requests when it holds any. */
function everything(list: readonly Tracker[], query: string): Array<Promise<Issue[]>> {
  return list.flatMap((tracker) => [
    tracker.search(query),
    ...(tracker.mergeRequests ? [tracker.mergeRequests(query)] : []),
  ]);
}

export function createTasks(deps: TasksDeps): Tasks {
  const { request, log } = deps;
  // The trackers are kept while what they sign in with stays the same, so what one learned (the
  // GitLab username) is asked once. The key holds the tokens and stays in this closure.
  let kept: { key: string; list: Tracker[] } | null = null;

  /** The trackers that have everything they need to sign in. */
  async function trackers(): Promise<Tracker[]> {
    const [saved, tokens] = await Promise.all([deps.connections(), deps.tokens.read()]);
    const key = JSON.stringify([saved.jiraSite, saved.jiraEmail, saved.gitlabUrl, tokens]);
    if (kept?.key === key) return kept.list;
    const list: Tracker[] = [];
    if (saved.jiraSite && saved.jiraEmail && tokens.jira) {
      list.push(
        createJira({ site: saved.jiraSite, email: saved.jiraEmail, token: tokens.jira, request }),
      );
    }
    if (saved.gitlabUrl && tokens.gitlab) {
      list.push(createGitlab({ url: saved.gitlabUrl, token: tokens.gitlab, request }));
    }
    kept = { key, list };
    return list;
  }

  /**
   * Every answer of `asks`, and the reasons of the ones that failed. One list that fails does not
   * hide the others. When none answers, the first reason is the error.
   */
  async function gather(
    asks: Array<Promise<Issue[]>>,
  ): Promise<{ found: Issue[]; problems: string[] }> {
    const results = await Promise.allSettled(asks);
    const found: Issue[] = [];
    const failures: unknown[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") found.push(...result.value);
      else failures.push(result.reason);
    }
    if (results.length > 0 && failures.length === results.length) throw failures[0];
    const problems = [...new Set(failures.map(errorMessage))];
    for (const problem of problems) log(`[tasks] ${problem}`);
    return { found, problems };
  }

  async function issues(query: string): Promise<{ configured: boolean; issues: Issue[] }> {
    const list = await trackers();
    if (list.length === 0) return { configured: false, issues: [] };
    const { found } = await gather(list.map((tracker) => tracker.search(query)));
    return { configured: true, issues: found };
  }

  /** The tracker a task id names, and the task's name to it. */
  async function locate(id: string): Promise<{ tracker: Tracker; tail: string }> {
    const at = id.indexOf(":");
    const source = SourceSchema.safeParse(id.slice(0, Math.max(at, 0)));
    if (!source.success) throw new TrackerError("That is no task Paseo knows.");
    const tracker = (await trackers()).find((candidate) => candidate.source === source.data);
    if (!tracker) throw new TrackerError(NEEDS[source.data]);
    return { tracker, tail: id.slice(at + 1) };
  }

  /** How each of `ids` stands, for the ones a connected tracker shows. */
  async function standing(ids: readonly string[]): Promise<Map<string, Issue>> {
    const stands = new Map<string, Issue>();
    const problems = new Set<string>();
    const ask = async (id: string) => {
      const at = id.indexOf(":");
      const tracker = list.find((candidate) => candidate.source === id.slice(0, Math.max(at, 0)));
      if (!tracker) return;
      try {
        const issue = await tracker.find(id.slice(at + 1));
        if (issue) stands.set(id, issue);
      } catch (error) {
        problems.add(errorMessage(error));
      }
    };
    let list: Tracker[] = [];
    try {
      list = await trackers();
      for (let at = 0; at < ids.length; at += ASKED_AT_ONCE) {
        await Promise.all(ids.slice(at, at + ASKED_AT_ONCE).map(ask));
      }
    } catch (error) {
      problems.add(errorMessage(error));
    }
    for (const problem of problems) log(`[tasks] ${problem}`);
    return stands;
  }

  async function detail(id: string): Promise<TaskDetail> {
    const { tracker, tail } = await locate(id);
    return toDetail(await tracker.detail(tail));
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
      const list = await trackers();
      if (list.length === 0) throw new TrackerError(NOT_CONNECTED);
      const { found } = await gather(everything(list, query));
      return { items: found.map(toAttachment) };
    },
    async list(query) {
      const list = await trackers();
      if (list.length === 0) {
        return { configured: false, issues: [], mergeRequests: [], problems: [] };
      }
      const { found, problems } = await gather(everything(list, query));
      return {
        configured: true,
        issues: found.filter((issue) => issue.kind === "issue").map(toRow),
        mergeRequests: found.filter((issue) => issue.kind === "mr").map(toRow),
        problems,
      };
    },
    detail,
    async comment({ id, text }) {
      const body = text.trim();
      if (body === "") throw new TrackerError("Write the comment first.");
      const { tracker, tail } = await locate(id);
      await tracker.comment(tail, body);
      return detail(id);
    },
    async change({ id, change }) {
      const { tracker, tail } = await locate(id);
      await tracker.change(tail, change);
      return detail(id);
    },
    async linked(found) {
      const ids = [...new Set(found.linked.flatMap((each) => each.taskId ?? []))];
      if (ids.length === 0) return found;
      const stands = await standing(ids.slice(0, ASKED_MAX));
      return {
        workspaceIds: found.workspaceIds,
        linked: found.linked.map((each) => {
          const issue = each.taskId === undefined ? undefined : stands.get(each.taskId);
          if (!issue) return each;
          const { status, phase } = issue;
          return { ...each, status, ...(phase === undefined ? {} : { phase }) };
        }),
      };
    },
    async prompt(id) {
      const [{ tracker, tail }, saved] = await Promise.all([locate(id), deps.connections()]);
      const issue = await tracker.find(tail);
      if (!issue) {
        throw new TrackerError(
          `${SOURCE_NAME[tracker.source]} has no such task, or the saved account cannot see it.`,
        );
      }
      const text = fillPrompt(saved.promptTemplate, {
        ...issue,
        description: cut(issue.description),
      });
      return { text };
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
