import { z } from "zod";
import { adfToText, textToAdf } from "./adf.js";
import { baseUrl, getJson, sendJson } from "./http.js";
import {
  TrackerError,
  isoTime,
  type Comment,
  type Issue,
  type IssueDetail,
  type StatusChange,
  type Tracker,
} from "./issue.js";

const NAME = "Jira";
const FIELDS = "summary,status,description,issuetype,priority,updated";
const LIMIT = "20";
/** The newest comments a task's page shows. */
const COMMENTS = 20;
// Jira's search wants a bounded query; "mine and not done" is one.
const MINE = "assignee = currentUser() AND statusCategory != Done";
const KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const TRANSITION = /^\d{1,12}$/;
const MISSING = "Jira has no such issue, or the saved account cannot see it.";

const Named = z.object({ name: z.string() }).nullish();
const IssueSchema = z.object({
  key: z.string(),
  fields: z.object({
    summary: z.string().nullish(),
    status: Named,
    issuetype: Named,
    priority: Named,
    description: z.unknown().optional(),
    updated: z.string().nullish(),
  }),
});
const SearchSchema = z.object({ issues: z.array(IssueSchema) });
const MyselfSchema = z.object({
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

/**
 * The words of a query for JQL's text match. Its operators (quotes, `-`, `~`, `*` and the rest)
 * are dropped, so what the user typed cannot change the query.
 */
function searchWords(query: string): string {
  return query
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
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
    const updatedAt = isoTime(fields.updated);
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
    async detail(id): Promise<IssueDetail> {
      const { base, at } = issueUrl(id);
      const read = { request, name: NAME, headers, missing: MISSING };
      const [issue, page, moves] = await Promise.all([
        getJson({ ...read, url: `${at}?fields=${FIELDS}`, schema: IssueSchema }),
        getJson({
          ...read,
          url: `${at}/comment?orderBy=-created&maxResults=${COMMENTS}`,
          schema: CommentsSchema,
        }),
        getJson({ ...read, url: `${at}/transitions`, schema: TransitionsSchema }),
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
