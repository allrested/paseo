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
/** The tasks screen's id, for `openScreen`, and the param that names the task it shows. */
export const TASKS_SCREEN = "tasks";
export const TASK_PARAM = "task";
export const COMMENT_MAX = 10_000;

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

export const TaskKindSchema = z.enum(["issue", "mr"]);
export type TaskKind = z.infer<typeof TaskKindSchema>;

const TaskId = z.string().min(1).max(200);

/** One task on the tasks screen's list. */
export const TaskRowSchema = z.object({
  /** Unique across trackers: `jira:BWLT-12`, `gitlab:issue:42:7`, `gitlab:mr:42:12`. */
  id: TaskId,
  source: SourceSchema,
  kind: TaskKindSchema,
  key: z.string(),
  title: z.string(),
  status: z.string(),
  url: z.string(),
  /** When it last changed, as an ISO time; absent when the tracker gave none. */
  updatedAt: z.string().optional(),
  /** Why a merge request is listed: "Review requested", "Assigned to you". */
  note: z.string().optional(),
});
export type TaskRow = z.infer<typeof TaskRowSchema>;

export const TaskCommentSchema = z.object({
  id: z.string(),
  author: z.string(),
  /** An ISO time, or empty when the tracker gave none. */
  at: z.string(),
  text: z.string(),
});
export type TaskComment = z.infer<typeof TaskCommentSchema>;

/** A status the task can move to now. */
export const StatusChangeSchema = z.object({ id: z.string(), label: z.string() });
export type StatusChange = z.infer<typeof StatusChangeSchema>;

/** One task as its page shows it. */
export const TaskDetailSchema = TaskRowSchema.extend({
  description: z.string(),
  /** The description and the comments are Markdown; plain text otherwise. */
  markdown: z.boolean(),
  details: z.array(z.tuple([z.string(), z.string()])),
  /** The newest comments, oldest first. */
  comments: z.array(TaskCommentSchema),
  /** How many older comments the tracker holds beyond these. */
  earlierComments: z.number(),
  changes: z.array(StatusChangeSchema),
  /** For an issue: the branch a workspace for it starts on. */
  branch: z.string().optional(),
});
export type TaskDetail = z.infer<typeof TaskDetailSchema>;

/**
 * The signed-in user's open issues and merge requests. `problems` holds one sentence for each
 * list that failed while another answered.
 */
export const listTasksRpc = defineRpc({
  name: "tasks.list",
  input: z.object({ query: z.string().max(200) }),
  output: z.object({
    configured: z.boolean(),
    issues: z.array(TaskRowSchema),
    mergeRequests: z.array(TaskRowSchema),
    problems: z.array(z.string()),
  }),
});
export type TaskList = z.infer<typeof listTasksRpc.output>;

export const taskDetailRpc = defineRpc({
  name: "tasks.detail",
  input: z.object({ id: TaskId }),
  output: TaskDetailSchema,
});

/** Posts a comment as the saved account and answers with the task as it then is. */
export const addCommentRpc = defineRpc({
  name: "tasks.comments.add",
  input: z.object({ id: TaskId, text: z.string().max(COMMENT_MAX) }),
  output: TaskDetailSchema,
});

/** Moves a task by one of its `changes` and answers with the task as it then is. */
export const changeStatusRpc = defineRpc({
  name: "tasks.status.change",
  input: z.object({ id: TaskId, change: z.string().min(1).max(40) }),
  output: TaskDetailSchema,
});

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
