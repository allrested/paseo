import { defineRpc, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

/** The host keeps this many entries; the oldest goes when a new one comes. */
export const MAX_ENTRIES = 200;
/** A row's text is one line of this length at most. */
export const TEXT_MAX = 140;

export const FeedKindSchema = z.enum(["finished", "failed", "permission"]);
export type FeedKind = z.output<typeof FeedKindSchema>;

export const FeedEntrySchema = z.object({
  id: z.string(),
  /** When it happened. */
  at: z.string(),
  kind: FeedKindSchema,
  agentId: z.string(),
  /** The agent's title at the time; null for an agent without one. */
  title: z.string().nullable(),
  /** The folder the agent works in. */
  folder: z.string(),
  /**
   * One line. finished: the first line of the agent's last message, null when it wrote none.
   * failed: the error. permission: what is asked.
   */
  text: z.string().nullable(),
  /** A permission entry's request: the entry goes when the request is answered. */
  requestId: z.string().optional(),
});
export type FeedEntry = z.output<typeof FeedEntrySchema>;

/** An agent that is in a turn now. */
export const RunningAgentSchema = z.object({
  agentId: z.string(),
  /** The agent's title when the turn started; null for an agent without one. */
  title: z.string().nullable(),
  /** The folder the agent works in. */
  folder: z.string(),
  /** When the turn started; null for a turn that began before the feed listened. */
  since: z.string().nullable(),
});
export type RunningAgent = z.output<typeof RunningAgentSchema>;

export const FeedStateSchema = z.object({
  /** Newest first. */
  entries: z.array(FeedEntrySchema),
  /** When the feed was last opened, on any device; null when it never was. */
  seenAt: z.string().nullable(),
  /**
   * The entries marked unread. Opening the feed does not read them: each stays unread until it
   * is marked read or its agent is opened from it. Absent when none is.
   */
  unread: z.array(z.string()).optional(),
  /**
   * The agents in a turn now, the newest turn first. The host knows them from its turns and
   * keeps them in memory only. Absent when none runs.
   */
  running: z.array(RunningAgentSchema).optional(),
});
export type FeedState = z.output<typeof FeedStateSchema>;

export const FeedEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state"), state: FeedStateSchema }),
  z.object({ type: z.literal("added"), entry: FeedEntrySchema }),
  z.object({ type: z.literal("removed"), ids: z.array(z.string()) }),
  z.object({ type: z.literal("seen"), seenAt: z.string() }),
  z.object({ type: z.literal("marked"), id: z.string(), unread: z.boolean() }),
  z.object({ type: z.literal("started"), agent: RunningAgentSchema }),
  z.object({ type: z.literal("stopped"), agentId: z.string() }),
]);
export type FeedEvent = z.output<typeof FeedEventSchema>;

/** The state, then each change. */
export const feedSubscription = defineSubscription({
  name: "feed.state",
  input: z.object({}),
  event: FeedEventSchema,
});

/** The feed is open on a device: what is in it now is no longer new. */
export const seenRpc = defineRpc({
  name: "feed.seen.request",
  input: z.object({}),
  output: z.object({ seenAt: z.string() }),
});

/** Marks one entry unread, or read again. An entry the feed no longer holds changes nothing. */
export const markRpc = defineRpc({
  name: "feed.unread.request",
  input: z.object({ id: z.string().min(1).max(100), unread: z.boolean() }),
  output: z.object({}),
});
