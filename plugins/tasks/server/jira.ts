import { z } from "zod";
import type { Phase } from "../shared/contracts.js";
import { adfToText, textToAdf } from "./adf.js";
import { baseUrl, getBytes, getJson, sendForJson, sendJson } from "./http.js";
import {
  IMAGE_MAX_BYTES,
  TrackerError,
  isoTime,
  type Comment,
  type Issue,
  type IssueDetail,
  type StatusChange,
  type Tracker,
} from "./issue.js";
import { searchWords } from "./text.js";

const NAME = "Jira";
const FIELDS = "summary,status,description,issuetype,priority,updated";
// A task's page also says whose the issue is and shows its pictures.
const DETAIL_FIELDS = `${FIELDS},assignee,attachment`;
const LIMIT = "20";
/** The newest comments a task's page shows. */
const COMMENTS = 20;
// Jira's search wants a bounded query; "mine and not done" is one.
const MINE = "assignee = currentUser() AND statusCategory != Done";
const KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const TRANSITION = /^\d{1,12}$/;
const PROJECT = /^[A-Za-z][A-Za-z0-9_]*$/;
const NUMBER = /^\d{1,15}$/;
const MISSING = "Jira has no such issue, or the saved account cannot see it.";

const Named = z.object({ name: z.string() }).nullish();
const Status = z
  .object({ name: z.string(), statusCategory: z.object({ key: z.string() }).nullish() })
  .nullish();
// Jira's three status categories, by their keys.
const PHASES: Record<string, Phase> = { new: "todo", indeterminate: "doing", done: "done" };
const IssueSchema = z.object({
  key: z.string(),
  fields: z.object({
    summary: z.string().nullish(),
    status: Status,
    issuetype: Named,
    priority: Named,
    description: z.unknown().optional(),
    updated: z.string().nullish(),
    assignee: z
      .object({ accountId: z.string().nullish(), displayName: z.string().nullish() })
      .nullish(),
    attachment: z
      .array(
        z.object({
          id: z.union([z.string(), z.number()]),
          filename: z.string().nullish(),
          mimeType: z.string().nullish(),
        }),
      )
      .nullish(),
  }),
});
const SearchSchema = z.object({ issues: z.array(IssueSchema) });
const MyselfSchema = z.object({
  accountId: z.string().nullish(),
  displayName: z.string().nullish(),
  emailAddress: z.string().nullish(),
});
const CommentsSchema = z.object({
  comments: z.array(
    z.object({
      id: z.string(),
      author: z.object({ displayName: z.string().nullish() }).nullish(),
      body: z.unknown().optional(),
      created: z.string().nullish(),
    }),
  ),
  total: z.number().nullish(),
});
const TransitionsSchema = z.object({
  transitions: z.array(z.object({ id: z.string(), name: z.string().nullish(), to: Named })),
});
const ProjectsSchema = z.object({
  values: z.array(z.object({ key: z.string(), name: z.string().nullish() })),
});
const IssueTypesSchema = z.object({
  issueTypes: z.array(
    z.object({ id: z.string(), name: z.string().nullish(), subtask: z.boolean().nullish() }),
  ),
});
const CreatedSchema = z.object({ key: z.string() });
const RefusalSchema = z.object({
  errorMessages: z.array(z.string()).nullish(),
  errors: z.record(z.string(), z.string()).nullish(),
});

export interface JiraOptions {
  site: string;
  email: string;
  token: string;
  request: typeof fetch;
}

/** Jira's reasons for refusing a change: its messages, then what it says about each field. */
function refusalReason(body: unknown): string | null {
  const parsed = RefusalSchema.safeParse(body);
  if (!parsed.success) return null;
  const reasons = [
    ...(parsed.data.errorMessages ?? []),
    ...Object.values(parsed.data.errors ?? {}),
  ];
  return reasons.length > 0 ? reasons.join(" ") : null;
}

/**
 * The statuses an issue can move to. A transition is named after its action ("Start progress"),
 * and what the user picks is where it ends, so that is the label; two that end in one status
 * also carry their names. One that ends where the issue already is moves nothing and is left out.
 */
export function statusChanges(
  transitions: z.infer<typeof TransitionsSchema>["transitions"],
  current: string,
): StatusChange[] {
  const moves = transitions.flatMap(({ id, name, to }) =>
    to && to.name !== current ? [{ id, name: name ?? "", to: to.name }] : [],
  );
  return moves.map(({ id, name, to }) => {
    const shared = moves.filter((move) => move.to === to).length > 1;
    return { id, label: shared && name !== "" && name !== to ? `${to} (${name})` : to };
  });
}

