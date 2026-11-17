import { z } from "zod";

/** An issue a tracker made since the time asked; `createdAt` is the tracker's time, epoch ms. */
export interface FoundIssue {
  key: string;
  title: string;
  url: string;
  createdAt: number;
}

export interface TrackerReader {
  /** The issues made since `since` (epoch ms), oldest first. Rejects with a `TrackerProblem`. */
  read(since: number): Promise<FoundIssue[]>;
}

/**
 * Why a tracker could not be read. The message is shown on the Incidents card and logged, so it
 * holds a status and the tracker's own words only: never a header, a token or an address.
 */
export class TrackerProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrackerProblem";
  }
}

const TIMEOUT_MS = 30_000;
/** How much of the tracker's own words a problem keeps. */
const WORDS_MAX = 200;

export interface Tracker {
  /** The tracker's name, for messages. */
  name: "Jira" | "Sentry";
  /** The variable that holds the token, named when the tracker refuses it. */
  tokenVariable: string;
  /** The sign-in header, sent with every request. */
  headers: Record<string, string>;
  fetchFn: typeof fetch;
}

export interface GetJsonInput<Schema extends z.ZodType> {
  tracker: Tracker;
  url: string;
  schema: Schema;
}

// Jira says why in `errorMessages`, Sentry in `detail`. Either may be missing or of another shape.
const RefusalSchema = z.object({
  errorMessages: z.array(z.string()).optional().catch(undefined),
  detail: z.string().optional().catch(undefined),
});

/** A failed request's error says nothing safe but its code: its text can hold the address. */
function unreachable(name: string, error: unknown): TrackerProblem {
  if (error instanceof Error && error.name === "TimeoutError") {
    return new TrackerProblem(`${name} did not answer in ${TIMEOUT_MS / 1000} s`);
  }
  const cause = error instanceof Error ? error.cause : undefined;
  const hasCode = cause instanceof Error && "code" in cause && typeof cause.code === "string";
  if (!hasCode) return new TrackerProblem(`${name} could not be reached`);
  return new TrackerProblem(`${name} could not be reached: ${cause.code}`);
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    // An error page from a proxy, say: the status is then all there is to tell.
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function refusal(name: string, status: number, body: unknown): TrackerProblem {
  const parsed = RefusalSchema.safeParse(body);
  const said = parsed.success ? (parsed.data.errorMessages?.[0] ?? parsed.data.detail ?? "") : "";
  const words = said.replace(/\s+/g, " ").trim().slice(0, WORDS_MAX);
  if (words === "") return new TrackerProblem(`${name} answered HTTP ${status}`);
  return new TrackerProblem(`${name} answered HTTP ${status}: ${words}`);
}

/** One GET to a tracker, read through `schema`. Rejects with a `TrackerProblem`. */
export async function getJson<Schema extends z.ZodType>(
  input: GetJsonInput<Schema>,
): Promise<z.output<Schema>> {
  const { tracker, url, schema } = input;
  const { name } = tracker;
  let response: Response;
  let text: string;
  try {
    response = await tracker.fetchFn(url, {
      headers: { ...tracker.headers, Accept: "application/json" },
      // A redirect would carry the token to wherever it points.
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    text = await response.text();
  } catch (error) {
    throw unreachable(name, error);
  }
  const { status } = response;
  if (status >= 300 && status < 400) {
    throw new TrackerProblem(`${name} answered with a redirect (HTTP ${status})`);
  }
  if (status === 401 || status === 403) {
    throw new TrackerProblem(`${name} refused the token: check ${tracker.tokenVariable}`);
  }
  const body = parseBody(text);
  if (!response.ok) throw refusal(name, status, body);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new TrackerProblem(`${name} answered in a shape the office does not read`);
  }
  return parsed.data;
}
