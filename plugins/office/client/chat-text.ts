import { CHAT_TEXT_MAX, type ChatMessage } from "../shared/contracts.js";
import { agentTitle, type OfficeModel } from "../shared/model.js";
import { REACTIONS } from "../shared/upstream/chat-engine.js";
import chat from "../shared/upstream/chat.js";
import { matchesQuery } from "./list-text.js";
import { SHIRTS, lookOf } from "./pixel/art.js";

export const CHAT_EMPTY = "No messages yet. @ an agent to give it work.";
export const CHAT_RECALLED = "Message recalled";
/** The counter under the box shows from this many characters. */
export const COUNTER_FROM = 500;
/** An answer longer than this many lines is clipped with Show more. */
export const SHOW_MORE_LINES = 8;
/** Upstream's eight stickers, in English. */
export const STICKERS: readonly string[] = chat.stickers;
/** Upstream's six reactions, in its order. */
export const REACTION_CHOICES: readonly string[] = REACTIONS;
/** The director's shirt in upstream's scene (people/director.js). */
export const DIRECTOR_COLOR = "#2B3A55";

const ME = "me";
const DIRECTOR = "__director";
const SHOWN_KINDS: ReadonlySet<string> = new Set(["text", "sticker", "poll", "remind", "sys"]);
/** The server refuses a recall after this long. */
const RECALL_MS = 2 * 60_000;
/** The characters a clipped line holds, for an answer without line breaks. */
const LINE_CHARS = 60;
const MENTION_QUERY_MAX = 40;
const MENTION_OPTIONS_MAX = 8;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Photos, work cards, loops, CI and denied calls never show. */
export function shows(message: ChatMessage): boolean {
  return SHOWN_KINDS.has(message.kind);
}

export function isYours(message: ChatMessage): boolean {
  return message.from === ME;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function clockText(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dateText(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${clockText(date)}`;
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/** In local time: "09:05" today, "Yesterday 09:05", else "12 Nov 09:05". */
export function timeLabel(at: number, now: number): string {
  const date = new Date(at);
  const today = new Date(now);
  if (sameDay(date, today)) return clockText(date);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (sameDay(date, yesterday)) return `Yesterday ${clockText(date)}`;
  return dateText(date);
}

export function typingText(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return "Several people are typing…";
}

export function counterText(length: number): string | null {
  return length >= COUNTER_FROM ? `${length} / ${CHAT_TEXT_MAX}` : null;
}

/** Messages after the seen mark, without yours and without system lines. */
export function unreadCount(messages: readonly ChatMessage[], seenAt: number): number {
  return messages.filter(
    (message) => message.at > seenAt && !isYours(message) && message.kind !== "sys",
  ).length;
}

export function unreadLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

export function canRecall(message: ChatMessage, now: number): boolean {
  return isYours(message) && message.recalled !== true && now - message.at <= RECALL_MS;
}

export function isLong(text: string): boolean {
  return text.split("\n").length > SHOW_MORE_LINES || text.length > SHOW_MORE_LINES * LINE_CHARS;
}

export function reactionRows(
  message: ChatMessage,
): { emoji: string; count: number; mine: boolean }[] {
  return REACTION_CHOICES.flatMap((emoji) => {
    const by = message.reacts[emoji] ?? [];
    return by.length === 0 ? [] : [{ emoji, count: by.length, mine: by.includes(ME) }];
  });
}

/**
 * The first letters of the first two words, or the first two letters of one word. A word is a
 * part between spaces and dashes that starts with a letter, so a sub-agent's number is not one.
 */
function initialsOf(name: string): string {
  const words = name.split(/[\s-]+/).filter((word) => /^\p{L}/u.test(word));
  const [first, second] = words;
  const letters =
    first !== undefined && second !== undefined
      ? `${[...first][0]}${[...second][0]}`
      : [...(first ?? name)].slice(0, 2).join("");
  return letters.toUpperCase();
}

/** Null for a system line and for yours. An agent's colour is its shirt on the floor. */
export function avatarOf(message: ChatMessage): { initials: string; color: string } | null {
  if (message.kind === "sys" || message.from === undefined || isYours(message)) return null;
  const name = message.name ?? message.from;
  if (message.from === DIRECTOR) {
    return { initials: [...name].slice(0, 1).join("").toUpperCase(), color: DIRECTOR_COLOR };
  }
  const shirt = SHIRTS[lookOf(message.from).shirt] ?? SHIRTS[0];
  return { initials: initialsOf(name), color: shirt.shirt };
}

export function pollRows(
  message: ChatMessage,
): { index: number; text: string; count: number; mine: boolean }[] {
  if (message.kind !== "poll" || !message.poll) return [];
  return message.poll.opts.map((option, index) => ({
    index,
    text: option.t,
    count: option.by.length,
    mine: option.by.includes(ME),
  }));
}

/** `when` is the reminder's date and time, as "23 Nov 09:00". */
export function remindState(
  message: ChatMessage,
): { when: string; going: number; yours: "yes" | "no" | null; done: boolean } | null {
  const remind = message.kind === "remind" ? message.remind : null;
  if (!remind) return null;
  let yours: "yes" | "no" | null = null;
  if (remind.yes.includes(ME)) yours = "yes";
  else if (remind.no.includes(ME)) yours = "no";
  return {
    when: dateText(new Date(remind.at)),
    going: remind.yes.length,
    yours,
    done: remind.done === true,
  };
}

export interface Mention {
  start: number;
  query: string;
}

/**
 * The `@` being typed: the last one that starts the text or follows a space, with no new line
 * and at most 40 characters after it. The caret is taken to be at the end of the text.
 */
export function mentionAt(text: string): Mention | null {
  const start = text.lastIndexOf("@");
  if (start < 0) return null;
  if (start > 0 && !/\s/.test(text.charAt(start - 1))) return null;
  const query = text.slice(start + 1);
  if (query.includes("\n") || query.length > MENTION_QUERY_MAX) return null;
  return { start, query };
}

export interface MentionOption {
  id: string;
  name: string;
  room: string;
}

/**
 * The words start with an agent's whole name and a space, and no name starts with all of them: a
 * name was picked or typed in full.
 */
function mentionDone(model: OfficeModel, query: string): boolean {
  const typed = query.toLowerCase();
  const names = model.rooms.flatMap((room) =>
    room.rows.map((row) => agentTitle(row.agent).toLowerCase()),
  );
  return (
    names.some((name) => typed.startsWith(`${name} `)) &&
    !names.some((name) => name.startsWith(typed))
  );
}

/**
 * The agents the List's search finds for the words after `@`, in the floor's order. None once a
 * name is complete, so the list closes after a pick.
 */
export function mentionOptions(model: OfficeModel, query: string): MentionOption[] {
  if (mentionDone(model, query)) return [];
  const options: MentionOption[] = [];
  for (const room of model.rooms) {
    for (const row of room.rows) {
      if (options.length === MENTION_OPTIONS_MAX) return options;
      if (matchesQuery(row, room, query)) {
        options.push({ id: row.agent.id, name: agentTitle(row.agent), room: room.name });
      }
    }
  }
  return options;
}

/** Replaces "@query" with "@Name ". */
export function putMention(text: string, mention: Mention, name: string): string {
  const end = mention.start + 1 + mention.query.length;
  return `${text.slice(0, mention.start)}@${name} ${text.slice(end)}`;
}

export function enterSends(event: { key: string; shiftKey?: boolean }): boolean {
  return event.key === "Enter" && event.shiftKey !== true;
}
