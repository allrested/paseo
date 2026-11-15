import { z } from "zod";
import type { Phase } from "../shared/contracts.js";
import { baseUrl, getBytes, getJson, sendForJson, sendJson } from "./http.js";
import {
  IMAGE_MAX_BYTES,
  TrackerError,
  isoTime,
  type Comment,
  type Issue,
  type IssueDetail,
  type Review,
  type ReviewThread,
  type TaskKind,
  type Tracker,
} from "./issue.js";
import { takeImages } from "./text.js";

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
const PROJECT = /^\d{1,12}$/;
// A file dropped into a description: GitLab writes its link from the project, with a secret.
const UPLOAD = /!\[([^\]]*)\]\(\/uploads\/([0-9a-f]{32})\/([^)\s]+)\)(?:\{[^}]*\})?/g;
const UPLOAD_ID = /^[0-9a-f]{32}\/[^/?#\s]{1,200}$/;
// A merge request's discussions come oldest first, system notes among them, a page at a time.
const DISCUSSIONS = 100;
const DISCUSSION_PAGES = 5;
const DISCUSSION_ID = /^[0-9a-f]{8,64}$/;

const Person = z.object({
  id: z.number().nullish(),
  username: z.string(),
  name: z.string().nullish(),
});
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
  assignees: z.array(Person).nullish(),
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
  assignees: z.array(Person).nullish(),
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
  /** True for a note of a review thread, which a merge request's page shows with its thread. */
  resolvable: z.boolean().nullish(),
});
const DiscussionSchema = z.object({
  id: z.string(),
  notes: z.array(
    NoteSchema.extend({
      resolved: z.boolean().nullish(),
      resolved_by: Person.nullish(),
      position: z
        .object({
          new_path: z.string().nullish(),
          old_path: z.string().nullish(),
          new_line: z.number().nullish(),
          old_line: z.number().nullish(),
        })
        .nullish(),
    }),
  ),
});
type Discussion = z.infer<typeof DiscussionSchema>;
const ProjectSchema = z.object({ id: z.number(), path_with_namespace: z.string() });
const CreatedSchema = z.object({ iid: z.number(), project_id: z.number() });
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

