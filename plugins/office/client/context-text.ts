import type { JanitorAction, OfficeAgent } from "../shared/contracts.js";
import type { HostNote, HostTone } from "../shared/machine-text.js";
import { agentTitle, waitingOnText } from "../shared/model.js";

/** From this share of its window a context is nearly full: the desk's red flag in both offices. */
export const NEARLY_FULL = 85;
const FULL = 95;

/** How full an agent's context is, as a whole percent; null when its provider has not said. */
export function contextPercent(agent: Pick<OfficeAgent, "context">): number | null {
  const { context } = agent;
  if (context === undefined) return null;
  return Math.min(100, Math.round((context.usedTokens / context.maxTokens) * 100));
}

export function contextTone(percent: number | null): HostTone {
  if (percent === null || percent < NEARLY_FULL) return "muted";
  return percent >= FULL ? "danger" : "warning";
}

export function formatTokens(tokens: number): string {
  const short = (value: number, unit: string) =>
    `${value < 10 ? String(Math.round(value * 10) / 10) : String(Math.round(value))}${unit}`;
  if (tokens >= 1_000_000) return short(tokens / 1_000_000, "M");
  return tokens >= 1000 ? short(tokens / 1000, "k") : String(Math.round(tokens));
}

/** The tokens a context holds of its window; who reports none is named. */
function contextDetail(agent: Pick<OfficeAgent, "context" | "provider">): string {
  const { context } = agent;
  if (context === undefined) return `${agent.provider} does not report its context`;
  return `${formatTokens(context.usedTokens)} of ${formatTokens(context.maxTokens)} tokens`;
}

/** An agent's context in one line for its card; null when its provider has not said. */
export function contextLine(agent: Pick<OfficeAgent, "context" | "provider">): string | null {
  const percent = contextPercent(agent);
  return percent === null ? null : `Context ${percent}% full, ${contextDetail(agent)}`;
}

export interface JanitorRow {
  agentId: string;
  title: string;
  percent: number | null;
  /** "164k of 200k tokens", or who does not report. */
  detail: string;
  /** What the agent is at, in a word or two. */
  state: string;
  /** Whether its conversation can be tidied now: an agent at work is left alone. */
  tidy: boolean;
}

function stateOf(agent: OfficeAgent, waitingOn: number): string {
  if (agent.permissions.length > 0) return "Waiting for your answer";
  if (agent.status === "error") return "Stopped on an error";
  if (agent.status === "running") return "At work";
  if (waitingOn > 0) return waitingOnText(waitingOn);
  return agent.status === "initializing" ? "Starting" : "Idle";
}

const NOBODY_WAITS: ReadonlyMap<string, number> = new Map();

/**
 * Every agent of the office, the fullest context first; who reports none comes last, by name.
 * `waitingOn` is the model's: an agent that waits on sub-agents is left alone, as one at work.
 */
export function janitorRows(
  agents: Iterable<OfficeAgent>,
  waitingOn: ReadonlyMap<string, number> = NOBODY_WAITS,
): JanitorRow[] {
  const rows = [...agents].map((agent): JanitorRow => {
    const waits = agent.permissions.length > 0;
    const busy = waitingOn.get(agent.id) ?? 0;
    return {
      agentId: agent.id,
      title: agentTitle(agent),
      percent: contextPercent(agent),
      detail: contextDetail(agent),
      state: stateOf(agent, busy),
      tidy: !waits && busy === 0 && (agent.status === "idle" || agent.status === "error"),
    };
  });
  return rows.sort(
    (left, right) =>
      (right.percent ?? -1) - (left.percent ?? -1) || left.title.localeCompare(right.title),
  );
}

/** The janitor in a few words, for the strip; null in an office without agents. */
export function janitorNote(rows: readonly JanitorRow[]): HostNote | null {
  if (rows.length === 0) return null;
  const known = rows.flatMap((row) => (row.percent === null ? [] : [row.percent]));
  const fullest = Math.max(-1, ...known);
  if (fullest < 0) return { text: "No context reported", tone: "muted" };
  const near = known.filter((percent) => percent >= NEARLY_FULL).length;
  if (near === 0) return { text: `Fullest context ${fullest}%`, tone: "muted" };
  return {
    text: near === 1 ? "1 context nearly full" : `${near} contexts nearly full`,
    tone: contextTone(fullest),
  };
}

/** A row as one sentence, for a screen reader. */
export function janitorRowLabel(row: JanitorRow): string {
  const share = row.percent === null ? "" : `${row.percent}% full, `;
  return `${row.title}: ${share}${row.detail}. ${row.state}`;
}

const TIDY_NAMES: Readonly<Record<JanitorAction, string>> = {
  clean: "clean the context",
  reset: "reset the session",
};

/** What to say under the button when the host left the conversation as it is. */
export function tidyFailure(action: JanitorAction, error: string | null): string {
  return `Unable to ${TIDY_NAMES[action]}: ${error ?? "no reason given"}`;
}

/**
 * The rows in the order they were shown before, the new ones after them. A card that is open
 * keeps its order, so a row whose context empties does not move another row's buttons under a
 * finger.
 */
export function inShownOrder(shown: readonly string[], rows: readonly JanitorRow[]): JanitorRow[] {
  const place = new Map(shown.map((agentId, index) => [agentId, index]));
  return rows
    .map((row, index) => ({ row, at: place.get(row.agentId) ?? shown.length + index }))
    .sort((left, right) => left.at - right.at)
    .map(({ row }) => row);
}
