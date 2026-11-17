import { createServer, type Server, type ServerResponse } from "node:http";
import { afterEach, expect, test } from "vitest";
import { TrackerProblem } from "./incidents-http.js";
import { createSentryReader, sentryToken } from "./incidents-sentry.js";

interface Request {
  path: string;
  query: URLSearchParams;
  authorization: string | undefined;
}

interface StandIn {
  base: string;
  requests: Request[];
}

type Answer = (request: Request, res: ServerResponse) => void;

const servers: Server[] = [];

afterEach(async () => {
  const closing = servers.splice(0).map(
    (server) =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  await Promise.all(closing);
});

/** A local server standing in for Sentry; it records each request and answers through `answer`. */
async function standIn(answer: Answer): Promise<StandIn> {
  const requests: Request[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const request = {
      path: url.pathname,
      query: url.searchParams,
      authorization: req.headers.authorization,
    };
    requests.push(request);
    answer(request, res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  return { base: `http://127.0.0.1:${address.port}`, requests };
}

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const PROJECTS = [
  { id: "11", slug: "api", name: "API" },
  { id: "12", slug: "web", name: "Web" },
];

const PROJECTS_PATH = "/api/0/organizations/flavours/projects/";
const ISSUES_PATH = "/api/0/organizations/flavours/issues/";

/** Answers the projects list with PROJECTS and the issue search with `issues`. */
function sentry(issues: unknown[]): Answer {
  return (request, res) => {
    if (request.path === PROJECTS_PATH) return json(res, PROJECTS);
    if (request.path === ISSUES_PATH) return json(res, issues);
    json(res, { detail: "The requested resource does not exist" }, 404);
  };
}

const TOKEN = "sentry-test-token";

function reader(url: string, projects: string[]) {
  return createSentryReader({ url, org: " flavours ", projects, token: TOKEN });
}

test("maps slugs to ids and queries unresolved since the time", async () => {
  const server = await standIn(sentry([]));
  // The settings keep the address as typed; only its origin and path count.
  await reader(`${server.base}/?from=settings`, ["api", "web"]).read(Date.UTC(2026, 10, 17, 5));
  expect(server.requests.map((request) => request.path)).toEqual([PROJECTS_PATH, ISSUES_PATH]);
  expect(Object.fromEntries(server.requests[0].query)).toEqual({ query: "slug:api slug:web" });
  const search = server.requests[1].query;
  expect(search.getAll("project")).toEqual(["11", "12"]);
  expect(Object.fromEntries([...search].filter(([name]) => name !== "project"))).toEqual({
    query: "is:unresolved firstSeen:>=2026-11-17T05:00:00.000Z",
    sort: "new",
    limit: "100",
  });
  const bearer = `Bearer ${TOKEN}`;
  expect(server.requests.map((request) => request.authorization)).toEqual([bearer, bearer]);
});

test("an unknown slug is a problem naming it", async () => {
  const server = await standIn(sentry([]));
  await expect(reader(server.base, ["api", "gone"]).read(0)).rejects.toThrow(
    'Sentry has no project "gone" in the organisation flavours',
  );
  expect(server.requests.map((request) => request.path)).toEqual([PROJECTS_PATH]);
});

test("issues come back oldest first, linked by permalink", async () => {
  // Sentry's `sort=new` is newest first.
  const issues = [
    {
      id: "702",
      shortId: "WEB-9",
      title: "TypeError: total is undefined",
      permalink: "https://flavours.sentry.io/issues/702/",
      firstSeen: "2026-11-17T05:40:00.123456Z",
    },
    {
      id: "701",
      shortId: "API-3",
      title: "Timeout talking to Qoyod",
      permalink: "https://flavours.sentry.io/issues/701/",
      firstSeen: "2026-11-17T05:10:00Z",
    },
  ];
  const server = await standIn(sentry(issues));
  expect(await reader(server.base, ["api", "web"]).read(Date.UTC(2026, 10, 17, 5))).toEqual([
    {
      key: "API-3",
      title: "Timeout talking to Qoyod",
      url: "https://flavours.sentry.io/issues/701/",
      createdAt: Date.UTC(2026, 10, 17, 5, 10),
    },
    {
      key: "WEB-9",
      title: "TypeError: total is undefined",
      url: "https://flavours.sentry.io/issues/702/",
      createdAt: Date.UTC(2026, 10, 17, 5, 40, 0, 123),
    },
  ]);
});

test("a 403 is a problem naming SENTRY_AUTH_TOKEN", async () => {
  const server = await standIn((_request, res) =>
    json(res, { detail: "You do not have permission to perform this action." }, 403),
  );
  const read = reader(server.base, ["api"]).read(0);
  await expect(read).rejects.toBeInstanceOf(TrackerProblem);
  const problem = await read.catch((error: unknown) => error);
  expect(problem).toHaveProperty("message", "Sentry refused the token: check SENTRY_AUTH_TOKEN");
  expect(String(problem)).not.toContain(TOKEN);
});

test("a Sentry that cannot be reached is a problem with the error's code only", async () => {
  const server = await standIn(sentry([]));
  const closed = servers.splice(0);
  await new Promise<void>((resolve) => closed[0].close(() => resolve()));
  await expect(reader(server.base, ["api"]).read(0)).rejects.toThrow(
    new TrackerProblem("Sentry could not be reached: ECONNREFUSED"),
  );
});

test("sentryToken is null when the variable is missing or blank", () => {
  expect(sentryToken({ SENTRY_AUTH_TOKEN: ` ${TOKEN} ` })).toBe(TOKEN);
  expect(sentryToken({})).toBeNull();
  expect(sentryToken({ SENTRY_AUTH_TOKEN: "  " })).toBeNull();
});
