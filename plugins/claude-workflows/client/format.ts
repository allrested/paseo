import type {
  AgentState,
  LastTool,
  LoadedRun,
  RunAgent,
  RunView,
  UnavailableReason,
} from "../shared/run.js";

/** How often a Running card asks for its run again. */
export const POLL_MS = 3000;

export const LOADING = "Loading...";
export const LOAD_FAILED = "Unable to load the run";
export const REFRESH_FAILED = "Refresh failed";
export const UNREADABLE_AGENT = "Unable to read this agent's file";
export const NO_AGENTS = "No agents have started yet";

export const RUN_STATE_LABELS: Record<RunView["state"], string> = {
  running: "Running",
  completed: "Completed",
  killed: "Killed",
  stopped: "Stopped",
  unavailable: "Unavailable",
};

export const AGENT_STATE_LABELS: Record<AgentState, string> = {
  running: "Running",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
  unreadable: "Unreadable",
};

export const UNAVAILABLE_COPY: Record<UnavailableReason, string> = {
  "agent-not-found": "Agent not found",
  "not-claude": "No Claude session for this agent",
  "run-not-found": "Run files not found",
  "run-unreadable": "Unable to read the run files",
};

/** The query's refetch interval: poll only while the last view is Running. */
export function pollInterval(view: RunView | undefined): number | false {
  return view?.state === "running" ? POLL_MS : false;
}

export function loadedRun(view: RunView | undefined): LoadedRun | null {
  if (view === undefined || view.state === "unavailable") return null;
  return view;
}

/**
 * Whether the card shows its agents: the user's last choice, else open while the run is
 * Running. A card without a loaded run has no body.
 */
export function isCardOpen(run: LoadedRun | null, chosen: boolean | null): boolean {
  if (run === null) return false;
  return chosen ?? run.state === "running";
}

// Copied from plugins/shared-mcp/client/format.ts (formatUptime); a built-in cannot import
// another plugin's files.
/** The two largest units of a duration: "45s", "3m 12s", "2h 5m", "3d 4h". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/** A token count: "950", "41.2k", "152k", "2.3M". */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  // The bounds sit where rounding would print "100.0k" or "1000k".
  if (tokens < 99_950) return `${(tokens / 1000).toFixed(1)}k`;
  if (tokens < 999_500) return `${Math.round(tokens / 1000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/** How long before `now` the time `at` was: "5s ago", "2m ago", "2h ago", "2d ago". */
export function formatAgo(at: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function known(values: (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null);
}

/**
 * The header's totals: "3 agents · 1 done · 1 failed · 14 tool calls · 52.1k tokens · 2m 10s".
 * Tokens show once an agent reports usage, and elapsed time once an agent has written.
 */
export function describeTotals(run: LoadedRun, now: number): string {
  const { agents } = run;
  const done = agents.filter((agent) => agent.state === "done").length;
  const failed = agents.filter((agent) => agent.state === "failed").length;
  const toolCalls = sum(agents.map((agent) => agent.toolCalls));
  const parts = [
    count(agents.length, "agent"),
    `${done} done`,
    `${failed} failed`,
    count(toolCalls, "tool call"),
  ];
  const tokens = known(agents.map((agent) => agent.tokens));
  if (tokens.length > 0) parts.push(`${formatTokens(sum(tokens))} tokens`);
  const elapsed = elapsedMs(run, now);
  if (elapsed !== null) parts.push(formatDuration(elapsed));
  return parts.join(" · ");
}

/** From the earliest first activity to now while Running, else to the run's end. */
function elapsedMs(run: LoadedRun, now: number): number | null {
  const starts = known(run.agents.map((agent) => agent.firstActivityAt));
  const end = endTime(run, now);
  if (starts.length === 0 || end === null) return null;
  return end - Math.min(...starts);
}

/** The record's end time, else the latest activity; null when no agent has written. */
function endTime(run: LoadedRun, now: number): number | null {
  if (run.state === "running") return now;
  if (run.endedAt !== null) return run.endedAt;
  const ends = known(run.agents.map((agent) => agent.lastActivityAt));
  return ends.length === 0 ? null : Math.max(...ends);
}

function describeTool(tool: LastTool): string {
  const named = tool.file === null ? tool.name : `${tool.name} ${tool.file}`;
  return tool.running ? `${named} (running)` : named;
}

/** One agent row's details: "3 tool calls · Read src/a.ts (running) · 41.2k tokens · 2m ago". */
export function describeAgent(agent: RunAgent, now: number): string {
  if (agent.state === "unreadable") return UNREADABLE_AGENT;
  const parts = [count(agent.toolCalls, "tool call")];
  if (agent.lastTool !== null) parts.push(describeTool(agent.lastTool));
  if (agent.tokens !== null) parts.push(`${formatTokens(agent.tokens)} tokens`);
  if (agent.lastActivityAt !== null) parts.push(formatAgo(agent.lastActivityAt, now));
  return parts.join(" · ");
}

export interface PhaseGroup {
  phase: string;
  agents: RunAgent[];
}

/** The agents grouped by phase, phases in the order their first agent started. */
export function groupByPhase(agents: RunAgent[]): PhaseGroup[] {
  const groups = new Map<string, RunAgent[]>();
  for (const agent of agents) {
    const group = groups.get(agent.phase) ?? [];
    group.push(agent);
    groups.set(agent.phase, group);
  }
  return Array.from(groups, ([phase, members]) => ({ phase, agents: members }));
}

export interface StatusInput {
  view: RunView | undefined;
  /** The last fetch failed. */
  failed: boolean;
  /** When the view was fetched. */
  now: number;
}

/** The header's status line: the load state, the reason a run is unavailable, or its totals. */
export function statusLine(input: StatusInput): string {
  const { view, failed, now } = input;
  if (view === undefined) return failed ? LOAD_FAILED : LOADING;
  if (view.state === "unavailable") return UNAVAILABLE_COPY[view.reason];
  return describeTotals(view, now);
}

/**
 * The note after the status line when the last fetch failed but the card still shows an earlier
 * view. A failed first load has no view to keep and shows `LOAD_FAILED` in the status line instead.
 */
export function refreshNote(view: RunView | undefined, failed: boolean): string | null {
  return failed && view !== undefined ? REFRESH_FAILED : null;
}

/** The card's title: the launch result's summary, else the run record's workflow name. */
export function summaryText(summary: string | null, view: RunView | undefined): string | null {
  return summary ?? loadedRun(view)?.name ?? null;
}
