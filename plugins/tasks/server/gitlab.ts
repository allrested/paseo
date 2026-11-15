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

const NAME = "GitLab";
const LIMIT = "20";
/** The newest comments a task's page shows. */
const COMMENTS = 20;
// Notes come mixed with system notes ("changed the description"), which are dropped: twice as
// many are read so a busy task still fills its page.
const NOTES = String(COMMENTS * 2);
const ID = /^(issue|mr):(\d{1,12}):(\d{1,12})$/;
const MISSING = "GitLab has no such task, or the saved account cannot see it.";
const PATH: Record<TaskKind, string> = { issue: "issues", mr: "merge_requests" };

const Person = z.object({ username: z.string(), name: z.string().nullish() });
const IssueSchema = z.object({
  iid: z.number(),
  project_id: z.number(),
  title: z.string(),
  description: z.string().nullish(),
  web_url: z.string(),
  state: z.string().nullish(),
  labels: z.array(z.unknown()).nullish(),
  references: z.object({ full: z.string() }).nullish(),
  updated_at: z.string().nullish(),
  user_notes_count: z.number().nullish(),
});
const MergeRequestSchema = z.object({
  iid: z.number(),
  project_id: z.number(),
  title: z.string(),
  description: z.string().nullish(),
  web_url: z.string(),
  state: z.string().nullish(),
  draft: z.boolean().nullish(),
  source_branch: z.string().nullish(),
  target_branch: z.string().nullish(),
  references: z.object({ full: z.string() }).nullish(),
  updated_at: z.string().nullish(),
  user_notes_count: z.number().nullish(),
  author: Person.nullish(),
  reviewers: z.array(Person).nullish(),
  has_conflicts: z.boolean().nullish(),
  head_pipeline: z.object({ status: z.string().nullish() }).nullish(),
});
const NoteSchema = z.object({
  id: z.number(),
  body: z.string().nullish(),
  author: Person.nullish(),
  created_at: z.string().nullish(),
  system: z.boolean().nullish(),
});
const RefusalSchema = z.object({
  message: z.unknown().optional(),
  error: z.string().nullish(),
  error_description: z.string().nullish(),
});

export interface GitlabOptions {
  url: string;
  token: string;
  request: typeof fetch;
}

function personName(person: z.infer<typeof Person>): string {
  return person.name || `@${person.username}`;
}

function updated(value: string | null | undefined): { updatedAt?: string } {
  const updatedAt = isoTime(value);
  return updatedAt === undefined ? {} : { updatedAt };
}

function toIssue(issue: z.infer<typeof IssueSchema>): Issue {
  const labels = (issue.labels ?? []).filter((label) => typeof label === "string");
  return {
    source: "gitlab",
    kind: "issue",
    id: `issue:${issue.project_id}:${issue.iid}`,
    key: issue.references?.full ?? `#${issue.iid}`,
    title: issue.title,
    status: issue.state === "closed" ? "Closed" : "Open",
    url: issue.web_url,
    description: (issue.description ?? "").trim(),
    details: labels.length > 0 ? [["Labels", labels.join(", ")]] : [],
    // GitLab's own branch names start with the issue number.
    branchPrefix: String(issue.iid),
    ...updated(issue.updated_at),
    phase: issue.state === "closed" ? "done" : "todo",
  };
}

function mergeRequestStatus(request: z.infer<typeof MergeRequestSchema>): string {
  if (request.state === "merged") return "Merged";
  if (request.state === "closed") return "Closed";
  return request.draft ? "Draft" : "Open";
}

/** An open merge request is being worked on; a draft is not yet up for it. */
function mergeRequestPhase(request: z.infer<typeof MergeRequestSchema>): Phase {
  if (request.state === "merged" || request.state === "closed") return "done";
  return request.draft ? "todo" : "doing";
}

/** GitLab's pipeline status as its pages word it. */
function pipelineWord(status: string): string {
  return status === "success" ? "passed" : status.replaceAll("_", " ");
}

function toMergeRequest(request: z.infer<typeof MergeRequestSchema>, note?: string): Issue {
  const details: Issue["details"] = [];
  if (request.source_branch && request.target_branch) {
    details.push(["Branches", `${request.source_branch} → ${request.target_branch}`]);
  }
  if (request.author) details.push(["Author", personName(request.author)]);
  if (request.reviewers && request.reviewers.length > 0) {
    details.push(["Reviewers", request.reviewers.map(personName).join(", ")]);
  }
  if (request.head_pipeline?.status) {
    details.push(["Pipeline", pipelineWord(request.head_pipeline.status)]);
  }
  if (request.has_conflicts) details.push(["Conflicts", "Yes"]);
  return {
    source: "gitlab",
    kind: "mr",
    id: `mr:${request.project_id}:${request.iid}`,
    key: request.references?.full ?? `!${request.iid}`,
    title: request.title,
    status: mergeRequestStatus(request),
    url: request.web_url,
    description: (request.description ?? "").trim(),
    details,
    branchPrefix: String(request.iid),
    ...updated(request.updated_at),
    ...(note === undefined ? {} : { note }),
    phase: mergeRequestPhase(request),
  };
}

/** GitLab's reason for refusing a change: `message` is a sentence or a list per field. */
function refusalReason(body: unknown): string | null {
  const parsed = RefusalSchema.safeParse(body);
  if (!parsed.success) return null;
  const { message, error, error_description: described } = parsed.data;
  if (typeof message === "string") return message;
  if (message !== undefined && message !== null) return JSON.stringify(message);
  return described ?? error ?? null;
}

