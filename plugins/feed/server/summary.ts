// What a row says about a turn: one line of the agent's last message.
import { TEXT_MAX } from "../shared/contracts.js";

/** The fields read from a timeline entry; every one the daemon returns satisfies it. */
export interface TimelineEntry {
  turnId?: string;
  item: { type: string; text?: unknown };
}

/**
 * The agent's last message of a turn, from the newest entries of its timeline (oldest first).
 * Null when the turn has none in them, and for a turn without an id: its entries cannot be told
 * from another turn's. A provider may write one message as several items in a row, so the run
 * is joined, as the notification for a finished turn does
 * (findLatestAssistantMessageFromTimeline in packages/protocol).
 */
export function lastMessage(
  entries: readonly TimelineEntry[],
  turnId: string | null,
): string | null {
  if (turnId === null) return null;
  const chunks: string[] = [];
  for (const { item, turnId: of } of entries.toReversed()) {
    const said =
      of === turnId && item.type === "assistant_message" && typeof item.text === "string";
    if (said) chunks.push(item.text as string);
    else if (chunks.length > 0) break;
  }
  return chunks.length === 0 ? null : chunks.toReversed().join("");
}

const FENCE = /^\s*(```|~~~)/;
const RULE = /^\s*([-*_]\s*){3,}$/;

// A line as plain words: no heading, quote or list mark in front, no link target, no emphasis.
function plain(line: string): string {
  if (FENCE.test(line) || RULE.test(line)) return "";
  return line
    .replace(/^\s{0,3}(#{1,6}|>+|[*+-]|\d+\.)\s+/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cut(line: string): string {
  return line.length > TEXT_MAX ? `${line.slice(0, TEXT_MAX - 1).trimEnd()}…` : line;
}

/**
 * The first line of an agent's message that has words on it, cut to a row's length; null when
 * none has. A message is Markdown, so its marks are dropped.
 */
export function oneLine(text: string): string | null {
  for (const raw of text.split("\n")) {
    const line = plain(raw);
    if (line !== "") return cut(line);
  }
  return null;
}

/**
 * The same for a text that is not Markdown, a tool's name or an error: its marks are kept, since
 * the underscores of mcp__paseo__office_read are no emphasis.
 */
export function firstLine(text: string): string | null {
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line !== "") return cut(line);
  }
  return null;
}
