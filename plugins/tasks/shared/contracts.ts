import {
  defineAttachmentSource,
  defineRpc,
  defineSettings,
  PluginAttachmentSearchPayloadSchema,
} from "@getpaseo/plugin";
import { z } from "zod";
import { DEFAULT_PROMPT } from "./prompt.js";

export const SourceSchema = z.enum(["jira", "gitlab", "github"]);
export type Source = z.infer<typeof SourceSchema>;
export const SOURCES = SourceSchema.options;
export const SOURCE_NAME: Record<Source, string> = {
  jira: "Jira",
  gitlab: "GitLab",
  github: "GitHub",
};

/** What GitLab calls a merge request, GitHub calls a pull request. */
export function requestName(source: Source): string {
  return source === "github" ? "pull request" : "merge request";
}

/** The settings screen's id, for `openSettings`. */
export const CONNECTIONS_SCREEN = "connections";
export const TOKEN_MAX = 500;
/** The tasks screen's id, for `openScreen`, and the param that names the task it shows. */
export const TASKS_SCREEN = "tasks";
export const TASK_PARAM = "task";
export const COMMENT_MAX = 10_000;
/** The workspace metadata a picked task leaves: which task, its key and its link. */
export const TASK_ID = "tasks.id";
export const TASK_KEY = "tasks.key";
export const TASK_URL = "tasks.url";
export const PROMPT_MAX = 4000;
/** The tasks screen's param that asks for the new issue form; its value is `NEW_ISSUE`. */
export const NEW_PARAM = "new";
export const NEW_ISSUE = "issue";
export const TITLE_MAX = 250;
export const DESCRIPTION_MAX = 20_000;

/**
 * Where the trackers are, and the prompt a task starts a workspace with. The tokens are not here: every client of the host reads its settings,
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
    /** Empty for github.com: a token alone connects it. */
    githubUrl: z.string().trim().max(200).default(""),
    /** Filled by `fillPrompt`; an empty one is the default. */
    promptTemplate: z.string().max(PROMPT_MAX).default(DEFAULT_PROMPT),
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
  /**
   * Unique across trackers: `jira:BWLT-12`, `gitlab:issue:42:7`, `gitlab:mr:42:12`,
   * `github:issue:shop/web:7`. A GitHub pull request is kind `mr`: `github:mr:shop/web:12`.
   */
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

/** A picture of a task's description, read through `taskImageRpc`. */
export const TaskImageSchema = z.object({ id: z.string(), name: z.string() });
export type TaskImage = z.infer<typeof TaskImageSchema>;

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
  /** The saved account is among the task's assignees. */
  assignedToMe: z.boolean(),
  /** The pictures the description held; the text names each where it stood. */
  images: z.array(TaskImageSchema),
  /** A merge request whose review threads `reviewThreadsRpc` reads. */
  reviewThreads: z.boolean(),
});
export type TaskDetail = z.infer<typeof TaskDetailSchema>;

/** Where a status stands, whatever the tracker calls it. */
export const PhaseSchema = z.enum(["todo", "doing", "done"]);
export type Phase = z.infer<typeof PhaseSchema>;

/** A workspace that was started on a task. */
export const LinkedWorkspaceSchema = z.object({
  workspaceId: z.string(),
  /** The workspace's name, for a button that opens it. */
  name: z.string(),
  key: z.string(),
  url: z.string(),
  /** The task, when the workspace names it or its key tells it. */
  taskId: TaskId.optional(),
  /** How the task stands. Absent while its tracker cannot be asked or does not show it. */
  status: z.string().optional(),
  phase: PhaseSchema.optional(),
});
export type LinkedWorkspace = z.infer<typeof LinkedWorkspaceSchema>;

/**
 * The workspaces started on a task, and how each task stands now. `workspaceIds` is every
 * workspace the host had when it answered, so a newer one is known to be missing from it.
 */
export const linkedWorkspacesRpc = defineRpc({
  name: "tasks.workspaces.linked",
  input: z.object({}),
  output: z.object({
    workspaceIds: z.array(z.string()),
    linked: z.array(LinkedWorkspaceSchema),
  }),
});
export type LinkedWorkspaces = z.infer<typeof linkedWorkspacesRpc.output>;

/** The saved prompt template, filled with one task. */
export const taskPromptRpc = defineRpc({
  name: "tasks.prompt.fill",
  input: z.object({ id: TaskId }),
  output: z.object({ text: z.string() }),
});

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

