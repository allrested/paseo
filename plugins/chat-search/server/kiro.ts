// Kiro CLI's chats: <home>/.kiro/sessions/cli/<session id>.jsonl, a JSON object per line, and
// <session id>.json beside it with the chat's folder and title. Only what a person typed (a
// Prompt) and what Kiro wrote back (the text of an AssistantMessage) is searched; thinking, tool
// calls and tool results are not.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MAX_COUNTED, type Snippet } from "../shared/contracts.js";
import { linesHolding, type GrepOptions } from "./grep.js";
import { grepPattern } from "./pattern.js";
import { newestFirst, transcriptsIn } from "./sources.js";
import type { ChatStore } from "./stores.js";
import {
  UNTITLED,
  firstLine,
  firstPrompt,
  isEntry,
  noteMatch,
  parseLine,
  type Message,
  type TranscriptRead,
} from "./transcript.js";

const TRANSCRIPT = ".jsonl";
// Every prompt's line holds its kind; so may a line that quotes one, which is then parsed and
// found to be something else.
const PROMPT_LINE = '"Prompt"';

export function kiroRoot(home: string): string {
  return join(home, ".kiro", "sessions", "cli");
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (isEntry(block) && block.kind === "text" && typeof block.data === "string") {
      parts.push(block.data);
    }
  }
  return parts.join("\n");
}

// Kiro stamps a prompt in seconds; what it wrote back has no time of its own.
function writtenAt(meta: unknown): string | null {
  const stamp = isEntry(meta) ? meta.timestamp : null;
  if (typeof stamp !== "number") return null;
  const date = new Date(stamp * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The message a line of a Kiro chat holds, or null for every other kind of line. */
export function kiroMessageOf(entry: unknown): Message | null {
  if (!isEntry(entry) || !isEntry(entry.data)) return null;
  const { kind, data } = entry;
  if (kind !== "Prompt" && kind !== "AssistantMessage") return null;
  const text = textOf(data.content);
  if (text.trim() === "") return null;
  return { role: kind === "Prompt" ? "user" : "assistant", at: writtenAt(data.meta), text };
}

interface About {
  title: string | null;
  folder: string | null;
}

const NOTHING: About = { title: null, folder: null };

// What the file beside a chat says about it. Kiro leaves most titles empty.
async function aboutChat(file: string): Promise<About> {
  try {
    const beside = `${file.slice(0, -TRANSCRIPT.length)}.json`;
    const about: unknown = JSON.parse(await readFile(beside, "utf8"));
    if (!isEntry(about)) return NOTHING;
    const title = typeof about.title === "string" ? firstLine(about.title) : "";
    return {
      title: title === "" ? null : title,
      folder: typeof about.cwd === "string" ? about.cwd : null,
    };
  } catch {
    // No file beside the chat, or one cut short: the chat is still a chat.
    return NOTHING;
  }
}

async function readKiroChat(
  file: string,
  words: string,
  maxSnippets: number,
  grep: GrepOptions = {},
): Promise<TranscriptRead | null> {
  const reading: { matches: number; snippets: Snippet[] } = { matches: 0, snippets: [] };
  for await (const line of linesHolding(file, [grepPattern(words)], grep)) {
    const message = kiroMessageOf(parseLine(line));
    if (message !== null) noteMatch(reading, message, words, maxSnippets);
    if (reading.matches === MAX_COUNTED) break;
  }
  if (reading.matches === 0) return null;
  const about = await aboutChat(file);
  return {
    title: about.title ?? (await firstPrompt(file, PROMPT_LINE, kiroMessageOf)) ?? UNTITLED,
    folder: about.folder,
    matches: reading.matches,
    snippets: reading.snippets,
  };
}

/** Kiro CLI's chats in this folder (kiroRoot). */
export function kiroStore(root: string): ChatStore {
  return {
    provider: "kiro",
    list: async () => newestFirst(await transcriptsIn(root)),
    read: readKiroChat,
  };
}
