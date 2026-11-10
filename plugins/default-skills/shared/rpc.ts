import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const FolderStatusSchema = z.discriminatedUnion("state", [
  z.object({ folder: z.string(), state: z.literal("installed") }),
  z.object({ folder: z.string(), state: z.literal("off") }),
  /** A folder the plugin did not make, or one changed since it made it. The plugin leaves it. */
  z.object({ folder: z.string(), state: z.literal("skipped"), reason: z.string() }),
  z.object({ folder: z.string(), state: z.literal("error"), error: z.string() }),
]);

export type FolderStatus = z.output<typeof FolderStatusSchema>;

export const SkillStatusSchema = z.object({
  id: z.string(),
  folders: z.array(FolderStatusSchema),
});

export type SkillStatus = z.output<typeof SkillStatusSchema>;

export const SyncStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({
    status: z.literal("done"),
    skillsDirectory: z.string(),
    skills: z.array(SkillStatusSchema),
    /** Why the ownership record could not be written; the next sync tries again. */
    recordError: z.string().nullable(),
  }),
  z.object({ status: z.literal("failed"), error: z.string() }),
]);

export type SyncStatus = z.output<typeof SyncStatusSchema>;

export const statusRpc = defineRpc({
  name: "default-skills.status.request",
  input: z.object({}),
  output: SyncStatusSchema,
});
