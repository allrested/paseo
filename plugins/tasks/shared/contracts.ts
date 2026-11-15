import {
  defineAttachmentSource,
  defineRpc,
  defineSettings,
  PluginAttachmentSearchPayloadSchema,
} from "@getpaseo/plugin";
import { z } from "zod";

export const SourceSchema = z.enum(["jira", "gitlab"]);
export type Source = z.infer<typeof SourceSchema>;
export const SOURCES = SourceSchema.options;
export const SOURCE_NAME: Record<Source, string> = { jira: "Jira", gitlab: "GitLab" };

/** The settings screen's id, for `openSettings`. */
export const CONNECTIONS_SCREEN = "connections";
export const TOKEN_MAX = 500;

/**
 * Where the trackers are. The tokens are not here: every client of the host reads its settings,
 * and a token never leaves the daemon.
 */
export const connections = defineSettings({
  id: "connections",
  scope: "host",
  version: 1,
  schema: z.object({
    jiraSite: z.string().trim().max(200).default(""),
    jiraEmail: z.string().trim().max(200).default(""),
    gitlabUrl: z.string().trim().max(200).default(""),
  }),
});
export type Connections = z.infer<typeof connections.schema>;

/** One task as the New workspace field lists it. */
export const TaskSchema = z.object({
  /** Unique across trackers, such as `jira:BWLT-12`. */
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  key: z.string(),
  url: z.string(),
  /** The branch a workspace for this task starts on. */
  branch: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

/** `configured` is false while no tracker has both an address and a token. */
export const searchTasksRpc = defineRpc({
  name: "tasks.search",
  input: z.object({ query: z.string() }),
  output: z.object({ configured: z.boolean(), tasks: z.array(TaskSchema) }),
});

export const searchAttachmentsRpc = defineRpc({
  name: "tasks.attachments.search",
  input: z.object({ query: z.string() }),
  output: PluginAttachmentSearchPayloadSchema,
});

const TokenStateSchema = z.object({ hasToken: z.boolean() });
export const TokensSchema = z.object({ jira: TokenStateSchema, gitlab: TokenStateSchema });
export type Tokens = z.infer<typeof TokensSchema>;

/** Which trackers have a token saved. The tokens themselves have no RPC that returns them. */
export const tokensRpc = defineRpc({
  name: "tasks.tokens.read",
  input: z.object({}),
  output: TokensSchema,
});

/** Saves a tracker's token, or removes it when `token` is empty. */
export const setTokenRpc = defineRpc({
  name: "tasks.tokens.write",
  input: z.object({ source: SourceSchema, token: z.string().max(TOKEN_MAX) }),
  output: TokensSchema,
});

/** Signs in to a tracker with what is saved. Rejects with the reason it could not. */
export const testConnectionRpc = defineRpc({
  name: "tasks.connections.test",
  input: z.object({ source: SourceSchema }),
  output: z.object({ account: z.string() }),
});

export const taskAttachments = defineAttachmentSource({
  id: "tasks",
  title: "Task",
  icon: "CircleDot",
  pickerTitle: "Attach a task",
  searchPlaceholder: "Search by key or title",
  search: searchAttachmentsRpc,
});
