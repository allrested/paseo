// A search of every chat on this host that a store can read (stores.ts). The text of a chat whose
// agent is not loaded is in its transcript and nowhere else, and loading an agent starts its
// runtime, so the search reads the transcripts: grep names the files that hold the words, then
// hands over their lines.
import { MIN_QUERY, type ChatHit, type SearchResult } from "../shared/contracts.js";
import { sessionOwners, type AgentsPort } from "./agents.js";
import { filesHolding } from "./grep.js";
import { grepPattern } from "./pattern.js";
import type { Transcript } from "./sources.js";
import type { ChatStore } from "./stores.js";
import type { TranscriptRead } from "./transcript.js";

/** The newest chats a search reads; older ones that match are only announced. */
export const MAX_CHATS = 40;
const MAX_SNIPPETS = 3;
// Transcripts on a cold disk read at disk speed; past this the search gives up.
const SEARCH_TIMEOUT_MS = 30_000;

export interface SearchPorts {
  /** Where the chats are (hostStores). */
  stores: readonly ChatStore[];
  agents: AgentsPort;
}

interface Kept {
  store: ChatStore;
  transcript: Transcript;
}

interface Found extends Kept {
  read: TranscriptRead;
}

// Every store's transcripts as one list, newest first.
async function everyTranscript(stores: readonly ChatStore[]): Promise<Kept[]> {
  const lists = await Promise.all(
    stores.map(async (store) => (await store.list()).map((transcript) => ({ store, transcript }))),
  );
  return lists
    .flat()
    .toSorted((a, b) => b.transcript.changedAt.localeCompare(a.transcript.changedAt));
}

// The transcripts that hold the words somewhere, in a message or in tool output, newest first.
async function candidates(kept: Kept[], words: string, signal: AbortSignal): Promise<Kept[]> {
  const holding = await filesHolding(
    kept.map(({ transcript }) => transcript.file),
    grepPattern(words),
    { signal },
  );
  return kept.filter(({ transcript }) => holding.has(transcript.file));
}

export async function searchChats(query: string, ports: SearchPorts): Promise<SearchResult> {
  const words = query.trim();
  if (words.length < MIN_QUERY) throw new Error(`Type at least ${MIN_QUERY} characters`);
  const kept = await everyTranscript(ports.stores);
  if (kept.length === 0) return { chats: [], others: [], more: false };
  const signal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  const found: Found[] = [];
  let more = false;
  // One at a time, newest first: reading stops at the cap, and one grep runs at a time.
  for (const { store, transcript } of await candidates(kept, words, signal)) {
    if (found.length === MAX_CHATS) {
      more = true;
      break;
    }
    const read = await store.read(transcript.file, words, MAX_SNIPPETS, { signal });
    if (read !== null) found.push({ store, transcript, read });
  }
  const owners = found.length === 0 ? new Map() : await sessionOwners(ports.agents);
  const chats: ChatHit[] = [];
  const others: ChatHit[] = [];
  for (const { store, transcript, read } of found) {
    const owner = owners.get(transcript.sessionId);
    const hit: ChatHit = {
      provider: store.provider,
      sessionId: transcript.sessionId,
      agentId: owner?.agentId ?? null,
      title: owner?.title ?? read.title,
      folder: read.folder,
      changedAt: transcript.changedAt,
      matches: read.matches,
      snippets: read.snippets,
    };
    (owner ? chats : others).push(hit);
  }
  return { chats, others, more };
}