/** Whose the task is, as one row of its facts; none when nobody has it. */
function assignee(people: Array<z.infer<typeof Person>> | null | undefined): Issue["details"] {
  if (!people || people.length === 0) return [];
  return [["Assignee", people.map(personName).join(", ")]];
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
    details: [
      ...(labels.length > 0 ? ([["Labels", labels.join(", ")]] as Issue["details"]) : []),
      ...assignee(issue.assignees),
    ],
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
  details.push(...assignee(request.assignees));
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

function toComment(note: z.infer<typeof NoteSchema>): Comment {
  return {
    id: String(note.id),
    author: note.author ? personName(note.author) : "Someone",
    at: isoTime(note.created_at) ?? "",
    text: (note.body ?? "").trim(),
  };
}

/** A discussion as a review thread; null for one that cannot be resolved (a plain comment). */
function toThread(discussion: Discussion): ReviewThread | null {
  const notes = discussion.notes.filter((note) => !note.system);
  const resolvable = notes.filter((note) => note.resolvable);
  if (resolvable.length === 0) return null;
  const resolved = resolvable.every((note) => note.resolved);
  const resolver = resolvable.findLast((note) => note.resolved_by)?.resolved_by;
  const position = notes.find((note) => note.position)?.position;
  const path = position?.new_path ?? position?.old_path;
  const line = position?.new_line ?? position?.old_line;
  return {
    id: discussion.id,
    resolved,
    ...(resolved && resolver ? { resolvedBy: personName(resolver) } : {}),
    ...(path ? { where: line ? `${path}:${line}` : path } : {}),
    notes: notes.map(toComment),
  };
}

// The link is the tracker's word; one that is no web address cannot be opened or attached.
function linked<Item extends { web_url: string }>(items: Item[]): Item[] {
  return items.filter((item) => /^https?:\/\//.test(item.web_url));
}

export function createGitlab(options: GitlabOptions): Tracker {
  const { request } = options;
  const headers = { "PRIVATE-TOKEN": options.token };
  // Asked once per tracker: the merge requests to review are asked by username, and a task's
  // page says whether the task is the signed-in user's.
  let signedIn: Promise<z.infer<typeof Person>> | null = null;

  function me(base: string): Promise<z.infer<typeof Person>> {
    signedIn ??= getJson({
      request,
      name: NAME,
      url: `${base}/api/v4/user`,
      headers,
      schema: Person,
    }).catch((error: unknown) => {
      signedIn = null;
      throw error;
    });
    return signedIn;
  }

  /** What a task's page adds to the task: whether it is mine, and the pictures of its text. */
  function pageFacts(
    task: Issue,
    people: Array<z.infer<typeof Person>> | null | undefined,
    mine: z.infer<typeof Person>,
  ) {
    const taken = takeImages(task.description, UPLOAD, ([, alt, secret, file]) => ({
      id: `${secret}/${file}`,
      name: alt && alt !== "image" ? alt : file,
    }));
    return {
      description: taken.text,
      images: taken.images,
      assignedToMe: (people ?? []).some((person) => person.username === mine.username),
    };
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
  function taskUrl(id: string): { kind: TaskKind; base: string; project: string; at: string } {
    const match = ID.exec(id);
    if (!match) throw new TrackerError("That is no GitLab task.");
    const kind = match[1] as TaskKind;
    const base = baseUrl(options.url, NAME);
    const project = match[2];
    return {
      kind,
      base,
      project,
      at: `${base}/api/v4/projects/${project}/${PATH[kind]}/${match[3]}`,
    };
  }

  /**
   * The newest comments of a task, and how many of its notes they account for. A merge request's
   * review notes are left to its threads, and count as accounted for.
   */
  async function comments(
    at: string,
    kind: TaskKind,
  ): Promise<{ shown: Comment[]; counted: number }> {
    const notes = await getJson({
      request,
      name: NAME,
      url: `${at}/notes?sort=desc&order_by=created_at&per_page=${NOTES}`,
      headers,
      schema: z.array(NoteSchema),
      missing: MISSING,
    });
    const written = notes.filter((note) => !note.system);
    const plain = kind === "mr" ? written.filter((note) => !note.resolvable) : written;
    const shown = plain.slice(0, COMMENTS).toReversed().map(toComment);
    return { shown, counted: shown.length + (written.length - plain.length) };
  }

  /** The API address of one merge request's discussions, and of one of them. */
  function reviewUrl(id: string, thread?: string): string {
    const { kind, at } = taskUrl(id);
    if (kind !== "mr") throw new TrackerError("Only a merge request has review threads.");
    if (thread === undefined) return `${at}/discussions`;
    if (!DISCUSSION_ID.test(thread)) throw new TrackerError("That is no GitLab thread.");
    return `${at}/discussions/${thread}`;
  }

  const threadReview: Review = {
    async list(id) {
      const at = reviewUrl(id);
      const threads: ReviewThread[] = [];
      for (let page = 1; page <= DISCUSSION_PAGES; page += 1) {
        const found = await getJson({
          request,
          name: NAME,
          url: `${at}?per_page=${DISCUSSIONS}&page=${page}`,
          headers,
          schema: z.array(DiscussionSchema),
          missing: MISSING,
        });
        threads.push(...found.flatMap((discussion) => toThread(discussion) ?? []));
        if (found.length < DISCUSSIONS) return { threads, more: false };
      }
      return { threads, more: true };
    },
    async reply(id, thread, text) {
      await sendJson({
        request,
        name: NAME,
        method: "POST",
        url: `${reviewUrl(id, thread)}/notes`,
        headers,
        body: { body: text },
        reason: refusalReason,
        missing: MISSING,
      });
    },
    async resolve(id, thread, resolved) {
      await sendJson({
        request,
        name: NAME,
        method: "PUT",
        url: `${reviewUrl(id, thread)}?resolved=${resolved}`,
        headers,
        body: {},
        reason: refusalReason,
        missing: MISSING,
      });
    },
  };

  return {
    source: "gitlab",
    review: threadReview,
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
        me(base).then(({ username }) =>
          list(listParams(text, { scope: "all", reviewer_username: username })),
        ),
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
      const { kind, base, at } = taskUrl(id);
      const read = { request, name: NAME, url: at, headers, missing: MISSING };
      if (kind === "mr") {
        const [item, thread, mine] = await Promise.all([
          getJson({ ...read, schema: MergeRequestSchema }),
          comments(at, kind),
          me(base),
        ]);
        const shaped = toMergeRequest(item);
        return {
          ...shaped,
          ...pageFacts(shaped, item.assignees, mine),
          comments: thread.shown,
          earlierComments: Math.max(0, (item.user_notes_count ?? 0) - thread.counted),
          // A merge request is merged or closed on GitLab, where its checks are.
          changes: [],
          markdown: true,
        };
      }
      const [item, thread, mine] = await Promise.all([
        getJson({ ...read, schema: IssueSchema }),
        comments(at, kind),
        me(base),
      ]);
      const shaped = toIssue(item);
      return {
        ...shaped,
        ...pageFacts(shaped, item.assignees, mine),
        comments: thread.shown,
        earlierComments: Math.max(0, (item.user_notes_count ?? 0) - thread.counted),
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
    async places(query) {
      const base = baseUrl(options.url, NAME);
      const text = query.trim();
      const params = new URLSearchParams({
        membership: "true",
        simple: "true",
        order_by: "last_activity_at",
        per_page: LIMIT,
        ...(text ? { search: text } : {}),
      });
      const projects = await getJson({
        request,
        name: NAME,
        url: `${base}/api/v4/projects?${params}`,
        headers,
        schema: z.array(ProjectSchema),
      });
      return projects.map((project) => ({
        id: String(project.id),
        label: project.path_with_namespace,
      }));
    },
    async create({ place, title, description }) {
      if (!PROJECT.test(place)) throw new TrackerError("That is no GitLab project.");
      const base = baseUrl(options.url, NAME);
      const made = await sendForJson({
        request,
        name: NAME,
        method: "POST",
        url: `${base}/api/v4/projects/${place}/issues`,
        headers,
        body: { title, description },
        reason: refusalReason,
        missing: "GitLab has no such project, or the saved account cannot see it.",
        schema: CreatedSchema,
      });
      return `issue:${made.project_id}:${made.iid}`;
    },
    async assign(id) {
      const { kind, base, at } = taskUrl(id);
      const read = { request, name: NAME, url: at, headers, missing: MISSING };
      const [mine, item] = await Promise.all([
        me(base),
        getJson({ ...read, schema: kind === "mr" ? MergeRequestSchema : IssueSchema }),
      ]);
      if (typeof mine.id !== "number")
        throw new TrackerError("GitLab did not say who is signed in.");
      const others = (item.assignees ?? []).flatMap((person) =>
        typeof person.id === "number" && person.id !== mine.id ? [person.id] : [],
      );
      await sendJson({
        request,
        name: NAME,
        method: "PUT",
        url: at,
        headers,
        // First, because a GitLab without multiple assignees keeps one.
        body: { assignee_ids: [mine.id, ...others] },
        reason: refusalReason,
        missing: MISSING,
      });
    },
    async image(id, image) {
      const { base, project } = taskUrl(id);
      if (!UPLOAD_ID.test(image)) throw new TrackerError("That is no GitLab upload.");
      return getBytes({
        request,
        name: NAME,
        url: `${base}/api/v4/projects/${project}/uploads/${image}`,
        headers,
        // The API serves uploads from GitLab 17.4 on.
        missing: "GitLab has no such upload here, or is older than 17.4 and cannot hand it out.",
        maxBytes: IMAGE_MAX_BYTES,
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
