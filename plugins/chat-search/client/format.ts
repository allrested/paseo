// Row text for the Search chats screen: sentence case, no trailing period.
import { MAX_COUNTED, type Provider } from "../shared/contracts.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const RECENT_DAYS = 30;

export function ago(iso: string, now: number): string {
  const ms = now - Date.parse(iso);
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`;
  if (ms < RECENT_DAYS * DAY) return `${Math.floor(ms / DAY)} d ago`;
  return `on ${iso.slice(0, 10)}`;
}

export function folderName(folder: string | null): string | null {
  if (folder === null) return null;
  return folder.split("/").findLast((part) => part !== "") ?? folder;
}

export function countText(matches: number): string {
  if (matches >= MAX_COUNTED) return `${MAX_COUNTED} or more messages`;
  return matches === 1 ? "1 message" : `${matches} messages`;
}

const PROVIDERS: Record<Provider, string> = { claude: "Claude", kiro: "Kiro" };

interface MetaInput {
  provider: Provider;
  folder: string | null;
  changedAt: string;
  matches: number;
}

export function hitMeta(hit: MetaInput, now: number): string {
  return [
    PROVIDERS[hit.provider],
    folderName(hit.folder),
    ago(hit.changedAt, now),
    countText(hit.matches),
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

interface OverviewInput {
  chats: readonly unknown[];
  others: readonly unknown[];
  more: boolean;
}

export function overview(result: OverviewInput, words: string): string {
  const total = result.chats.length + result.others.length;
  if (total === 0) return `No chat says "${words}"`;
  if (result.more) return `The ${total} newest chats that match. Add a word to narrow the search`;
  return total === 1 ? "1 chat" : `${total} chats`;
}
