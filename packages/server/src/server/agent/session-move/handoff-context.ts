import { buildAgentForkContextAttachment, curateForkContextEntries } from "../activity-curator.js";
import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
import type {
  MoveChain,
  MoveHistory,
  MoveHistorySegment,
  PendingMoveContext,
} from "./pending-context.js";

/** The prompt a move sends when it continues the work right away. */
export const MOVE_CONTINUE_PROMPT = "Continue where the previous agent stopped.";

/**
 * Cap on the rendered entries a move chain keeps, summed over its segments with their `[Agent]`
 * lines. It stays under the fork builder's 100k budget minus its header (two metadata fields of
 * up to 1k each), so the builder never trims a move history and cuts a segment off its label.
 */
export const MOVE_HISTORY_MAX_CHARS = 96_000;

// The closing tag may be missing when the timeline item cap cut the message short.
const HISTORY_BLOCK =
  /<paseo-move-history>[\s\S]*?(?:<\/paseo-move-history>|$)|<chat-history-summary>[\s\S]*?(?:<\/chat-history-summary>|$)/g;

/**
 * Removes move and fork histories from a user message. A Claude transcript keeps the history
 * block a move prepended, so a timeline rebuilt from disk shows it in the user message; the live
 * timeline never does. Stripping both makes the two curate the same.
 */
function stripHistoryBlocks(text: string): string {
  return text.replace(HISTORY_BLOCK, "").trim();
}

/** The rows after `since`, with histories stripped from user messages and empty ones dropped. */
function ownRows(rows: readonly AgentTimelineRow[], since: number): AgentTimelineRow[] {
  const own: AgentTimelineRow[] = [];
  for (const row of rows) {
    if (row.seq <= since) continue;
    if (row.item.type !== "user_message") {
      own.push(row);
      continue;
    }
    const text = stripHistoryBlocks(row.item.text);
    if (text) own.push({ ...row, item: { ...row.item, text } });
  }
  return own;
}

function originalTask(rows: readonly AgentTimelineRow[]): string | null {
  for (const row of rows) {
    if (row.item.type !== "user_message") continue;
    const text = row.item.text.trim();
    if (text && text !== MOVE_CONTINUE_PROMPT) return text;
  }
  return null;
}

function touchedFiles(rows: readonly AgentTimelineRow[]): string[] {
  const files = new Set<string>();
  for (const row of rows) {
    if (row.item.type !== "tool_call") continue;
    const detail = row.item.detail;
    if (detail.type === "edit" || detail.type === "write") files.add(detail.filePath);
  }
  return [...files];
}

/** Open items of the latest todo row; null when there is no todo row. */
function latestTodos(rows: readonly AgentTimelineRow[]): string[] | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const item = rows[index]!.item;
    if (item.type === "todo")
      return item.items.filter((todo) => !todo.completed).map((todo) => todo.text);
  }
  return null;
}

function lastError(rows: readonly AgentTimelineRow[]): string | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const item = rows[index]!.item;
    if (item.type === "error") return item.message;
  }
  return null;
}

function agentLine(label: string): string {
  return `[Agent] ${label}`;
}

/**
 * Drops entries, oldest segment first, until the chain fits the cap. Segments always stay. A
 * segment's `[Agent]` line counts while it has entries, since only then is it rendered.
 */
function trimSegments(segments: readonly MoveHistorySegment[]): MoveHistorySegment[] {
  let total = 0;
  for (const segment of segments) {
    if (segment.entries.length > 0) total += agentLine(segment.label).length + 1;
    for (const entry of segment.entries) total += entry.length + 1;
  }
  return segments.map((segment) => {
    let drop = 0;
    while (total > MOVE_HISTORY_MAX_CHARS && drop < segment.entries.length) {
      total -= segment.entries[drop]!.length + 1;
      drop += 1;
      if (drop === segment.entries.length) total -= agentLine(segment.label).length + 1;
    }
    return drop === 0 ? segment : { ...segment, entries: segment.entries.slice(drop) };
  });
}

/**
 * The chain as it stands when `agentId` gives up the session: the inherited segments plus one
 * for its own rows, which are the ones after the inherited `sinceSeq`.
 */
export function extendMoveHistory(input: {
  history: MoveHistory | null;
  agentId: string;
  label: string;
  rows: readonly AgentTimelineRow[];
}): MoveChain {
  const own = ownRows(input.rows, input.history?.sinceSeq ?? 0);
  const segment: MoveHistorySegment = {
    agentId: input.agentId,
    label: input.label,
    entries: curateForkContextEntries(own),
    files: touchedFiles(own),
    openTodos: latestTodos(own),
    lastError: lastError(own),
  };
  return {
    originalTask: input.history?.originalTask ?? originalTask(own),
    segments: trimSegments([...(input.history?.segments ?? []), segment]),
  };
}

function renderHeader(input: {
  fromLabel: string;
  cwd: string;
  originalTask: string | null;
  segments: readonly MoveHistorySegment[];
}): string {
  const lines = [
    `Moved from ${input.fromLabel}. You are continuing another agent's work in ${input.cwd}.`,
  ];
  if (input.originalTask) lines.push(`Original task: ${input.originalTask}`);
  const files = [...new Set(input.segments.flatMap((segment) => segment.files))];
  if (files.length > 0) lines.push("Files changed so far:", ...files.map((file) => `- ${file}`));
  const todos = input.segments.findLast((segment) => segment.openTodos !== null)?.openTodos ?? [];
  if (todos.length > 0) lines.push("Open todos:", ...todos.map((todo) => `- [ ] ${todo}`));
  const error = input.segments.findLast((segment) => segment.lastError !== null)?.lastError;
  if (error) lines.push(`Last error: ${error}`);
  return lines.join("\n");
}

/**
 * The history a handoff sends: the segments after the last one of `afterAgentId` (all of them
 * when it is undefined or not in the chain), under a header of their facts.
 */
export function renderMoveHistory(input: {
  chain: MoveChain;
  fromLabel: string;
  agentTitle: string | null;
  cwd: string;
  afterAgentId?: string;
}): PendingMoveContext {
  const { segments: all } = input.chain;
  const afterIndex =
    input.afterAgentId === undefined
      ? -1
      : all.findLastIndex((segment) => segment.agentId === input.afterAgentId);
  const segments = all.slice(afterIndex + 1);
  const { attachment } = buildAgentForkContextAttachment({
    rows: [],
    priorEntries: segments.flatMap((segment) =>
      segment.entries.length > 0 ? [agentLine(segment.label), ...segment.entries] : [],
    ),
    agentTitle: input.agentTitle,
    cwd: input.cwd,
  });
  const header = renderHeader({
    fromLabel: input.fromLabel,
    cwd: input.cwd,
    originalTask: input.chain.originalTask,
    segments,
  });
  return {
    text: `<paseo-move-history>\n${header}\n\n${attachment.text}\n</paseo-move-history>`,
    title: attachment.title ?? "Chat history",
  };
}
