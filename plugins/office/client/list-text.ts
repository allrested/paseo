import type { OfficeAgent } from "../shared/contracts.js";
import {
  agentMeta,
  agentTask,
  agentTitle,
  attentionReason,
  type OfficeRoom,
  type OfficeRow,
} from "../shared/model.js";
import { contextPercent, NEARLY_FULL } from "./context-text.js";

export type ListTab = "all" | "attention" | "working" | "resting";

/** The bar's tabs in their order: All first, then what an agent needs, is at, and has left. */
export const LIST_TABS: readonly { tab: ListTab; label: string }[] = [
  { tab: "all", label: "All" },
  { tab: "attention", label: "Needs you" },
  { tab: "working", label: "Working" },
  { tab: "resting", label: "Resting" },
];

export const SEARCH_LABEL = "Search agents";
export const NO_MATCH = "No agent matches.";

/** Context levels for the List row: the bar warns from 60% and turns red from 85%. */
const WARNING_FROM = 60;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The tab a row belongs to. All holds every row; a row is in exactly one of the other three. */
export function tabOf(row: OfficeRow): Exclude<ListTab, "all"> {
  const { agent } = row;
  if (attentionReason(agent) !== null) return "attention";
  if (agent.status === "running" || agent.status === "initializing") return "working";
  if (agent.status === "idle" && row.waitingOn > 0) return "working";
  return "resting";
}

export function tabCounts(rows: readonly OfficeRow[]): Record<ListTab, number> {
  const counts: Record<ListTab, number> = {
    all: rows.length,
    attention: 0,
    working: 0,
    resting: 0,
  };
  for (const row of rows) counts[tabOf(row)] += 1;
  return counts;
}

/** Text without its case or its accents, for the search's comparisons. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Every word typed must be in one of the fields: the title, the task, the room, its project, the branch, the model. */
export function matchesQuery(row: OfficeRow, room: OfficeRoom, query: string): boolean {
  const words = fold(query)
    .split(/\s+/)
    .filter((word) => word !== "");
  if (words.length === 0) return true;
  const { agent } = row;
  const fields = [
    agentTitle(agent),
    agentTask(agent) ?? "",
    room.name,
    room.subtitle ?? "",
    room.workspace?.branch ?? "",
    agentMeta(agent),
  ];
  const hay = fold(fields.join(" "));
  return words.every((word) => hay.includes(word));
}

/** A sub-agent whose parent the filter dropped stands on its own. */
function atTop(row: OfficeRow, kept: ReadonlySet<string>): OfficeRow {
  if (row.depth === 0) return row;
  const parent = row.agent.parentAgentId;
  if (parent !== null && kept.has(parent)) return row;
  return { ...row, depth: 0 };
}

/**
 * The rooms the list shows under a tab and a search, each with only its matching rows. A room with
 * no matching agent is left out, unless All is chosen with no search: the empty rooms are the
 * office's own state then.
 */
export function filterRooms(
  rooms: readonly OfficeRoom[],
  tab: ListTab,
  query: string,
): OfficeRoom[] {
  const keepsEmpty = tab === "all" && query.trim() === "";
  const shown: OfficeRoom[] = [];
  for (const room of rooms) {
    const matching = room.rows.filter(
      (row) => (tab === "all" || tabOf(row) === tab) && matchesQuery(row, room, query),
    );
    if (matching.length === 0 && !keepsEmpty) continue;
    const kept = new Set(matching.map((row) => row.agent.id));
    const rows: OfficeRow[] = [];
    for (const row of matching) rows.push(atTop(row, kept));
    shown.push({ ...room, rows });
  }
  return shown;
}

/** Under an agent's name: `provider · model`, then the branch when the room has one. */
export function secondLine(agent: OfficeAgent, room: OfficeRoom): string {
  const branch = room.workspace?.branch;
  return branch ? `${agentMeta(agent)} · ${branch}` : agentMeta(agent);
}

/** The context bar's level: quiet below 60%, a warning from there, a danger from 85%. */
export function contextLevel(percent: number): "low" | "mid" | "high" {
  if (percent < WARNING_FROM) return "low";
  return percent < NEARLY_FULL ? "mid" : "high";
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** The clock of a turn: `m:ss`, and `h:mm:ss` from the hour. */
function clockText(promptedAt: string | undefined, now: number): string | null {
  const start = promptedAt === undefined ? Number.NaN : Date.parse(promptedAt);
  if (!Number.isFinite(start)) return null;
  // A host clock ahead of this device's is not a negative clock.
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  if (seconds < 3600) return `${Math.floor(seconds / 60)}:${pad2(seconds % 60)}`;
  return `${Math.floor(seconds / 3600)}:${pad2(Math.floor((seconds % 3600) / 60))}:${pad2(seconds % 60)}`;
}

/** How long ago a resting agent's last change was: "now", "5m ago", "2h ago", "3d ago". */
function agoText(idleSince: string | undefined, now: number): string | null {
  const since = idleSince === undefined ? Number.NaN : Date.parse(idleSince);
  if (!Number.isFinite(since)) return null;
  const ms = Math.max(0, now - since);
  if (ms < MINUTE) return "now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`;
  return `${Math.floor(ms / DAY)}d ago`;
}

/**
 * The row's time: the turn's clock while it runs, how long it has rested while it is idle. An
 * agent that needs you, is starting or has stopped on an error shows none.
 */
export function timeText(row: OfficeRow, now: number): string | null {
  const { agent } = row;
  if (attentionReason(agent) !== null) return null;
  if (agent.status === "running") return clockText(agent.promptedAt, now);
  if (agent.status === "idle") return agoText(agent.idleSince, now);
  return null;
}

/** What an agent's turns have cost, two decimals; nothing when its provider gives none or zero. */
export function costText(costUsd: number | undefined): string | null {
  if (costUsd === undefined || !Number.isFinite(costUsd) || costUsd <= 0) return null;
  return `$${costUsd.toFixed(2)}`;
}

/** A row in one sentence, for a screen reader: "Ali: Running, context 62%, 4:12, $0.42". */
export function rowLabel(row: OfficeRow, stateWord: string, now: number): string {
  const parts = [`${agentTitle(row.agent)}: ${stateWord}`];
  const percent = contextPercent(row.agent);
  if (percent !== null) parts.push(`context ${percent}%`);
  const time = timeText(row, now);
  if (time !== null) parts.push(time);
  const cost = costText(row.agent.costUsd);
  if (cost !== null) parts.push(cost);
  return parts.join(", ");
}
