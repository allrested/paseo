import { defineRpc, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

// In their own file, so code that needs only a name does not load the schemas (the render page).
export { LOBBY, USER_AUTHOR } from "./names.js";
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
  /** Whether the host can draw the 3D view for a device that cannot (office.render). */
  render: z.object({ available: z.boolean() }).optional(),
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

/** The viewer's theme, as PluginTheme["colors"]: the host draws the 3D view in it. */
export const ThemeColorsSchema = z.object({
  surface0: z.string(),
  surface1: z.string(),
  surface2: z.string(),
  border: z.string(),
  foreground: z.string(),
  foregroundMuted: z.string(),
  accent: z.string(),
  accentForeground: z.string(),
  statusSuccess: z.string(),
  statusWarning: z.string(),
  statusDanger: z.string(),
});

/** One step of a touch on the streamed view, in CSS pixels from its top left. */
export const PointerStepSchema = z.object({
  type: z.enum(["down", "move", "up", "cancel"]),
  x: z.number(),
  y: z.number(),
});
export type PointerStep = z.output<typeof PointerStepSchema>;

export const RenderSizeSchema = z.object({
  /** CSS pixels. */
  width: z.number().positive(),
  height: z.number().positive(),
  pixelRatio: z.number().positive(),
});
export type RenderSize = z.output<typeof RenderSizeSchema>;

export const RenderFocusSchema = z.union([
  z.object({ roomId: z.string() }),
  z.object({ agentId: z.string() }),
]);

export const RenderEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), streamId: z.string() }),
  z.object({
    type: z.literal("picture"),
    seq: z.number().int().positive(),
    /** Base64 JPEG, without the data URI prefix. */
    jpeg: z.string(),
    /** Device pixels. */
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  z.object({ type: z.literal("select"), target: z.enum(["agent", "board"]), id: z.string() }),
  /** The stream ends after it. */
  z.object({ type: z.literal("problem"), message: z.string() }),
]);
export type RenderEvent = z.output<typeof RenderEventSchema>;

/** The 3D view drawn on the host, for a device that cannot draw it: pictures, then selections. */
export const renderSubscription = defineSubscription({
  name: "office.render",
  input: RenderSizeSchema.extend({
    colors: ThemeColorsSchema,
    coarsePointer: z.boolean(),
    /** The workspace tab's room; the camera starts on it. */
    focusRoomId: z.string().optional(),
  }),
  event: RenderEventSchema,
});
export type RenderInput = z.output<typeof renderSubscription.input>;

/** What the viewer of one stream did. An empty call says the viewer is still there. */
export const renderInputRpc = defineRpc({
  name: "office.render.input.request",
  input: z.object({
    streamId: z.string(),
    /** The seq of the last picture the viewer has shown. */
    shown: z.number().int().positive().optional(),
    steps: z.array(PointerStepSchema).max(64).optional(),
    focus: RenderFocusSchema.optional(),
    resize: RenderSizeSchema.optional(),
  }),
  /** False when the host no longer has the stream. */
  output: z.object({ ok: z.boolean() }),
});
export type RenderInputMessage = z.output<typeof renderInputRpc.input>;
