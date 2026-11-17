import { expect, test } from "vitest";
import {
  JIRA_KEY,
  officeDeviceSettings,
  officeHostSettings,
  parseKeys,
  SENTRY_SLUG,
} from "./settings.js";

const INCIDENT_DEFAULTS = {
  jiraProjects: "",
  sentryOrg: "",
  sentryProjects: "",
  sentryUrl: "https://sentry.io",
};

function hostIssues(values: Record<string, unknown>): string[] {
  const parsed = officeHostSettings.schema.safeParse(values);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

test("version 1 settings keep their Agent tools choice and have no notes folder", async () => {
  // As the daemon reads a stored document of an older version: migrate, then parse.
  const migrated = await officeHostSettings.migrate?.({ agentTools: false }, 1);
  expect(await officeHostSettings.schema.parseAsync(migrated)).toEqual({
    agentTools: false,
    notesFolder: "",
    notesTimeZone: "",
    ...INCIDENT_DEFAULTS,
  });
});

test("host settings: version 2 values stay and the incident fields take their defaults", async () => {
  const stored = { agentTools: false, notesFolder: "/n", notesTimeZone: "" };
  const migrated = await officeHostSettings.migrate?.(stored, 2);
  expect(officeHostSettings.version).toBe(3);
  expect(await officeHostSettings.schema.parseAsync(migrated)).toEqual({
    ...stored,
    ...INCIDENT_DEFAULTS,
  });
});

test("a Jira list with a bad key is refused", () => {
  expect(hostIssues({ jiraProjects: "FPOS, fpos" })).toEqual([
    'jiraProjects: "fpos" is not a Jira project key',
  ]);
  expect(hostIssues({ jiraProjects: "FPOS, QA_2" })).toEqual([]);
});

test("a Sentry list with a bad slug is refused", () => {
  expect(hostIssues({ sentryProjects: "web, Bad Slug" })).toEqual([
    'sentryProjects: "Bad Slug" is not a Sentry project slug',
  ]);
  expect(hostIssues({ sentryProjects: "web, api_2, back-end" })).toEqual([]);
});

test("a Sentry organisation that is not one slug is refused", () => {
  expect(hostIssues({ sentryOrg: "acme, other" })).toEqual([
    'sentryOrg: "acme, other" is not a Sentry organisation slug',
  ]);
  expect(hostIssues({ sentryOrg: "acme" })).toEqual([]);
});

test("the Sentry address must be https off loopback", () => {
  const refused = (address: string) => [
    `sentryUrl: "${address}" is not an https address (plain http only on this machine)`,
  ];
  expect(hostIssues({ sentryUrl: "http://sentry.example.com" })).toEqual(
    refused("http://sentry.example.com"),
  );
  expect(hostIssues({ sentryUrl: "sentry.example.com" })).toEqual(refused("sentry.example.com"));
  expect(hostIssues({ sentryUrl: "" })).toEqual(refused(""));
  expect(hostIssues({ sentryUrl: "ftp://127.0.0.1" })).toEqual(refused("ftp://127.0.0.1"));
  expect(hostIssues({ sentryUrl: "https://sentry.example.com" })).toEqual([]);
  expect(hostIssues({ sentryUrl: "http://127.0.0.1:9000" })).toEqual([]);
  expect(hostIssues({ sentryUrl: "http://127.1.2.3:9000" })).toEqual([]);
  expect(hostIssues({ sentryUrl: "http://localhost:9000" })).toEqual([]);
  expect(hostIssues({ sentryUrl: "http://[::1]:9000" })).toEqual([]);
});

test("parseKeys trims and drops empty entries", () => {
  expect(parseKeys(" FPOS , ,QA ", JIRA_KEY)).toEqual(["FPOS", "QA"]);
  expect(parseKeys("", SENTRY_SLUG)).toEqual([]);
});

test("device settings: version 1 values stay and rungIncidents is {}", async () => {
  const stored = { threeD: false, view: "2d" };
  const migrated = await officeDeviceSettings.migrate?.(stored, 1);
  expect(officeDeviceSettings.version).toBe(2);
  expect(await officeDeviceSettings.schema.parseAsync(migrated)).toEqual({
    ...stored,
    rungIncidents: {},
  });
});
