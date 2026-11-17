import { createServer, type Server } from "node:http";
import { afterEach, expect, test } from "vitest";
import { fakeSchedules } from "./fake-schedules.js";
import {
  createIncidentsSchedule,
  INCIDENTS_SCHEDULE,
  type IncidentsSettings,
  incidentsReaders,
} from "./incidents-schedule.js";

const EVERY_5_MINUTES = { type: "every", everyMs: 300_000 } as const;
const SAVED = {
  name: "incidents",
  handler: "incidents",
  prompt: "Incidents",
  cadence: EVERY_5_MINUTES,
};

test("kept every 5 minutes while on, removed when off, left alone when unchanged", async () => {
  // As the daemon kept it across a restart.
  const fake = fakeSchedules([
    {
      id: "s1",
      name: "incidents",
      handler: "incidents",
      cadence: EVERY_5_MINUTES,
      nextRunAt: null,
    },
  ]);
  const schedule = createIncidentsSchedule({ schedules: fake, log: () => undefined });
  await schedule.sync(true);
  expect(fake.upserted).toEqual([]);

  await schedule.sync(false);
  expect(fake.removed).toEqual(["incidents"]);
  await schedule.sync(true);
  await schedule.sync(true);
  expect(fake.upserted).toEqual([SAVED]);
  expect(INCIDENTS_SCHEDULE).toBe("incidents");
});

test("a save that rejects is kept as the error and cleared by the next sync", async () => {
  const fake = fakeSchedules();
  const logs: string[] = [];
  const schedule = createIncidentsSchedule({
    schedules: fake,
    log: (message) => logs.push(message),
  });
  fake.upsertRejects(new Error("Plugin schedules are unavailable"));
  await schedule.sync(true);
  expect(schedule.error()).toBe("Plugin schedules are unavailable");
  expect(logs).toEqual(["[office] incidents schedule failed: Plugin schedules are unavailable"]);

  fake.upsertRejects(null);
  await schedule.sync(true);
  expect(schedule.error()).toBeNull();
  expect(fake.upserted).toEqual([SAVED]);
});

test("changes are synced one at a time, so a slow save cannot land after a later one", async () => {
  const fake = fakeSchedules();
  const schedule = createIncidentsSchedule({ schedules: fake, log: () => undefined });
  const release = fake.holdNextUpsert();
  const on = schedule.sync(true);
  const off = schedule.sync(false);
  release();
  await Promise.all([on, off]);
  expect(fake.upserted).toEqual([SAVED]);
  expect(fake.removed).toEqual(["incidents"]);
  // The removal came last.
  expect(await fake.list()).toEqual([]);
});

const NONE: IncidentsSettings = {
  jiraProjects: "",
  sentryOrg: "",
  sentryProjects: "",
  sentryUrl: "https://sentry.io",
};

/** Placeholder values: no test holds a real token. */
const JIRA_ENV = {
  ATLASSIAN_BASE_URL: "https://jira.example.test",
  ATLASSIAN_EMAIL: "office@example.test",
  ATLASSIAN_API_TOKEN: "placeholder-jira-token",
};
const SENTRY_ENV = { SENTRY_AUTH_TOKEN: "placeholder-sentry-token" };

function trackersOn(values: Partial<IncidentsSettings>, env: NodeJS.ProcessEnv): string[] {
  return Object.keys(incidentsReaders({ ...NONE, ...values }, env));
}

test("Jira is on only with all three ATLASSIAN_* and a project", () => {
  expect(trackersOn({ jiraProjects: "OPS" }, JIRA_ENV)).toEqual(["jira"]);
  expect(trackersOn({ jiraProjects: "OPS" }, { ...JIRA_ENV, ATLASSIAN_EMAIL: "" })).toEqual([]);
  expect(trackersOn({ jiraProjects: "OPS" }, { ...JIRA_ENV, ATLASSIAN_BASE_URL: " " })).toEqual([]);
  expect(
    trackersOn({ jiraProjects: "OPS" }, { ...JIRA_ENV, ATLASSIAN_API_TOKEN: undefined }),
  ).toEqual([]);
  expect(trackersOn({ jiraProjects: " , " }, JIRA_ENV)).toEqual([]);
  expect(trackersOn({}, { ...JIRA_ENV, ...SENTRY_ENV })).toEqual([]);
});

test("Sentry is on only with SENTRY_AUTH_TOKEN, an org and a project", () => {
  const sentry = { sentryOrg: "acme", sentryProjects: "pos" };
  expect(trackersOn(sentry, SENTRY_ENV)).toEqual(["sentry"]);
  expect(trackersOn(sentry, { SENTRY_AUTH_TOKEN: " " })).toEqual([]);
  expect(trackersOn({ ...sentry, sentryOrg: "  " }, SENTRY_ENV)).toEqual([]);
  expect(trackersOn({ ...sentry, sentryProjects: "" }, SENTRY_ENV)).toEqual([]);
  expect(trackersOn({ ...sentry, jiraProjects: "OPS" }, { ...JIRA_ENV, ...SENTRY_ENV })).toEqual([
    "jira",
    "sentry",
  ]);
});

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

/** A local server standing in for both trackers: it records each request and answers by path. */
async function standIn(answers: Record<string, unknown>): Promise<{ base: string; asked: URL[] }> {
  const asked: URL[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    asked.push(url);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(answers[url.pathname]));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  return { base: `http://127.0.0.1:${address.port}`, asked };
}

test("the readers read the settings' projects from the environment's Jira and the settings' Sentry", async () => {
  const server = await standIn({
    "/rest/api/3/myself": { timeZone: "UTC" },
    "/rest/api/3/search/jql": { issues: [] },
    "/api/0/organizations/acme/projects/": [{ id: "7", slug: "pos" }],
    "/api/0/organizations/acme/issues/": [],
  });
  const readers = incidentsReaders(
    {
      jiraProjects: " OPS, QA ",
      sentryOrg: " acme ",
      sentryProjects: "pos",
      sentryUrl: server.base,
    },
    { ...JIRA_ENV, ATLASSIAN_BASE_URL: server.base, ...SENTRY_ENV },
  );
  await readers.jira?.read(Date.UTC(2026, 10, 17, 5, 0));
  await readers.sentry?.read(Date.UTC(2026, 10, 17, 5, 0));
  expect(server.asked.map((url) => url.pathname)).toEqual([
    "/rest/api/3/myself",
    "/rest/api/3/search/jql",
    "/api/0/organizations/acme/projects/",
    "/api/0/organizations/acme/issues/",
  ]);
  expect(server.asked[1].searchParams.get("jql")).toMatch(/^project in \("OPS", "QA"\) AND /);
  expect(server.asked[3].searchParams.getAll("project")).toEqual(["7"]);
});
