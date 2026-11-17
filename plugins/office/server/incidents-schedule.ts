import { isDeepStrictEqual } from "node:util";
import type { PluginServerContext, ScheduleCadence } from "@getpaseo/plugin/server";
import type { IncidentSource } from "../shared/contracts.js";
import { JIRA_KEY, parseKeys, SENTRY_SLUG } from "../shared/settings.js";
import { errorMessage } from "./errors.js";
import type { TrackerReader } from "./incidents-http.js";
import { createJiraReader, jiraEnv } from "./incidents-jira.js";
import { createSentryReader, sentryToken } from "./incidents-sentry.js";

/** The check's schedule's name among the office's schedules, and the handler that answers it. */
export const INCIDENTS_SCHEDULE = "incidents";
const INCIDENTS_LABEL = "Incidents";
const EVERY_MS = 300_000;

type Schedules = PluginServerContext["schedules"];

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
export function incidentsCadence(on: boolean): ScheduleCadence | null {
  return on ? { type: "every", everyMs: EVERY_MS } : null;
}

/**
 * Brings the daemon's schedule in step with `cadence`: saves it, or removes it for null. A
 * schedule that is already so is left alone, since a save counts the next run again from now.
 */
async function syncIncidentsSchedule(
  schedules: Schedules,
  cadence: ScheduleCadence | null,
): Promise<void> {
  if (cadence === null) {
    await schedules.remove(INCIDENTS_SCHEDULE);
    return;
  }
  // `list` leaves the label out; only this function saves the schedule, always with the label.
  const kept = (await schedules.list()).find((schedule) => schedule.name === INCIDENTS_SCHEDULE);
  if (kept?.handler === INCIDENTS_SCHEDULE && isDeepStrictEqual(kept.cadence, cadence)) return;
  await schedules.upsert({
    name: INCIDENTS_SCHEDULE,
    handler: INCIDENTS_SCHEDULE,
    prompt: INCIDENTS_LABEL,
    cadence,
  });
}

export interface IncidentsSchedulePorts {
  schedules: Schedules;
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
}

export function createIncidentsSchedule(ports: IncidentsSchedulePorts): IncidentsSchedule {
  let scheduleError: string | null = null;
  // One at a time, in order: a slow save must not land after a later one.
  let queue: Promise<void> = Promise.resolve();
  async function follow(on: boolean): Promise<void> {
    try {
      await syncIncidentsSchedule(ports.schedules, incidentsCadence(on));
      scheduleError = null;
    } catch (error) {
      scheduleError = errorMessage(error);
      ports.log(`[office] incidents schedule failed: ${scheduleError}`);
    }
  }
  return {
    sync(on) {
      queue = queue.then(() => follow(on));
      return queue;
    },
    error: () => scheduleError,
  };
}
