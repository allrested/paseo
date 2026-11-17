import type { Incident, IncidentSource, IncidentsState } from "../shared/contracts.js";
import type { StripCard } from "./attention-strip.js";

const SOURCE_LABEL = { jira: "Jira", sentry: "Sentry" } as const satisfies Record<
  IncidentSource,
  string
>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** An open incident as the card lists it. */
export interface IncidentRow {
  id: string;
  sourceLabel: (typeof SOURCE_LABEL)[IncidentSource];
  key: string;
  title: string;
  url: string;
  /** How long ago the office found it: "just now", "12 min ago", "3 h ago". */
  age: string;
}

/**
 * The strip's Incidents card, while an incident is open or a tracker's check failed: a failing
 * check shows nowhere else. Its count is the open incidents.
 */
export function incidentsEntry(
  state: IncidentsState | undefined,
  onOpen: () => void,
): StripCard | null {
  if (state === undefined) return null;
  const failed = state.problems.jira !== undefined || state.problems.sentry !== undefined;
  if (state.open.length === 0 && !failed) return null;
  const count = `${state.open.length} open`;
  const text = failed ? `${count} · a check failed` : count;
  return { title: "Incidents", note: { text, tone: "danger" }, onOpen };
}

function byNewest(a: Incident, b: Incident): number {
  if (a.foundAt !== b.foundAt) return b.foundAt - a.foundAt;
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return a.key.localeCompare(b.key);
}

/**
 * The open incidents, the last found first; found at the same moment, the last created first,
 * then in key order. A sorted copy. The card and the 3D banner both list them so.
 */
export function newestFirst(open: readonly Incident[]): Incident[] {
  return [...open].sort(byNewest);
}

function ageText(ms: number): string {
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  return `${Math.floor(ms / HOUR)} h ago`;
}

/** The card's rows, newest first. `now` is when the card opened. */
export function incidentRows(state: IncidentsState | undefined, now: number): IncidentRow[] {
  if (state === undefined) return [];
  return newestFirst(state.open).map((incident) => ({
    id: incident.id,
    sourceLabel: SOURCE_LABEL[incident.source],
    key: incident.key,
    title: incident.title,
    url: incident.url,
    // A host clock a little ahead of this device's is not a negative age.
    age: ageText(Math.max(0, now - incident.foundAt)),
  }));
}

/** Why each tracker's last check failed, a line each: "Jira: <problem>". */
export function incidentProblems(state: IncidentsState | undefined): string[] {
  if (state === undefined) return [];
  const { jira, sentry } = state.problems;
  const lines: string[] = [];
  if (jira !== undefined) lines.push(`${SOURCE_LABEL.jira}: ${jira}`);
  if (sentry !== undefined) lines.push(`${SOURCE_LABEL.sentry}: ${sentry}`);
  return lines;
}
