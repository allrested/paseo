// What the panel shows, worked out from the host's answers.
import type { Author, FileLines, Mark, TrackedFile, Turn } from "../shared/contracts.js";

export type ReadyFile = Extract<FileLines, { status: "ready" }>;

/** An agent of the open file, numbered for the legend and the gutter. */
export interface LegendAgent {
  id: string;
  /** Its name when its lines were recorded. */
  title: string | null;
  provider: string;
  /** Counted from 1: what tells agents apart, with their names. */
  number: number;
  /** The file's lines this agent wrote, alone or with others. */
  lines: number;
}

export interface Legend {
  /** The agent with the most lines first. */
  agents: LegendAgent[];
  /** Lines at least one agent wrote. */
  byAgents: number;
  total: number;
}

/** One line of the file, as the list draws it. */
export interface LineRow {
  /** Counted from 1. */
  number: number;
  text: string;
  /** The turn that wrote the line, or -1 for a line no agent wrote. */
  turn: number;
  /** The agents' numbers, on the first line of a run only: "2", "1+2". */
  label: string;
  /** The line is the chosen agent's. */
  chosen: boolean;
}

/** A name for an agent: its title, or a short id while it has none. */
export function agentName(agent: Pick<Author, "id" | "title">): string {
  return agent.title?.trim() || `Agent ${agent.id.slice(0, 8)}`;
}

export function legendOf(file: ReadyFile): Legend {
  const counts = new Map<string, LegendAgent>();
  let byAgents = 0;
  for (const mark of file.marks) {
    byAgents += mark.count;
    for (const agent of file.turns[mark.turn]?.agents ?? []) {
      const known = counts.get(agent.id) ?? { ...agent, number: 0, lines: 0 };
      known.lines += mark.count;
      counts.set(agent.id, known);
    }
  }
  const agents = Array.from(counts.values()).sort(
    (one, other) => other.lines - one.lines || agentName(one).localeCompare(agentName(other)),
  );
  agents.forEach((agent, at) => {
    agent.number = at + 1;
  });
  return { agents, byAgents, total: file.lines.length };
}

function labelOf(turn: Turn | undefined, legend: Legend): string {
  const numbers = (turn?.agents ?? []).flatMap((agent) => {
    const known = legend.agents.find((each) => each.id === agent.id);
    return known ? [known.number] : [];
  });
  return numbers.sort((one, other) => one - other).join("+");
}

/** The file's lines with who wrote each. `chosenId` is the agent picked in the legend. */
export function rowsOf(file: ReadyFile, legend: Legend, chosenId: string | null): LineRow[] {
  const rows: LineRow[] = file.lines.map((text, at) => ({
    number: at + 1,
    text,
    turn: -1,
    label: "",
    chosen: false,
  }));
  for (const mark of file.marks) {
    const turn = file.turns[mark.turn];
    const chosen =
      chosenId !== null && (turn?.agents.some((agent) => agent.id === chosenId) ?? false);
    for (let line = mark.start; line < mark.start + mark.count; line += 1) {
      const row = rows[line - 1];
      if (!row) continue;
      row.turn = mark.turn;
      row.chosen = chosen;
      if (line === mark.start) row.label = labelOf(turn, legend);
    }
  }
  return rows;
}

/** The run of lines around `line` that one turn wrote. */
export function markAt(marks: readonly Mark[], line: number): Mark | null {
  return marks.find((mark) => line >= mark.start && line < mark.start + mark.count) ?? null;
}

export function linesLabel(count: number): string {
  return count === 1 ? "1 line" : `${count.toLocaleString("en-US")} lines`;
}

export function filesLabel(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

/** "Agents wrote 42 of 480 lines". */
export function summaryLabel(legend: Legend): string {
  if (legend.byAgents === 0) return "No line here is an agent's any more";
  return `Agents wrote ${legend.byAgents.toLocaleString("en-US")} of ${linesLabel(legend.total)}`;
}

/** "Lines 12 to 18", or "Line 12". */
export function rangeLabel(mark: Mark): string {
  return mark.count === 1
    ? `Line ${mark.start}`
    : `Lines ${mark.start} to ${mark.start + mark.count - 1}`;
}

/** A path's last part, and the folders before it ("" at the top). */
export function splitPath(path: string): { name: string; folder: string } {
  const cut = path.lastIndexOf("/");
  return cut === -1
    ? { name: path, folder: "" }
    : { name: path.slice(cut + 1), folder: path.slice(0, cut) };
}

/** The agents of a file's row: the latest, and how many more. */
export function agentsLabel(file: Pick<TrackedFile, "agents">): string {
  const [first, ...rest] = file.agents;
  if (!first) return "";
  return rest.length === 0 ? agentName(first) : `${agentName(first)} +${rest.length}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long ago, in the words of a list: "just now", "5 min ago", "3 h ago", "2 d ago", a date. */
export function agoLabel(at: number, now: number): string {
  const passed = Math.max(0, now - at);
  if (passed < MINUTE) return "just now";
  if (passed < HOUR) return `${Math.floor(passed / MINUTE)} min ago`;
  if (passed < DAY) return `${Math.floor(passed / HOUR)} h ago`;
  if (passed < 7 * DAY) return `${Math.floor(passed / DAY)} d ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** The day and the minute of a turn. */
export function whenLabel(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Why a file has no lines to show. */
export function statusLabel(status: Exclude<FileLines["status"], "ready">): string {
  if (status === "untracked") return "No agent has changed this file.";
  if (status === "missing") return "This file is gone.";
  if (status === "binary") return "This file is not text.";
  return "This file is over 1 MB, so its lines are not tracked.";
}
