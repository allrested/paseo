import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** A search needs this many characters, so one letter does not match every chat. */
export const MIN_QUERY = 3;
export const MAX_QUERY = 200;
/** A chat's count stops here: the server reads no further once a chat matched this often. */
export const MAX_COUNTED = 10;

export const SnippetSchema = z.object({
  role: z.enum(["user", "assistant"]),
  /** When the message was written, when the transcript says. */
  at: z.string().nullable(),
  /** The message around the match, on one line; an ellipsis marks text left out. */
  before: z.string(),
  match: z.string(),
  after: z.string(),
});
export type Snippet = z.output<typeof SnippetSchema>;

export const ChatHitSchema = z.object({
  sessionId: z.string(),
  /** Null for a Claude session that is no agent of this Paseo. */
  agentId: z.string().nullable(),
  title: z.string(),
  /** The folder the chat ran in. */
  folder: z.string().nullable(),
  /** When the transcript last changed. */
  changedAt: z.string(),
  /** How many messages hold the words, up to MAX_COUNTED; `snippets` shows the first. */
  matches: z.number().int(),
  snippets: z.array(SnippetSchema),
});
export type ChatHit = z.output<typeof ChatHitSchema>;

export const SearchResultSchema = z.object({
  /** Chats that are agents here, newest first. */
  chats: z.array(ChatHitSchema),
  /** Claude sessions on this host that are no agent here, newest first. */
  others: z.array(ChatHitSchema),
  /** More transcripts held the words than were read. */
  more: z.boolean(),
});
export type SearchResult = z.output<typeof SearchResultSchema>;

export const searchRpc = defineRpc({
  name: "chat-search.search.request",
  input: z.object({ query: z.string().max(MAX_QUERY) }),
  output: SearchResultSchema,
});
