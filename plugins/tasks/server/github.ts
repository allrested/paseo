import { z } from "zod";
import type { Phase } from "../shared/contracts.js";
import { baseUrl, getJson, sendJson } from "./http.js";
import {
  TrackerError,
  isoTime,
  type Comment,
  type Issue,
  type IssueDetail,
  type TaskKind,
  type Tracker,
} from "./issue.js";
import { searchWords } from "./text.js";

const NAME = "GitHub";
const DOTCOM = "https://github.com";
const LIMIT = "20";
/** The newest comments a task's page shows, and the size of a page of them. */
const COMMENTS = 20;
// The id comes from a client and goes into a path: an owner and a repository as GitHub names
// them, and no name made of dots alone.
const ID = /^(issue|mr):([A-Za-z0-9-]+)\/(?!\.+:)([A-Za-z0-9._-]+):(\d{1,12})$/;
const MISSING = "GitHub has no such task, or the saved account cannot see it.";

const Person = z.object({ login: z.string(), name: z.string().nullish() });
const Label = z.union([z.string(), z.object({ name: z.string().nullish() })]);
const Shared = {
  number: z.number(),
  title: z.string(),
  body: z.string().nullish(),
  html_url: z.string(),
  state: z.string().nullish(),
  draft: z.boolean().nullish(),
  updated_at: z.string().nullish(),
  comments: z.number().nullish(),
  user: Person.nullish(),
};
/** An issue as the issues API and the search answer it. Both answer for a pull request too. */
const ItemSchema = z.object({
  ...Shared,
  labels: z.array(Label).nullish(),
  repository_url: z.string().nullish(),
  pull_request: z.object({ merged_at: z.string().nullish() }).nullish(),
});
const PullSchema = z.object({
  ...Shared,
  merged: z.boolean().nullish(),
  head: z.object({ ref: z.string() }).nullish(),
  base: z.object({ ref: z.string() }).nullish(),
  requested_reviewers: z.array(Person).nullish(),
});
const SearchSchema = z.object({ items: z.array(ItemSchema) });
const CommentSchema = z.object({
  id: z.number(),
  body: z.string().nullish(),
  user: Person.nullish(),
  created_at: z.string().nullish(),
});
const RefusalSchema = z.object({ message: z.string().nullish() });

export interface GithubOptions {
  /** The server's address; empty for github.com. */
  url: string;
  token: string;
  request: typeof fetch;
}

/** github.com answers on a host of its own; an Enterprise server answers under /api/v3. */
function apiBase(address: string): string {
  const base = baseUrl(address.trim() || DOTCOM, NAME);
  return base === DOTCOM ? "https://api.github.com" : `${base}/api/v3`;
}

interface Stand {
  status: string;
  phase: Phase;
}

function issueStand(state: string | null | undefined): Stand {
  return state === "closed"
    ? { status: "Closed", phase: "done" }
    : { status: "Open", phase: "todo" };
}

/** An open pull request is being worked on; a draft is not yet up for it. */
function pullStand(facts: {
  state?: string | null;
  draft?: boolean | null;
  merged: boolean;
}): Stand {
  if (facts.merged) return { status: "Merged", phase: "done" };
  if (facts.state === "closed") return { status: "Closed", phase: "done" };
  return facts.draft ? { status: "Draft", phase: "todo" } : { status: "Open", phase: "doing" };
}

const SharedSchema = z.object(Shared);
type SharedFacts = z.infer<typeof SharedSchema>;

interface Facts extends SharedFacts {
  repo: string;
  kind: TaskKind;
  stand: Stand;
  details: Issue["details"];
}

function shape(facts: Facts, note?: string): Issue {
  const updatedAt = isoTime(facts.updated_at);
  return {
    source: "github",
    kind: facts.kind,
    id: `${facts.kind}:${facts.repo}:${facts.number}`,
    key: `${facts.repo}#${facts.number}`,
    title: facts.title,
    status: facts.stand.status,
    url: facts.html_url,
    description: (facts.body ?? "").trim(),
    details: facts.details,
    // GitHub's own branch names start with the issue number.
    branchPrefix: String(facts.number),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(note === undefined ? {} : { note }),
    phase: facts.stand.phase,
  };
}

