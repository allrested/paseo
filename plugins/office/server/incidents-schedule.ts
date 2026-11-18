import type { IncidentSource } from "../shared/contracts.js";
import { JIRA_KEY, parseKeys, SENTRY_SLUG } from "../shared/settings.js";
import type { TrackerReader } from "./incidents-http.js";
import { createJiraReader, jiraEnv } from "./incidents-jira.js";
import { createSentryReader, sentryToken } from "./incidents-sentry.js";
import type { OfficeCadence, OfficeSchedules } from "./local-schedules.js";
import { createScheduleFollower, type OfficeSchedule } from "./schedule-follower.js";

/** The check's schedule's name among the office's schedules, and the handler that answers it. */
export const INCIDENTS_SCHEDULE = "incidents";
const INCIDENTS: OfficeSchedule = {
  name: INCIDENTS_SCHEDULE,
  label: "Incidents",
  logName: "incidents",
};
const EVERY_MS = 300_000;

export interface IncidentsSettings {
  jiraProjects: string;
  sentryOrg: string;
  sentryProjects: string;
  sentryUrl: string;
}

/**
 * The trackers that are on: each needs its token variables in `env` and a project in the
 * settings, and Sentry an organisation too.
 */
export function incidentsReaders(
  values: IncidentsSettings,
  env: NodeJS.ProcessEnv,
): Partial<Record<IncidentSource, TrackerReader>> {
  const readers: Partial<Record<IncidentSource, TrackerReader>> = {};
  const jira = jiraEnv(env);
  const jiraProjects = parseKeys(values.jiraProjects, JIRA_KEY);
  if (jira !== null && jiraProjects.length > 0) {
    readers.jira = createJiraReader(jira, jiraProjects);
  }
  const token = sentryToken(env);
  const org = values.sentryOrg.trim();
  const sentryProjects = parseKeys(values.sentryProjects, SENTRY_SLUG);
  const sentryOn = token !== null && org !== "" && sentryProjects.length > 0;
  if (sentryOn) {
    readers.sentry = createSentryReader({
      url: values.sentryUrl,
      org,
      projects: sentryProjects,
      token,
    });
  }
  return readers;
}

/** When the trackers are checked: null while none is on. */
export function incidentsCadence(on: boolean): OfficeCadence | null {
  return on ? { type: "every", everyMs: EVERY_MS } : null;
}

export interface IncidentsSchedulePorts {
  schedules: OfficeSchedules;
  log(message: string): void;
}

export interface IncidentsSchedule {
  /**
   * Keeps the schedule while `on` and removes it otherwise. Never rejects: a failure is logged
   * and kept for `error`.
   */
  sync(on: boolean): Promise<void>;
  /** Why the schedule could not follow the settings; null once a later sync succeeds. */
  error(): string | null;
  /** Keeps a reason found outside a sync until a sync succeeds. */
  fail(message: string): void;
}

export function createIncidentsSchedule(ports: IncidentsSchedulePorts): IncidentsSchedule {
  const follower = createScheduleFollower({
    schedules: ports.schedules,
    schedule: INCIDENTS,
    log: ports.log,
  });
  return {
    sync: (on) => follower.sync(() => incidentsCadence(on)),
    error: follower.error,
    fail: follower.fail,
  };
}
