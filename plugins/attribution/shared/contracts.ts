import { defineRpc, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

/** An agent a change is credited to, as it was named when the change was recorded. */
export const AuthorSchema = z.object({
  id: z.string(),
  /** Null for an agent that had no title yet. */
  title: z.string().nullable(),
  provider: z.string(),
});
export type Author = z.output<typeof AuthorSchema>;

/** A file agents changed. */
export const TrackedFileSchema = z.object({
  /** Relative to the checkout's top folder. */
  path: z.string(),
  /** When agents last changed it, in milliseconds. */
  at: z.number(),
  /** The agents of its changes, the latest first. */
  agents: z.array(AuthorSchema),
});
export type TrackedFile = z.output<typeof TrackedFileSchema>;

export const FilesSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), files: z.array(TrackedFileSchema) }),
  /** The workspace's folder is not in a Git checkout: nothing is tracked there. */
  z.object({ status: z.literal("no_checkout") }),
]);
export type Files = z.output<typeof FilesSchema>;

/** One recorded change: the agents that ran while it was made. Usually one. */
export const TurnSchema = z.object({
  /** When the change was seen, in milliseconds. */
  at: z.number(),
  agents: z.array(AuthorSchema),
});
export type Turn = z.output<typeof TurnSchema>;

/** A run of lines one turn wrote. Lines no mark covers were not written by an agent. */
export const MarkSchema = z.object({
  /** The first line, counted from 1. */
  start: z.number().int().min(1),
  count: z.number().int().min(1),
  /** An index into `turns`. */
  turn: z.number().int().min(0),
});
export type Mark = z.output<typeof MarkSchema>;

export const FileSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    /** The file as it is on disk, line by line. */
    lines: z.array(z.string()),
    marks: z.array(MarkSchema),
    turns: z.array(TurnSchema),
  }),
  /** No agent has changed this file since tracking began. */
  z.object({ status: z.literal("untracked") }),
  z.object({ status: z.literal("missing") }),
  z.object({ status: z.literal("binary") }),
  z.object({ status: z.literal("too_large") }),
]);
export type FileLines = z.output<typeof FileSchema>;

/** The files agents changed in the workspace's checkout, the latest first. */
export const filesRpc = defineRpc({
  name: "attribution.files.read.request",
  input: z.object({ workspaceId: z.string() }),
  output: FilesSchema,
});

/** One file's lines and who wrote them. */
export const fileRpc = defineRpc({
  name: "attribution.file.read.request",
  input: z.object({ workspaceId: z.string(), path: z.string().min(1).max(4096) }),
  output: FileSchema,
});

/** Tells a panel that a change was recorded for these workspaces' agents. */
export const attributionChanges = defineSubscription({
  name: "attribution.changes",
  input: z.object({}),
  event: z.object({ type: z.literal("changed"), workspaceIds: z.array(z.string()) }),
});
