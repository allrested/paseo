import { z } from "zod";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import {
  PluginAttachmentItemSchema,
  type PluginAttachmentItem,
  type PluginSerializableIcon,
} from "@getpaseo/plugin";
import type { UserComposerAttachment } from "@/attachments/types";

export const PluginResourceComposerAttachmentSchema = z.object({
  kind: z.literal("plugin_resource"),
  pluginId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceTitle: z.string().min(1),
  // Validated when the source registered; a draft keeps the icon its source had then.
  sourceIcon: z.union([z.string().min(1), z.object({ svg: z.string().min(1) })]),
  item: PluginAttachmentItemSchema,
});

export type PluginResourceComposerAttachment = z.infer<
  typeof PluginResourceComposerAttachmentSchema
>;

/**
 * What the picker says while it has no rows. A plugin's search fails with a sentence for the
 * user; the daemon puts "Request failed: " before it and the client appends the request it failed
 * on, and neither is for the user.
 */
export function searchEmptyText(error: unknown, isFetching: boolean): string {
  if (error instanceof Error) {
    if (error.name !== "DaemonRpcError") return error.message;
    return error.message
      .replace(/ requestType=\S+(?: code=\S+)?$/, "")
      .replace(/^Request failed: /, "");
  }
  if (error) return String(error);
  return isFetching ? "Searching..." : "No results";
}

export interface PluginResourceSourceIdentity {
  pluginId: string;
  sourceId: string;
  sourceTitle: string;
  sourceIcon: PluginSerializableIcon;
}

export function createPluginResourceAttachment(
  source: PluginResourceSourceIdentity,
  item: PluginAttachmentItem,
): PluginResourceComposerAttachment {
  return {
    kind: "plugin_resource",
    ...source,
    item,
  };
}

export function togglePluginResourceAttachment(
  current: UserComposerAttachment[],
  attachment: PluginResourceComposerAttachment,
): UserComposerAttachment[] {
  const matches = (candidate: UserComposerAttachment) =>
    candidate.kind === "plugin_resource" &&
    candidate.pluginId === attachment.pluginId &&
    candidate.sourceId === attachment.sourceId &&
    candidate.item.id === attachment.item.id;
  if (current.some(matches)) {
    return current.filter((candidate) => !matches(candidate));
  }
  return [...current, attachment];
}

export function pluginResourceAttachmentToAgentAttachment(
  attachment: PluginResourceComposerAttachment,
): AgentAttachment {
  return {
    type: "text",
    mimeType: "text/plain",
    title: `${attachment.item.identifier} ${attachment.item.title}`,
    text: attachment.item.text,
    externalResource: {
      provider: attachment.pluginId,
      providerLabel: attachment.sourceTitle,
      resourceType: attachment.item.resourceType,
      id: attachment.item.id,
      identifier: attachment.item.identifier,
      title: attachment.item.title,
      url: attachment.item.url,
    },
  };
}
