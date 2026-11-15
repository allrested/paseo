import { z } from "zod";
import { adfToText } from "./adf.js";
import { baseUrl, getJson } from "./http.js";
import { TrackerError, type Issue, type Tracker } from "./issue.js";

const NAME = "Jira";
const FIELDS = "summary,status,description,issuetype,priority";
const LIMIT = "20";
// Jira's search wants a bounded query; "mine and not done" is one.
const MINE = "assignee = currentUser() AND statusCategory != Done";
const KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

const Named = z.object({ name: z.string() }).nullish();
const IssueSchema = z.object({
  key: z.string(),
  fields: z.object({
    summary: z.string().nullish(),
    status: Named,
    issuetype: Named,
    priority: Named,
    description: z.unknown().optional(),
  }),
});
const SearchSchema = z.object({ issues: z.array(IssueSchema) });
const MyselfSchema = z.object({
  displayName: z.string().nullish(),
  emailAddress: z.string().nullish(),
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
    return {
      source: "jira",
      key: issue.key,
      title: fields.summary ?? "",
      status: fields.status?.name ?? "Unknown",
      url: `${base}/browse/${encodeURIComponent(issue.key)}`,
      description: adfToText(fields.description),
      details,
      branchPrefix: issue.key,
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
