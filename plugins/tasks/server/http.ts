import type { ZodType, output as ZodOutput } from "zod";
import { TrackerError } from "./issue.js";

const TIMEOUT_MS = 10_000;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A tracker's address as the start of its API paths. A token goes to this address, so it must be
 * https; plain http is accepted on this machine only.
 */
export function baseUrl(input: string, name: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new TrackerError(`The ${name} address is not a web address.`);
  }
  const local = url.protocol === "http:" && LOOPBACK.has(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new TrackerError(`The ${name} address must start with https://.`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function unreachable(error: unknown): string {
  if (error instanceof Error && error.name === "TimeoutError") {
    return `no answer in ${TIMEOUT_MS / 1000} s`;
  }
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error && "code" in cause && typeof cause.code === "string") {
    return cause.code;
  }
  return error instanceof Error ? error.message : String(error);
}

function refusal(name: string, status: number): string {
  if (status >= 300 && status < 400) return `${name} answered with a redirect. Check the address.`;
  if (status === 401 || status === 403) return `${name} rejected the saved sign-in details.`;
  if (status === 404) return `${name} has no API at this address.`;
  if (status === 429) return `${name} is limiting requests. Try again shortly.`;
  return `${name} answered HTTP ${status}.`;
}

export interface GetJsonInput<Schema extends ZodType> {
  request: typeof fetch;
  /** The tracker's name, for messages. */
  name: string;
  url: string;
  headers: Record<string, string>;
  schema: Schema;
}

/** Rejects with a `TrackerError`; its `status` is set when the tracker answered. */
export async function getJson<Schema extends ZodType>(
  input: GetJsonInput<Schema>,
): Promise<ZodOutput<Schema>> {
  const { request, name, url, headers, schema } = input;
  let response: Response;
  try {
    response = await request(url, {
      headers: { ...headers, Accept: "application/json" },
      // A redirect would carry the token to wherever it points.
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new TrackerError(`Could not reach ${name}: ${unreachable(error)}.`);
  }
  if (!response.ok) throw new TrackerError(refusal(name, response.status), response.status);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TrackerError(`${name} did not answer with JSON. Check the address.`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new TrackerError(`${name} answered in a shape Paseo does not know.`);
  return parsed.data;
}
