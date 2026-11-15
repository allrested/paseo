import { defineRpc, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

/** The host keeps this many days of hours; the screen's longest range is shorter. */
export const KEEP_DAYS = 120;
/** The ranges the screen offers, in days. */
export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

/** An hour of the clock, UTC: "2026-11-15T11". */
export const HourKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}$/);

/** What the agents of one workspace did in one hour. */
export const HourSchema = z.object({
  hour: HourKeySchema,
  /** Null for agents outside every workspace. */
  workspaceId: z.string().nullable(),
  /** The turns that ended in the hour, however they ended. */
  turns: z.number().int().min(0),
  /** Of those, the turns that failed. */
  failed: z.number().int().min(0),
  /** The time agents spent in turns during the hour. Two agents at once count twice. */
  workMs: z.number().min(0),
});
export type Hour = z.output<typeof HourSchema>;

export const StatsWorkspaceSchema = z.object({
  id: z.string(),
  /** The workspace's name now; its folder's name once it is gone. */
  name: z.string(),
  /** False once the workspace is archived or removed: there is nothing to open. */
  open: z.boolean(),
});
export type StatsWorkspace = z.output<typeof StatsWorkspaceSchema>;

export const StatsSchema = z.object({
  /** The hours from the asked one on, in no order. */
  hours: z.array(HourSchema),
  /** The workspaces those hours name. */
  workspaces: z.array(StatsWorkspaceSchema),
  /** When the host began to count: turns before it are not known. */
  countingSince: z.string(),
});
export type Stats = z.output<typeof StatsSchema>;

/** The hours from `since` on. The client asks from its own midnight, so days are its days. */
export const statsRpc = defineRpc({
  name: "stats.read.request",
  input: z.object({ since: HourKeySchema }),
  output: StatsSchema,
});

/** Tells a screen that a turn ended, so what it shows is behind. */
export const statsChanges = defineSubscription({
  name: "stats.changes",
  input: z.object({}),
  event: z.object({ type: z.literal("changed") }),
});
