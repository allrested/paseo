// One Claude Code transcript: a JSON object per line. Only what a person typed and what the agent
// wrote back is searched; tool calls, tool output, thinking, injected text and subagent side
// chats are not.
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { MAX_COUNTED, type Snippet } from "../shared/contracts.js";
import { linesHolding, type GrepOptions } from "./grep.js";
import { grepPattern } from "./pattern.js";

const BEFORE = 60;
const AFTER = 120;
const TITLE_LENGTH = 80;
export const UNTITLED = "Untitled chat";
// Claude Code writes a title line with its type first, and a message's type somewhere inside.
const TITLE_PATTERN = String.raw`^\{"type":"ai-title"`;
const USER_LINE = '"type":"user"';
// The first prompt is at the top of a transcript; a file without one is not read to its end.
const FIRST_PROMPT_LINES = 200;

export interface Message {
  role: "user" | "assistant";
  at: string | null;
  text: string;
}

export interface TranscriptRead {
  title: string;
  folder: string | null;
  /** Messages that hold the words, counted up to MAX_COUNTED. */
  matches: number;
  snippets: Snippet[];
}

type Entry = Record<string, unknown>;

export function isEntry(value: unknown): value is Entry {
  return typeof value === "object" && value !== null;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (isEntry(block) && block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

/** The message a transcript line holds, or null for every other kind of line. */
export function messageOf(entry: unknown): Message | null {
  if (!isEntry(entry)) return null;
  const { type } = entry;
  if (type !== "user" && type !== "assistant") return null;
  if (entry.isSidechain === true || entry.isMeta === true) return null;
  const text = isEntry(entry.message) ? textOf(entry.message.content) : "";
  if (text.trim() === "") return null;
  return { role: type, at: typeof entry.timestamp === "string" ? entry.timestamp : null, text };
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// The words in a message already read: any case, and any white space where the words have a
// space.
function wordsPattern(words: string): RegExp {
  const source = oneLine(words)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/ /g, "\\s+");
  return new RegExp(source, "iu");
}

/** The text around the first place the words occur, on one line. */
export function cutSnippet(
  text: string,
  words: string,
): Pick<Snippet, "before" | "match" | "after"> | null {
  const flat = oneLine(text);
  const found = wordsPattern(words).exec(flat);
  if (!found) return null;
  const start = found.index;
  const end = start + found[0].length;
  const from = Math.max(0, start - BEFORE);
  const to = Math.min(flat.length, end + AFTER);
  return {
    before: (from > 0 ? "…" : "") + flat.slice(from, start),
    match: found[0],
    after: flat.slice(end, to) + (to < flat.length ? "…" : ""),
  };
}

/** The first line with text on it, cut to a title's length. */
export function firstLine(text: string): string {
  const line =
    text
      .split("\n")
      .map((each) => each.trim())
      .find((each) => each !== "") ?? "";
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
}

export function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    // A line cut short by a crash, or one still being written.
    return null;
  }
}

interface Reading {
  aiTitle: string | null;
  folder: string | null;
  matches: number;
  snippets: Snippet[];
}

function take(reading: Reading, entry: unknown, words: string, maxSnippets: number): void {
  if (!isEntry(entry)) return;
  if (reading.folder === null && typeof entry.cwd === "string") reading.folder = entry.cwd;
  // Claude Code retitles a chat as it goes on; the last title is the current one.
  if (entry.type === "ai-title" && typeof entry.aiTitle === "string")
    reading.aiTitle = entry.aiTitle;
  const message = messageOf(entry);
  if (message !== null) noteMatch(reading, message, words, maxSnippets);
}

/**
 * Counts a message that holds the words, and keeps its snippet while there is room. grep found
 * the words somewhere on the message's line; only here is it known to be in the message.
 */
export function noteMatch(
  reading: { matches: number; snippets: Snippet[] },
  message: Message,
  words: string,
  maxSnippets: number,
): void {
  const cut = cutSnippet(message.text, words);
  if (cut === null) return;
  reading.matches += 1;
  if (reading.snippets.length < maxSnippets) {
    reading.snippets.push({ role: message.role, at: message.at, ...cut });
  }
}

/**
 * What the user typed first, for a chat its provider never titled. `marker` is text every
 * prompt's line holds, so the other lines are not parsed; `read` tells a prompt from the rest.
 */
export async function firstPrompt(
  file: string,
  marker: string,
  read: (entry: unknown) => Message | null,
): Promise<string | null> {
  try {
    const input = createReadStream(file, "utf8");
    try {
      let seen = 0;
      for await (const line of createInterface({ input, crlfDelay: Infinity })) {
        const message = line.includes(marker) ? read(parseLine(line)) : null;
        if (message?.role === "user") return firstLine(message.text);
        seen += 1;
        if (seen === FIRST_PROMPT_LINES) break;
      }
    } finally {
      input.destroy();
    }
  } catch {
    // The file went away after grep read it.
  }
  return null;
}

/**
 * The messages of one transcript that hold the words, or null when none does: the words were
 * only in tool output, or the file is gone. grep hands over the lines that hold the words and
 * the title lines, so a transcript of any size costs the parsing of a few lines. The read stops
 * at MAX_COUNTED matches, so words that are everywhere cost the start of each transcript and not
 * all of it; the title is then the newest one up to there.
 */
export async function readTranscript(
  file: string,
  words: string,
  maxSnippets: number,
  grep: GrepOptions = {},
): Promise<TranscriptRead | null> {
  const reading: Reading = { aiTitle: null, folder: null, matches: 0, snippets: [] };
  for await (const line of linesHolding(file, [grepPattern(words), TITLE_PATTERN], grep)) {
    take(reading, parseLine(line), words, maxSnippets);
    if (reading.matches === MAX_COUNTED) break;
  }
  if (reading.matches === 0) return null;
  return {
    title: reading.aiTitle ?? (await firstPrompt(file, USER_LINE, messageOf)) ?? UNTITLED,
    folder: reading.folder,
    matches: reading.matches,
    snippets: reading.snippets,
  };
}