function author(user: z.infer<typeof Person> | null | undefined): Issue["details"] {
  return user ? [["Author", `@${user.login}`]] : [];
}

/** An issue or, when the answer says so, a pull request. */
function fromItem(item: z.infer<typeof ItemSchema>, repo: string, note?: string): Issue {
  if (item.pull_request) {
    const stand = pullStand({ ...item, merged: Boolean(item.pull_request.merged_at) });
    return shape({ ...item, repo, kind: "mr", stand, details: author(item.user) }, note);
  }
  const labels = (item.labels ?? [])
    .map((label) => (typeof label === "string" ? label : (label.name ?? "")))
    .filter((label) => label !== "");
  const details: Issue["details"] = labels.length > 0 ? [["Labels", labels.join(", ")]] : [];
  return shape({ ...item, repo, kind: "issue", stand: issueStand(item.state), details }, note);
}

function fromPull(pull: z.infer<typeof PullSchema>, repo: string): Issue {
  const details: Issue["details"] = [];
  if (pull.head && pull.base) details.push(["Branches", `${pull.head.ref} → ${pull.base.ref}`]);
  details.push(...author(pull.user));
  const reviewers = pull.requested_reviewers ?? [];
  if (reviewers.length > 0) {
    details.push(["Reviewers", reviewers.map((person) => `@${person.login}`).join(", ")]);
  }
  const stand = pullStand({ ...pull, merged: pull.merged === true });
  return shape({ ...pull, repo, kind: "mr", stand, details });
}

/** `owner/name` from the repository's API address, which a search result carries. */
function repoOf(item: z.infer<typeof ItemSchema>): string | null {
  const match = /\/repos\/([^/]+\/[^/]+)$/.exec(item.repository_url ?? "");
  return match ? match[1] : null;
}