// The link is the tracker's word; one that is no web address cannot be opened or attached.
function linked<Item extends { web_url: string }>(items: Item[]): Item[] {
  return items.filter((item) => /^https?:\/\//.test(item.web_url));
}

export function createGitlab(options: GitlabOptions): Tracker {
  const { request } = options;
  const headers = { "PRIVATE-TOKEN": options.token };
  // Asked once per tracker: the list of merge requests to review is asked by username.
  let username: Promise<string> | null = null;

  function me(base: string): Promise<string> {
    username ??= getJson({
      request,
      name: NAME,
      url: `${base}/api/v4/user`,
      headers,
      schema: Person,
    }).then(
      (user) => user.username,
      (error: unknown) => {
        username = null;
        throw error;
      },
    );
    return username;
  }

  function listParams(text: string, more: Record<string, string>): URLSearchParams {
    return new URLSearchParams({
      ...more,
      state: "opened",
      order_by: "updated_at",
      per_page: LIMIT,
      ...(text ? { search: text, in: "title" } : {}),
    });
  }

  /** The API address of one task. The id comes from a client, so it must be numbers and no path. */
  function taskUrl(id: string): { kind: TaskKind; at: string } {
    const match = ID.exec(id);
    if (!match) throw new TrackerError("That is no GitLab task.");
    const kind = match[1] as TaskKind;
    const base = baseUrl(options.url, NAME);
    return { kind, at: `${base}/api/v4/projects/${match[2]}/${PATH[kind]}/${match[3]}` };
  }

  async function comments(at: string): Promise<Comment[]> {
    const notes = await getJson({
      request,
      name: NAME,
      url: `${at}/notes?sort=desc&order_by=created_at&per_page=${NOTES}`,
      headers,
      schema: z.array(NoteSchema),
      missing: MISSING,
    });
    return notes
      .filter((note) => !note.system)
      .slice(0, COMMENTS)
      .toReversed()
      .map((note) => ({
        id: String(note.id),
        author: note.author ? personName(note.author) : "Someone",
        at: isoTime(note.created_at) ?? "",
        text: (note.body ?? "").trim(),
      }));
  }

  return {
    source: "gitlab",
    async search(query) {
      const base = baseUrl(options.url, NAME);
      const params = listParams(query.trim(), { scope: "assigned_to_me" });
      const issues = await getJson({
        request,
        name: NAME,
        url: `${base}/api/v4/issues?${params}`,
        headers,
        schema: z.array(IssueSchema),
      });
      return linked(issues).map(toIssue);
    },
    async mergeRequests(query) {
      const base = baseUrl(options.url, NAME);
      const text = query.trim();
      const list = (params: URLSearchParams) =>
        getJson({
          request,
          name: NAME,
          url: `${base}/api/v4/merge_requests?${params}`,
          headers,
          schema: z.array(MergeRequestSchema),
        });
      const [review, assigned] = await Promise.all([
        me(base).then((name) => list(listParams(text, { scope: "all", reviewer_username: name }))),
        list(listParams(text, { scope: "assigned_to_me" })),
      ]);
      // One that is both is listed once, as the review it waits for.
      const found = new Map<string, Issue>();
      for (const item of linked(review)) {
        const shaped = toMergeRequest(item, "Review requested");
        found.set(shaped.id, shaped);
      }
      for (const item of linked(assigned)) {
        const shaped = toMergeRequest(item, "Assigned to you");
        if (!found.has(shaped.id)) found.set(shaped.id, shaped);
      }
      return [...found.values()];
    },
    async find(id) {
      const { kind, at } = taskUrl(id);
      const read = { request, name: NAME, url: at, headers };
      try {
        return kind === "mr"
          ? toMergeRequest(await getJson({ ...read, schema: MergeRequestSchema }))
          : toIssue(await getJson({ ...read, schema: IssueSchema }));
      } catch (error) {
        if (error instanceof TrackerError && error.status === 404) return null;
        throw error;
      }
    },
    async detail(id): Promise<IssueDetail> {
      const { kind, at } = taskUrl(id);
      const read = { request, name: NAME, url: at, headers, missing: MISSING };
      if (kind === "mr") {
        const [item, thread] = await Promise.all([
          getJson({ ...read, schema: MergeRequestSchema }),
          comments(at),
        ]);
        return {
          ...toMergeRequest(item),
          comments: thread,
          earlierComments: Math.max(0, (item.user_notes_count ?? 0) - thread.length),
          // A merge request is merged or closed on GitLab, where its checks are.
          changes: [],
          markdown: true,
        };
      }
      const [item, thread] = await Promise.all([
        getJson({ ...read, schema: IssueSchema }),
        comments(at),
      ]);
      return {
        ...toIssue(item),
        comments: thread,
        earlierComments: Math.max(0, (item.user_notes_count ?? 0) - thread.length),
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
        url: `${at}/notes`,
        headers,
        body: { body: text },
        reason: refusalReason,
        missing: MISSING,
      });
    },
    async change(id, change) {
      const { kind, at } = taskUrl(id);
      if (kind !== "issue") {
        throw new TrackerError("A merge request is merged or closed on GitLab.");
      }
      if (change !== "close" && change !== "reopen") {
        throw new TrackerError("That is no GitLab status change.");
      }
      await sendJson({
        request,
        name: NAME,
        method: "PUT",
        url: at,
        headers,
        body: { state_event: change },
        reason: refusalReason,
        missing: MISSING,
      });
    },
    async account() {
      const base = baseUrl(options.url, NAME);
      const user = await getJson({
        request,
        name: NAME,
        url: `${base}/api/v4/user`,
        headers,
        schema: Person,
      });
      return user.name ? `${user.name} (@${user.username})` : `@${user.username}`;
    },
  };
}