/** One thread of a merge request's review: a first note and the answers to it. */
export const ReviewThreadSchema = z.object({
  id: z.string(),
  resolved: z.boolean(),
  resolvedBy: z.string().optional(),
  /** The file and line it is about; absent for a thread about the whole request. */
  where: z.string().optional(),
  /** Oldest first. */
  notes: z.array(TaskCommentSchema),
});
export type ReviewThread = z.infer<typeof ReviewThreadSchema>;

/** The open threads first, then the resolved; each as the tracker lists them, oldest first. */
export const ReviewThreadsSchema = z.object({
  threads: z.array(ReviewThreadSchema),
  /** The tracker holds more threads than were read. */
  more: z.boolean(),
});
export type ReviewThreads = z.infer<typeof ReviewThreadsSchema>;

const ThreadId = z.string().min(1).max(100);

export const reviewThreadsRpc = defineRpc({
  name: "tasks.threads.list",
  input: z.object({ id: TaskId }),
  output: ReviewThreadsSchema,
});

/** Answers a thread as the saved account, and answers with the threads as they then are. */
export const replyThreadRpc = defineRpc({
  name: "tasks.threads.reply",
  input: z.object({ id: TaskId, thread: ThreadId, text: z.string().max(COMMENT_MAX) }),
  output: ReviewThreadsSchema,
});

/** Resolves a thread or opens it again, and answers with the threads as they then are. */
export const resolveThreadRpc = defineRpc({
  name: "tasks.threads.resolve",
  input: z.object({ id: TaskId, thread: ThreadId, resolved: z.boolean() }),
  output: ReviewThreadsSchema,
});

/** A connected tracker a new issue can go to. `kinds` says its issues have a kind to pick. */
export const TrackerChoiceSchema = z.object({ source: SourceSchema, kinds: z.boolean() });
export type TrackerChoice = z.infer<typeof TrackerChoiceSchema>;

export const sourcesRpc = defineRpc({
  name: "tasks.sources.list",
  input: z.object({}),
  output: z.object({ sources: z.array(TrackerChoiceSchema) }),
});

/** A project, a repository or a kind of issue, as a list offers it. */
export const ChoiceSchema = z.object({ id: z.string(), label: z.string() });
export type Choice = z.infer<typeof ChoiceSchema>;

const PlaceId = z.string().min(1).max(200);

/** The projects or repositories of one tracker that a new issue can go to. */
export const placesRpc = defineRpc({
  name: "tasks.places.list",
  input: z.object({ source: SourceSchema, query: z.string().max(200) }),
  output: z.object({ places: z.array(ChoiceSchema) }),
});

/** The kinds of issue a place takes; none on a tracker whose issues have no kinds. */
export const kindsRpc = defineRpc({
  name: "tasks.kinds.list",
  input: z.object({ source: SourceSchema, place: PlaceId }),
  output: z.object({ kinds: z.array(ChoiceSchema) }),
});

export const NewTaskSchema = z.object({
  source: SourceSchema,
  place: PlaceId,
  kind: z.string().min(1).max(40).optional(),
  title: z.string().max(TITLE_MAX),
  description: z.string().max(DESCRIPTION_MAX),
  /** Assign it to the saved account once it is made. */
  assign: z.boolean(),
});
export type NewTask = z.infer<typeof NewTaskSchema>;

/**
 * Makes an issue as the saved account. `warning` is what went wrong after it was made: an issue
 * that could not be assigned is still made.
 */
export const createTaskRpc = defineRpc({
  name: "tasks.create",
  input: NewTaskSchema,
  output: z.object({ id: TaskId, warning: z.string().optional() }),
});

/** Puts the saved account among a task's assignees and answers with the task as it then is. */
export const assignTaskRpc = defineRpc({
  name: "tasks.assign",
  input: z.object({ id: TaskId }),
  output: TaskDetailSchema,
});

/** One picture of a task's description. The daemon reads it: the client has no sign-in. */
export const taskImageRpc = defineRpc({
  name: "tasks.images.read",
  input: z.object({ id: TaskId, image: z.string().min(1).max(300) }),
  output: z.object({
    mime: z.string(),
    /** The file in base64. */
    data: z.string(),
  }),
});
export type TaskImageFile = z.infer<typeof taskImageRpc.output>;

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
export const TokensSchema = z.object({
  jira: TokenStateSchema,
  gitlab: TokenStateSchema,
  github: TokenStateSchema,
});
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
