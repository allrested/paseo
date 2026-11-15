// Row text for the Feed screen: sentence case, no trailing period.
import type { FeedEntry, FeedKind, RunningAgent } from "../shared/contracts.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const RECENT_DAYS = 30;

export const KIND_LABEL: Record<FeedKind, string> = {
  finished: "Finished",
  failed: "Failed",
  permission: "Waiting for you",
};

// As the Search chats screen writes it (plugins/chat-search/client/format.ts); a plugin's bundle
// holds its own folder only.
export function ago(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  if (ms < RECENT_DAYS * DAY) return `${Math.floor(ms / DAY)} d ago`;
  return `on ${iso.slice(0, 10)}`;
}

export function folderName(folder: string): string {
  return folder.split(/[\\/]/).findLast((part) => part !== "") ?? folder;
}

export function entryTitle(entry: Pick<FeedEntry, "title">): string {
  return entry.title ?? "Untitled agent";
}

/** What follows the kind on a row's second line. */
export function entryMeta(entry: Pick<FeedEntry, "folder" | "at">, now: number): string {
  return `${folderName(entry.folder)} · ${ago(entry.at, now)}`;
}

/** A row read aloud: what happened, to which agent, and what opening it does. */
export function entryLabel(entry: Pick<FeedEntry, "kind" | "title">): string {
  return `${KIND_LABEL[entry.kind]}: ${entryTitle(entry)}. Open the agent`;
}

/** The sidebar count, read aloud. */
export function countLabel(count: number): string {
  return count === 1 ? "1 unread entry" : `${count} unread entries`;
}

/** The words of a filter: every one has to be found. */
export function filterWords(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

function holds(text: string, words: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return words.every((word) => lower.includes(word));
}

/** An entry passes a filter by its agent, its folder, its line or what happened ("failed"). */
export function entryMatches(entry: FeedEntry, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  return holds(
    `${entryTitle(entry)} ${folderName(entry.folder)} ${entry.text ?? ""} ${KIND_LABEL[entry.kind]}`,
    words,
  );
}

/** A running agent passes a filter by its title, its folder or the word "running". */
export function agentMatches(
  agent: Pick<RunningAgent, "title" | "folder">,
  words: readonly string[],
): boolean {
  if (words.length === 0) return true;
  return holds(`${entryTitle(agent)} ${folderName(agent.folder)} ${RUNNING}`, words);
}

export const RUNNING = "Running";

/** A running agent's second line, after "Running": where it works and when its turn started. */
export function runningMeta(agent: Pick<RunningAgent, "folder" | "since">, now: number): string {
  const folder = folderName(agent.folder);
  return agent.since === null ? folder : `${folder} · started ${ago(agent.since, now)}`;
}

/** A running agent's row read aloud. */
export function runningLabel(agent: { title: string | null }): string {
  return `${RUNNING}: ${entryTitle(agent)}. Open the agent`;
}

/** The button that marks an entry unread, or read again, read aloud. */
export function markLabel(entry: Pick<FeedEntry, "title">, marked: boolean): string {
  return `${marked ? "Mark read" : "Mark unread"}: ${entryTitle(entry)}`;
}
