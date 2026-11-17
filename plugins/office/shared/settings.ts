import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** A Jira project key and a Sentry slug: only these reach a JQL query or a Sentry address. */
export const JIRA_KEY = /^[A-Z][A-Z0-9_]+$/;
export const SENTRY_SLUG = /^[a-z0-9][a-z0-9_-]*$/;

/** The hosts plain http is accepted on, as the URL parser writes them. */
const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;

function listEntries(text: string): string[] {
  return text
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * The entries of a comma separated list that match `pattern`, trimmed. A saved list has no
 * others: the settings refuse them.
 */
export function parseKeys(text: string, pattern: RegExp): string[] {
  return listEntries(text).filter((entry) => pattern.test(entry));
}

/** A token goes to this address, so it is https; plain http is accepted on this machine only. */
function isTokenSafe(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
  const local = url.protocol === "http:" && LOOPBACK.test(url.hostname);
  return url.protocol === "https:" || local;
}

const HostValuesSchema = z.object({
  agentTools: z.boolean().default(true),
  notesFolder: z.string().default(""),
  notesTimeZone: z.string().default(""),
  jiraProjects: z.string().default(""),
  sentryOrg: z.string().default(""),
  sentryProjects: z.string().default(""),
  sentryUrl: z.string().default("https://sentry.io"),
});
type HostValues = z.output<typeof HostValuesSchema>;

const LISTS = [
  { field: "jiraProjects", pattern: JIRA_KEY, what: "a Jira project key" },
  { field: "sentryProjects", pattern: SENTRY_SLUG, what: "a Sentry project slug" },
] as const;

function refuseBadTrackerValues(values: HostValues, context: z.RefinementCtx): void {
  for (const { field, pattern, what } of LISTS) {
    const bad = listEntries(values[field]).find((entry) => !pattern.test(entry));
    if (bad !== undefined) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${field}: "${bad}" is not ${what}`,
      });
    }
  }
  const org = values.sentryOrg.trim();
  if (org !== "" && !SENTRY_SLUG.test(org)) {
    context.addIssue({
      code: "custom",
      path: ["sentryOrg"],
      message: `sentryOrg: "${org}" is not a Sentry organisation slug`,
    });
  }
  if (!isTokenSafe(values.sentryUrl)) {
    context.addIssue({
      code: "custom",
      path: ["sentryUrl"],
      message: `sentryUrl: "${values.sentryUrl}" is not an https address (plain http only on this machine)`,
    });
  }
}

/**
 * Host-wide. `agentTools` off removes the office tools from agent sessions opened afterwards.
 * `notesFolder` is the absolute path the stand-up notes are written in, empty for none, and
 * `notesTimeZone` the IANA zone of their 8:00 run, empty for the host's. `jiraProjects` and
 * `sentryProjects` are the comma separated projects checked for incidents, `sentryOrg` their
 * Sentry organisation and `sentryUrl` the Sentry the token is sent to.
 */
export const officeHostSettings = defineSettings({
  id: "office",
  scope: "host",
  version: 3,
  schema: HostValuesSchema.superRefine(refuseBadTrackerValues),
  // Version 1 had only `agentTools` and version 2 no incident fields: what a document has stays,
  // and the rest take their defaults.
  migrate: (values) => values,
});

/** The office's views: the 3D floor, the 2D pixel floor and the list. */
export const OFFICE_VIEWS = ["3d", "2d", "list"] as const;
export type OfficeViewChoice = (typeof OFFICE_VIEWS)[number];

/**
 * Per device. `view` is the view somebody chose. A device that never chose has only `threeD`,
 * from when the office had a 3D switch: off is the list, on leaves the choice to the device. A
 * save writes both. A client from before version 2 reads neither: it refuses the newer version.
 * `rungIncidents` is when this device rang its alarm for each incident, epoch ms by incident id.
 */
export const officeDeviceSettings = defineSettings({
  id: "office-device",
  scope: "device",
  version: 2,
  schema: z.object({
    threeD: z.boolean().default(true),
    view: z.enum(OFFICE_VIEWS).optional(),
    rungIncidents: z.record(z.string(), z.number()).default({}),
  }),
  // Version 1 had no `rungIncidents`: its values stay, and the device has rung for none.
  migrate: (values) => values,
});
