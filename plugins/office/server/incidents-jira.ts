import { z } from "zod";
import {
  type FoundIssue,
  getJson,
  type Tracker,
  TrackerProblem,
  type TrackerReader,
} from "./incidents-http.js";

/** The most issues one read returns; the check opens fewer than this at a time. */
const READ_MAX = 100;

export interface JiraEnv {
  baseUrl: string;
  email: string;
  token: string;
}

/** Jira's site and sign-in from the daemon's environment; null unless all three are set. */
export function jiraEnv(env: NodeJS.ProcessEnv): JiraEnv | null {
  const baseUrl = (env.ATLASSIAN_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const email = (env.ATLASSIAN_EMAIL ?? "").trim();
  const token = (env.ATLASSIAN_API_TOKEN ?? "").trim();
  if (baseUrl === "" || email === "" || token === "") return null;
  return { baseUrl, email, token };
}

// Jira gives the instance's zone when the user's is hidden or unset, so it is rarely absent.
const MyselfSchema = z.object({ timeZone: z.string().nullish() });

const SearchSchema = z.object({
  issues: z.array(
    z.object({
      key: z.string(),
      // `created` as Jira writes it, `2026-11-17T08:03:12.000+0300`.
      fields: z.object({
        summary: z.string(),
        created: z.string().transform(Date.parse).pipe(z.number()),
      }),
    }),
  ),
  nextPageToken: z.string().nullish(),
});

/**
 * `since` as JQL writes a time, `yyyy-MM-dd HH:mm`, in `timeZone`: Jira reads a JQL time in the
 * zone of the token user's profile. The seconds are dropped, so the minute `since` is in counts.
 */
function jqlTime(since: number, timeZone: string): string {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new TrackerProblem(`Jira's time zone ${timeZone} is not known on this host`);
    }
    throw error;
  }
  const parts = new Map(format.formatToParts(since).map((part) => [part.type, part.value]));
  const day = `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
  return `${day} ${parts.get("hour")}:${parts.get("minute")}`;
}

/** New bugs in `projects`, keys already checked against the settings' pattern. */
export function createJiraReader(
  env: JiraEnv,
  projects: string[],
  fetchFn: typeof fetch = fetch,
): TrackerReader {
  const basic = Buffer.from(`${env.email}:${env.token}`).toString("base64");
  const tracker: Tracker = {
    name: "Jira",
    tokenVariable: "ATLASSIAN_API_TOKEN",
    headers: { Authorization: `Basic ${basic}` },
    fetchFn,
  };
  const api = `${env.baseUrl}/rest/api/3`;

  async function read(since: number): Promise<FoundIssue[]> {
    const myself = await getJson({ tracker, url: `${api}/myself`, schema: MyselfSchema });
    // Without a zone from Jira, UTC: the instance's own zone is not known here.
    const time = jqlTime(since, myself.timeZone ?? "UTC");
    const jql = `project in (${projects.join(", ")}) AND issuetype = Bug AND created >= "${time}" ORDER BY created ASC`;
    const found: FoundIssue[] = [];
    let pageToken: string | null = null;
    do {
      const query = new URLSearchParams({
        jql,
        fields: "summary,created",
        maxResults: String(READ_MAX - found.length),
      });
      if (pageToken !== null) query.set("nextPageToken", pageToken);
      const page = await getJson({
        tracker,
        url: `${api}/search/jql?${query}`,
        schema: SearchSchema,
      });
      for (const issue of page.issues) {
        found.push({
          key: issue.key,
          title: issue.fields.summary,
          url: `${env.baseUrl}/browse/${issue.key}`,
          createdAt: issue.fields.created,
        });
      }
      pageToken = page.nextPageToken ?? null;
    } while (pageToken !== null && found.length < READ_MAX);
    return found.slice(0, READ_MAX);
  }

  return { read };
}