export function createJira(options: JiraOptions): Tracker {
  const { request } = options;
  const headers = {
    Authorization: `Basic ${Buffer.from(`${options.email}:${options.token}`).toString("base64")}`,
  };

  function toIssue(base: string, issue: z.infer<typeof IssueSchema>): Issue {
    const { fields } = issue;
    const details: Issue["details"] = [];
    if (fields.issuetype) details.push(["Type", fields.issuetype.name]);
    if (fields.priority) details.push(["Priority", fields.priority.name]);
    if (fields.assignee) details.push(["Assignee", fields.assignee.displayName || "Someone"]);
    const updatedAt = isoTime(fields.updated);
    const phase = PHASES[fields.status?.statusCategory?.key ?? ""];
    return {
      source: "jira",
      kind: "issue",
      id: issue.key,
      key: issue.key,
      title: fields.summary ?? "",
      status: fields.status?.name ?? "Unknown",
      url: `${base}/browse/${encodeURIComponent(issue.key)}`,
      description: adfToText(fields.description),
      details,
      branchPrefix: issue.key,
      ...(updatedAt === undefined ? {} : { updatedAt }),
      ...(phase === undefined ? {} : { phase }),
    };
  }

  /** One issue by its key, whoever it is assigned to. A key nobody has is no result. */
  async function byKey(base: string, key: string): Promise<Issue[]> {
    try {
      const issue = await getJson({
        request,
        name: NAME,
        url: `${base}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${FIELDS}`,
        headers,
        schema: IssueSchema,
      });
      return [toIssue(base, issue)];
    } catch (error) {
      if (error instanceof TrackerError && error.status === 404) return [];
      throw error;
    }
  }

  // Asked once per tracker: a task's page says whether the issue is the signed-in user's.
  let account: Promise<string> | null = null;

  function myAccount(base: string): Promise<string> {
    account ??= getJson({
      request,
      name: NAME,
      url: `${base}/rest/api/3/myself`,
      headers,
      schema: MyselfSchema,
    }).then(
      (me) => me.accountId ?? "",
      (error: unknown) => {
        account = null;
        throw error;
      },
    );
    return account;
  }

  /** The API address of one issue. The id comes from a client, so it must be a key and no path. */
  function issueUrl(id: string): { base: string; at: string } {
    if (!KEY.test(id)) throw new TrackerError("That is no Jira issue key.");
    const base = baseUrl(options.site, NAME);
    return { base, at: `${base}/rest/api/3/issue/${encodeURIComponent(id.toUpperCase())}` };
  }

  return {
    source: "jira",
    async search(query) {
      const base = baseUrl(options.site, NAME);
      const text = query.trim();
      if (KEY.test(text)) return byKey(base, text.toUpperCase());
      const words = searchWords(text);
      const match = words ? ` AND summary ~ "${words}*"` : "";
      const params = new URLSearchParams({
        jql: `${MINE}${match} ORDER BY updated DESC`,
        maxResults: LIMIT,
        fields: FIELDS,
      });
      const found = await getJson({
        request,
        name: NAME,
        url: `${base}/rest/api/3/search/jql?${params}`,
        headers,
        schema: SearchSchema,
      });
      return found.issues.map((issue) => toIssue(base, issue));
    },
    async find(id) {
      const { base } = issueUrl(id);
      const [issue] = await byKey(base, id.toUpperCase());
      return issue ?? null;
    },
    async detail(id): Promise<IssueDetail> {
      const { base, at } = issueUrl(id);
      const read = { request, name: NAME, headers, missing: MISSING };
      const [issue, page, moves, mine] = await Promise.all([
        getJson({ ...read, url: `${at}?fields=${DETAIL_FIELDS}`, schema: IssueSchema }),
        getJson({
          ...read,
          url: `${at}/comment?orderBy=-created&maxResults=${COMMENTS}`,
          schema: CommentsSchema,
        }),
        getJson({ ...read, url: `${at}/transitions`, schema: TransitionsSchema }),
        myAccount(base),
      ]);
      const shaped = toIssue(base, issue);
      const comments: Comment[] = page.comments.toReversed().map((comment) => ({
        id: comment.id,
        author: comment.author?.displayName || "Someone",
        at: isoTime(comment.created) ?? "",
        text: adfToText(comment.body),
      }));
      return {
        ...shaped,
        comments,
        earlierComments: Math.max(0, (page.total ?? comments.length) - comments.length),
        changes: statusChanges(moves.transitions, shaped.status),
        markdown: false,
        assignedToMe: mine !== "" && issue.fields.assignee?.accountId === mine,
        // Jira's pictures are attachments; the description names them by an id the API cannot follow.
        images: (issue.fields.attachment ?? [])
          .filter((file) => file.mimeType?.startsWith("image/"))
          .map((file) => ({ id: String(file.id), name: file.filename || "image" })),
      };
    },
    async comment(id, text) {
      const { at } = issueUrl(id);
      await sendJson({
        request,
        name: NAME,
        method: "POST",
        url: `${at}/comment`,
        headers,
        body: { body: textToAdf(text) },
        reason: refusalReason,
        missing: MISSING,
      });
    },
    async change(id, change) {
      const { at } = issueUrl(id);
      if (!TRANSITION.test(change)) throw new TrackerError("That is no Jira status change.");
      await sendJson({
        request,
        name: NAME,
        method: "POST",
        url: `${at}/transitions`,
        headers,
        body: { transition: { id: change } },
        reason: refusalReason,
        missing: MISSING,
      });
    },
    async places(query) {
      const base = baseUrl(options.site, NAME);
      const params = new URLSearchParams({ maxResults: LIMIT });
      const text = query.trim();
      if (text) params.set("query", text);
      const found = await getJson({
        request,
        name: NAME,
        url: `${base}/rest/api/3/project/search?${params}`,
        headers,
        schema: ProjectsSchema,
      });
      return found.values.map((project) => ({
        id: project.key,
        label: project.name ? `${project.key} · ${project.name}` : project.key,
      }));
    },
    async kinds(place) {
      if (!PROJECT.test(place)) throw new TrackerError("That is no Jira project key.");
      const base = baseUrl(options.site, NAME);
      const found = await getJson({
        request,
        name: NAME,
        url: `${base}/rest/api/3/issue/createmeta/${place.toUpperCase()}/issuetypes?maxResults=50`,
        headers,
        schema: IssueTypesSchema,
        missing: "Jira has no such project, or the saved account cannot make issues in it.",
      });
      // A subtask needs a parent, which this form does not ask for.
      return found.issueTypes
        .filter((type) => !type.subtask)
        .map((type) => ({ id: type.id, label: type.name || type.id }));
    },
    async create({ place, kind, title, description }) {
      if (!PROJECT.test(place)) throw new TrackerError("That is no Jira project key.");
      if (kind === undefined || !NUMBER.test(kind)) {
        throw new TrackerError("Pick the kind of issue first.");
      }
      const base = baseUrl(options.site, NAME);
      const made = await sendForJson({
        request,
        name: NAME,
        method: "POST",
        url: `${base}/rest/api/3/issue`,
        headers,
        body: {
          fields: {
            project: { key: place.toUpperCase() },
            issuetype: { id: kind },
            summary: title,
            ...(description === "" ? {} : { description: textToAdf(description) }),
          },
        },
        reason: refusalReason,
        schema: CreatedSchema,
      });
      return made.key;
    },
    async assign(id) {
      const { base, at } = issueUrl(id);
      const accountId = await myAccount(base);
      await sendJson({
        request,
        name: NAME,
        method: "PUT",
        url: `${at}/assignee`,
        headers,
        body: { accountId },
        reason: refusalReason,
        missing: MISSING,
      });
    },
    async image(id, image) {
      const { base } = issueUrl(id);
      if (!NUMBER.test(image)) throw new TrackerError("That is no Jira attachment.");
      return getBytes({
        request,
        name: NAME,
        // Without a redirect: Jira would send the file's link to a host of its own.
        url: `${base}/rest/api/3/attachment/content/${image}?redirect=false`,
        headers,
        missing: "Jira has no such attachment, or the saved account cannot see it.",
        maxBytes: IMAGE_MAX_BYTES,
      });
    },
    async account() {
      const base = baseUrl(options.site, NAME);
      const me = await getJson({
        request,
        name: NAME,
        url: `${base}/rest/api/3/myself`,
        headers,
        schema: MyselfSchema,
      });
      return me.displayName || me.emailAddress || options.email;
    },
  };
}
