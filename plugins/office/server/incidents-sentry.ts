import { z } from "zod";
import {
  type FoundIssue,
  getJson,
  type Tracker,
  TrackerProblem,
  type TrackerReader,
} from "./incidents-http.js";

/** Sentry's largest page of issues. One page is read; a burst over it loses its oldest. */
const ISSUES_MAX = 100;

/** Sentry's token from the daemon's environment; null while it is unset or blank. */
export function sentryToken(env: NodeJS.ProcessEnv): string | null {
  const token = (env.SENTRY_AUTH_TOKEN ?? "").trim();
  return token === "" ? null : token;
}

export interface SentryReaderInput {
  /** The settings' `sentryUrl`, as typed. */
  url: string;
  org: string;
  /** Project slugs, already checked against the settings' pattern. */
  projects: string[];
  token: string;
}

const ProjectsSchema = z.array(z.object({ id: z.string(), slug: z.string() }));

const IssuesSchema = z.array(
  z.object({
    shortId: z.string(),
    title: z.string(),
    permalink: z.string(),
    firstSeen: z.string().transform(Date.parse).pipe(z.number()),
  }),
);

/** New unresolved issues in the listed projects. */
export function createSentryReader(
  input: SentryReaderInput,
  fetchFn: typeof fetch = fetch,
): TrackerReader {
  const { projects } = input;
  const org = input.org.trim();
  const site = new URL(input.url.trim());
  const api = `${site.origin}${site.pathname.replace(/\/+$/, "")}/api/0/organizations/${encodeURIComponent(org)}`;
  const tracker: Tracker = {
    name: "Sentry",
    tokenVariable: "SENTRY_AUTH_TOKEN",
    headers: { Authorization: `Bearer ${input.token}` },
    fetchFn,
  };

  /**
   * The listed projects' ids, in the order listed. The issue search takes slugs too, but only on
   * a recent Sentry, and a slug it does not know would go unnoticed. `slug:` filters the list, so
   * an organisation of more than one page of projects still fits in one.
   */
  async function projectIds(): Promise<string[]> {
    const query = new URLSearchParams({ query: projects.map((slug) => `slug:${slug}`).join(" ") });
    const listed = await getJson({
      tracker,
      url: `${api}/projects/?${query}`,
      schema: ProjectsSchema,
    });
    const ids = new Map(listed.map((project) => [project.slug, project.id]));
    return projects.map((slug) => {
      const id = ids.get(slug);
      if (id === undefined) {
        throw new TrackerProblem(`Sentry has no project "${slug}" in the organisation ${org}`);
      }
      return id;
    });
  }

  async function read(since: number): Promise<FoundIssue[]> {
    const query = new URLSearchParams();
    for (const id of await projectIds()) query.append("project", id);
    // With no period given, Sentry looks back 90 days: the window starts later unless the daemon
    // was off for months.
    query.set("query", `is:unresolved firstSeen:>=${new Date(since).toISOString()}`);
    // First seen, newest first: the API has no oldest first.
    query.set("sort", "new");
    query.set("limit", String(ISSUES_MAX));
    const issues = await getJson({ tracker, url: `${api}/issues/?${query}`, schema: IssuesSchema });
    const found = issues.map((issue) => ({
      key: issue.shortId,
      title: issue.title,
      url: issue.permalink,
      createdAt: issue.firstSeen,
    }));
    return found.sort((a, b) => a.createdAt - b.createdAt);
  }

  return { read };
}
