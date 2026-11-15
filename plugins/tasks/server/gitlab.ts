import { z } from "zod";
import { baseUrl, getJson } from "./http.js";
import type { Issue, Tracker } from "./issue.js";

const NAME = "GitLab";
const LIMIT = "20";

const IssueSchema = z.object({
  iid: z.number(),
  title: z.string(),
  description: z.string().nullish(),
  web_url: z.string(),
  labels: z.array(z.unknown()).nullish(),
  references: z.object({ full: z.string() }).nullish(),
});
const UserSchema = z.object({ username: z.string(), name: z.string().nullish() });

export interface GitlabOptions {
  url: string;
  token: string;
  request: typeof fetch;
}

function toIssue(issue: z.infer<typeof IssueSchema>): Issue {
  const labels = (issue.labels ?? []).filter((label) => typeof label === "string");
  return {
    source: "gitlab",
    key: issue.references?.full ?? `#${issue.iid}`,
    title: issue.title,
    // The list asks for open issues only.
    status: "Open",
    url: issue.web_url,
    description: (issue.description ?? "").trim(),
    details: labels.length > 0 ? [["Labels", labels.join(", ")]] : [],
    // GitLab's own branch names start with the issue number.
    branchPrefix: String(issue.iid),
  };
}

export function createGitlab(options: GitlabOptions): Tracker {
  const { request } = options;
  const headers = { "PRIVATE-TOKEN": options.token };
  return {
    source: "gitlab",
    async search(query) {
      const base = baseUrl(options.url, NAME);
      const text = query.trim();
      const params = new URLSearchParams({
        scope: "assigned_to_me",
        state: "opened",
        order_by: "updated_at",
        per_page: LIMIT,
        ...(text ? { search: text, in: "title" } : {}),
      });
      const issues = await getJson({
        request,
        name: NAME,
        url: `${base}/api/v4/issues?${params}`,
        headers,
        schema: z.array(IssueSchema),
      });
      // The link is the tracker's word; one that is no web address cannot be attached.
      return issues.filter((issue) => /^https?:\/\//.test(issue.web_url)).map(toIssue);
    },
    async account() {
      const base = baseUrl(options.url, NAME);
      const user = await getJson({
        request,
        name: NAME,
        url: `${base}/api/v4/user`,
        headers,
        schema: UserSchema,
      });
      return user.name ? `${user.name} (@${user.username})` : `@${user.username}`;
    },
  };
}
