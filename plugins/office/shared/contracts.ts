import { defineRpc, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

/** The host-wide board. Every other board id is a workspace id. */
export const LOBBY = "lobby";
/** The author of a post the user made in the office. */
export const USER_AUTHOR = "user";
export const POST_TEXT_MAX = 2000;
export const BOARD_POST_MAX = 200;
export const DONE_TASK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const READ_POST_MAX = 30;
export const WAKES_PER_HOUR = 6;

export const AgentStatusSchema = z.enum(["initializing", "idle", "running", "error", "closed"]);
export type AgentStatus = z.output<typeof AgentStatusSchema>;

export const PermissionKindSchema = z.enum(["tool", "plan", "question", "mode", "other"]);
export type PermissionKind = z.output<typeof PermissionKindSchema>;

export const OfficePermissionSchema = z.object({
  id: z.string(),
  kind: PermissionKindSchema,
  title: z.string(),
});
export type OfficePermission = z.output<typeof OfficePermissionSchema>;

export const OfficeAgentSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  provider: z.string(),
  model: z.string().nullable(),
  status: AgentStatusSchema,
  /** Null for an agent without a workspace; it sits in the lobby. */
  workspaceId: z.string().nullable(),
  parentAgentId: z.string().nullable(),
  permissions: z.array(OfficePermissionSchema),
  createdAt: z.string(),
});
export type OfficeAgent = z.output<typeof OfficeAgentSchema>;

export const OfficeWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectName: z.string(),
});
export type OfficeWorkspace = z.output<typeof OfficeWorkspaceSchema>;

export const PostKindSchema = z.enum(["task", "note"]);
export type PostKind = z.output<typeof PostKindSchema>;

export const TaskStateSchema = z.enum(["open", "claimed", "done"]);
export type TaskState = z.output<typeof TaskStateSchema>;

export const UpdateActionSchema = z.enum(["claim", "done", "reopen"]);
export type UpdateAction = z.output<typeof UpdateActionSchema>;

export const PostSchema = z.object({
  /** `p` and the post's seq at creation. */
  id: z.string(),
  /** Raised on every change; office_read's cursor. */
  seq: z.number().int().nonnegative(),
  /** A workspace id, or "lobby". */
  board: z.string(),
  kind: PostKindSchema,
  text: z.string(),
  /** An agent id, or "user". */
  author: z.string(),
  to: z.string().optional(),
  /** Tasks only. */
  state: TaskStateSchema.optional(),
  claimedBy: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Post = z.output<typeof PostSchema>;

export const WakeStateSchema = z.object({
  paused: z.boolean(),
  /** Deliveries waiting, per agent id; agents with none are absent. */
  queued: z.record(z.string(), z.number().int().nonnegative()),
});
export type WakeState = z.output<typeof WakeStateSchema>;

export const OfficeSnapshotSchema = z.object({
  agents: z.array(OfficeAgentSchema),
  workspaces: z.array(OfficeWorkspaceSchema),
  /** The "doing now" line of each running agent that has one. */
  activity: z.record(z.string(), z.string()),
  boards: z.record(z.string(), z.array(PostSchema)),
  wake: WakeStateSchema,
});
export type OfficeSnapshot = z.output<typeof OfficeSnapshotSchema>;

export const OfficeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), state: OfficeSnapshotSchema }),
  z.object({ type: z.literal("agents"), agents: z.array(OfficeAgentSchema) }),
  z.object({ type: z.literal("workspaces"), workspaces: z.array(OfficeWorkspaceSchema) }),
  z.object({ type: z.literal("activity"), activity: z.record(z.string(), z.string()) }),
  z.object({ type: z.literal("board"), board: z.string(), posts: z.array(PostSchema) }),
  z.object({ type: z.literal("board-removed"), board: z.string() }),
  z.object({ type: z.literal("wake"), wake: WakeStateSchema }),
]);
export type OfficeEvent = z.output<typeof OfficeEventSchema>;

export const PostResultSchema = z.union([
  z.object({ ok: z.literal(true), post: PostSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type PostResult = z.output<typeof PostResultSchema>;

export const DeleteResultSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type DeleteResult = z.output<typeof DeleteResultSchema>;

/** A snapshot, then changes. */
export const officeStateSubscription = defineSubscription({
  name: "office.state",
  input: z.object({}),
  event: OfficeEventSchema,
});

export const postRpc = defineRpc({
  name: "office.post.request",
  input: z.object({
    board: z.string().min(1),
    kind: PostKindSchema,
    text: z.string().min(1).max(POST_TEXT_MAX),
    to: z.string().min(1).optional(),
  }),
  output: PostResultSchema,
});

export const updateRpc = defineRpc({
  name: "office.update.request",
  input: z.object({ id: z.string().min(1), action: UpdateActionSchema }),
  output: PostResultSchema,
});

export const deleteRpc = defineRpc({
  name: "office.delete.request",
  input: z.object({ id: z.string().min(1) }),
  output: DeleteResultSchema,
});

export const setWakesPausedRpc = defineRpc({
  name: "office.set_wakes_paused.request",
  input: z.object({ paused: z.boolean() }),
  output: WakeStateSchema,
});

/** The vendored three.js build, as bytes. */
export const assetRpc = defineRpc({
  name: "office.asset.request",
  input: z.object({}),
  output: z.instanceof(Uint8Array),
});