export function createGithub(options: GithubOptions): Tracker {
  const { request } = options;
  const headers = {
    Authorization: `Bearer ${options.token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  /** What a search finds, each with its repository. One whose link cannot be opened is left out. */
  async function find(words: string, qualifiers: string, note?: string): Promise<Issue[]> {
    const text = searchWords(words);
    const params = new URLSearchParams({
      q: `${text ? `${text} in:title ` : ""}${qualifiers}`,
      sort: "updated",
      order: "desc",
      per_page: LIMIT,
    });
    const { items } = await getJson({
      request,
      name: NAME,
      url: `${apiBase(options.url)}/search/issues?${params}`,
      headers,
      schema: SearchSchema,
    });
    return items.flatMap((item) => {
      const repo = repoOf(item);
      if (repo === null || !/^https?:\/\//.test(item.html_url)) return [];
      return [fromItem(item, repo, note)];
    });
  }

  /** The API address of one task. The id comes from a client, so it is checked before it is a path. */
  function taskUrl(id: string): { kind: TaskKind; repo: string; number: string; at: string } {
    const match = ID.exec(id);
    if (!match) throw new TrackerError("That is no GitHub task.");
    const repo = `${match[2]}/${match[3]}`;
    return {
      kind: match[1] as TaskKind,
      repo,
      number: match[4],
      // A pull request's conversation and state are read and written as an issue's.
      at: `${apiBase(options.url)}/repos/${repo}/issues/${match[4]}`,
    };
  }

  /** The newest comments of a thread of `total`. The API lists oldest first, so the end is read. */
  async function comments(at: string, total: number): Promise<Comment[]> {
    if (total === 0) return [];
    const last = Math.ceil(total / COMMENTS);
    // A last page that is not full is topped up from the one before it.
    const pages = total % COMMENTS !== 0 && last > 1 ? [last - 1, last] : [last];
    const read = await Promise.all(
      pages.map((page) =>
        getJson({
          request,
          name: NAME,
          url: `${at}/comments?per_page=${COMMENTS}&page=${page}`,
          headers,
          schema: z.array(CommentSchema),
          missing: MISSING,
        }),
      ),
    );
    return read
      .flat()
      .slice(-COMMENTS)
      .map((comment) => ({
        id: String(comment.id),
        author: comment.user ? `@${comment.user.login}` : "Someone",
        at: isoTime(comment.created_at) ?? "",
        text: (comment.body ?? "").trim(),
      }));
  }

  return {
    source: "github",
    search: (query) => find(query, "is:issue is:open assignee:@me"),
    async mergeRequests(query) {
      const [review, assigned] = await Promise.all([
        find(query, "is:pr is:open review-requested:@me", "Review requested"),
        find(query, "is:pr is:open assignee:@me", "Assigned to you"),
      ]);
      // One that is both is listed once, as the review it waits for.
      const found = new Map<string, Issue>();
      for (const item of [...review, ...assigned]) {
        if (!found.has(item.id)) found.set(item.id, item);
      }
      return [...found.values()];
    },
    async find(id) {
      const { repo, at } = taskUrl(id);
      try {
        return fromItem(
          await getJson({ request, name: NAME, url: at, headers, schema: ItemSchema }),
          repo,
        );
      } catch (error) {
        if (error instanceof TrackerError && error.status === 404) return null;
        throw error;
      }
    },
    async detail(id): Promise<IssueDetail> {
      const { kind, repo, number, at } = taskUrl(id);
      const read = { request, name: NAME, headers, missing: MISSING };
      if (kind === "mr") {
        const url = `${apiBase(options.url)}/repos/${repo}/pulls/${number}`;
        const pull = await getJson({ ...read, url, schema: PullSchema });
        const thread = await comments(at, pull.comments ?? 0);
        return {
          ...fromPull(pull, repo),
          comments: thread,
          earlierComments: Math.max(0, (pull.comments ?? 0) - thread.length),
          // A pull request is merged or closed on GitHub, where its checks are.
          changes: [],
          markdown: true,
        };
      }
      const item = await getJson({ ...read, url: at, schema: ItemSchema });
      const thread = await comments(at, item.comments ?? 0);
      return {
        ...fromItem(item, repo),
        comments: thread,
        earlierComments: Math.max(0, (item.comments ?? 0) - thread.length),
        changes:
          item.state === "closed"
            ? [{ id: "reopen", label: "Open" }]
            : [{ id: "close", label: "Closed" }],
        markdown: true,
      };
    },
    async comment(id, text) {
      const { at } = taskUrl(id);
      await sendJson({
        request,
        name: NAME,
        method: "POST",
        url: `${at}/comments`,
        headers,
        body: { body: text },
        reason: refusalReason,
        missing: MISSING,
      });
    },
    async change(id, change) {
      const { kind, at } = taskUrl(id);
      if (kind !== "issue") {
        throw new TrackerError("A pull request is merged or closed on GitHub.");
      }
      if (change !== "close" && change !== "reopen") {
        throw new TrackerError("That is no GitHub status change.");
      }
      await sendJson({
        request,
        name: NAME,
        method: "PATCH",
        url: at,
        headers,
        body: { state: change === "close" ? "closed" : "open" },
        reason: refusalReason,
        missing: MISSING,
      });
    },
    async account() {
      const user = await getJson({
        request,
        name: NAME,
        url: `${apiBase(options.url)}/user`,
        headers,
        schema: Person,
      });
      return user.name ? `${user.name} (@${user.login})` : `@${user.login}`;
    },
  };
}

/** GitHub's reason for refusing a change is its `message`. */
function refusalReason(body: unknown): string | null {
  const parsed = RefusalSchema.safeParse(body);
  return parsed.success ? (parsed.data.message ?? null) : null;
}
