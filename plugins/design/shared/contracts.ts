import { defineRpc, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

const Fail = z.object({ ok: z.literal(false), error: z.string() });
const Ok = z.object({ ok: z.literal(true) });

export const PublicFileSchema = z.object({
  id: z.string(),
  projectKey: z.string(),
  name: z.string(),
  createdAt: z.number(),
  lastAgentId: z.string().nullable(),
});
export type PublicFile = z.output<typeof PublicFileSchema>;

export const BridgeStatusNameSchema = z.enum(["stopped", "starting", "running", "failed"]);

export const FileRowSchema = PublicFileSchema.extend({
  status: BridgeStatusNameSchema,
  error: z.string().nullable(),
  outOfStep: z.boolean(),
});
export type FileRow = z.output<typeof FileRowSchema>;

export const TokensStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("none") }),
  z.object({ status: z.literal("imported"), warnings: z.array(z.string()) }),
  z.object({ status: z.literal("default") }),
  z.object({ status: z.literal("refused"), reason: z.string() }),
  z.object({ status: z.literal("written-back") }),
]);

export const designFilesRpc = defineRpc({
  name: "design.files.request",
  input: z.object({ workspaceId: z.string().min(1) }),
  output: z.union([
    z.object({ enabled: z.literal(true), files: z.array(FileRowSchema) }),
    z.object({ enabled: z.literal(false), reason: z.string() }),
  ]),
});

const FileResult = z.union([z.object({ ok: z.literal(true), file: PublicFileSchema }), Fail]);
export const createFileRpc = defineRpc({
  name: "design.create.request",
  input: z.object({ workspaceId: z.string().min(1), name: z.string().trim().min(1).max(80) }),
  output: FileResult,
});
export const renameFileRpc = defineRpc({
  name: "design.rename.request",
  input: z.object({ fileId: z.string().min(1), name: z.string().trim().min(1).max(80) }),
  output: FileResult,
});
export const removeFileRpc = defineRpc({
  name: "design.remove.request",
  input: z.object({ fileId: z.string().min(1) }),
  output: z.union([Ok, Fail]),
});
export const editorLinkRpc = defineRpc({
  name: "design.editor_link.request",
  input: z.object({ fileId: z.string().min(1), workspaceId: z.string().min(1) }),
  output: z.union([z.object({ ok: z.literal(true), url: z.string() }), Fail]),
});
export const addCommentRpc = defineRpc({
  name: "design.comment.request",
  input: z.object({
    fileId: z.string().min(1),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    text: z.string().trim().min(1).max(2000),
  }),
  output: z.union([Ok, Fail]),
});
export const sendRpc = defineRpc({
  name: "design.send.request",
  input: z.object({
    fileId: z.string().min(1),
    agentId: z.string().min(1),
    note: z.string().max(4000),
  }),
  output: z.union([Ok, Fail]),
});
export const agentsRpc = defineRpc({
  name: "design.agents.request",
  input: z.object({ workspaceId: z.string().min(1) }),
  output: z.object({ agents: z.array(z.object({ id: z.string(), title: z.string() })) }),
});

// Editing on the phone: a layer picked in the bridge's picture, changed through the bridge.
const FractionSchema = z.number().min(0).max(1);
const StepSchema = z.number().int().min(-1000).max(1000);

export const LayerRefSchema = z.object({ id: z.string(), name: z.string(), type: z.string() });
export type LayerRef = z.output<typeof LayerRefSchema>;

export const LayerSchema = LayerRefSchema.extend({
  width: z.number(),
  height: z.number(),
  /** A text layer's text; null for any other layer. */
  text: z.string().nullable(),
  /** The token the fill is bound to, else the first solid fill's colour. */
  fill: z.object({ token: z.string().nullable(), color: z.string().nullable() }),
  /** Where it sits in the picture, as 0..1 of it, for the outline. */
  box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
});
export type Layer = z.output<typeof LayerSchema>;

export const ColorTokenSchema = z.object({ name: z.string(), hex: z.string().nullable() });
export type ColorToken = z.output<typeof ColorTokenSchema>;

export const ChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().max(5000) }),
  z.object({ kind: z.literal("fill"), token: z.string().min(1) }),
  z.object({ kind: z.literal("move"), dx: StepSchema, dy: StepSchema }),
  z.object({ kind: z.literal("resize"), dw: StepSchema, dh: StepSchema }),
  z.object({ kind: z.literal("duplicate") }),
  z.object({ kind: z.literal("delete") }),
]);
export type Change = z.output<typeof ChangeSchema>;

export const EditActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("pick"), x: FractionSchema, y: FractionSchema }),
  z.object({ type: z.literal("layer"), id: z.string().min(1) }),
  z.object({ type: z.literal("change"), id: z.string().min(1), change: ChangeSchema }),
  /** `id` is the layer the sheet shows, re-read afterwards. */
  z.object({ type: z.literal("undo"), id: z.string().nullable() }),
  z.object({ type: z.literal("redo"), id: z.string().nullable() }),
]);
export type EditAction = z.output<typeof EditActionSchema>;

export const EditResultSchema = z.object({
  ok: z.literal(true),
  /** The layer to show next; null when it is gone or nothing is under the spot. */
  layer: LayerSchema.nullable(),
  /** A pick's layers under the spot, front-most first; empty for the other actions. */
  here: z.array(LayerRefSchema),
  /** A pick's colour tokens; empty for the other actions. */
  colors: z.array(ColorTokenSchema),
});
export type EditResult = z.output<typeof EditResultSchema>;

export const editRpc = defineRpc({
  name: "design.edit.request",
  input: z.object({ fileId: z.string().min(1), action: EditActionSchema }),
  output: z.union([EditResultSchema, Fail]),
});

export const ViewEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("status"),
    status: BridgeStatusNameSchema,
    error: z.string().nullable(),
  }),
  /** `uri` is a data: URI, or null while the page has nothing on it. */
  z.object({ type: z.literal("picture"), seq: z.number().int(), uri: z.string().nullable() }),
  z.object({ type: z.literal("tokens"), tokens: TokensStateSchema }),
  z.object({
    type: z.literal("threads"),
    threads: z.array(z.object({ id: z.string(), author: z.string(), preview: z.string() })),
  }),
  z.object({ type: z.literal("tokens-written") }),
]);
export type ViewEvent = z.output<typeof ViewEventSchema>;

export const viewSubscription = defineSubscription({
  name: "design.view",
  input: z.object({
    fileId: z.string().min(1),
    workspaceId: z.string().min(1),
    pictures: z.boolean(),
    /** Changes to restart the view after a failure. */
    attempt: z.number().int().optional(),
  }),
  event: ViewEventSchema,
});
