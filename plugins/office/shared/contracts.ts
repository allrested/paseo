import { defineRpc, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";
// In their own file, so code that needs only a name does not load the schemas.
import { ACTIVITY_KINDS, TEST_RESULTS } from "./names.js";

export { ACTIVITY_KINDS, LOBBY, USER_AUTHOR } from "./names.js";
export type { ActivityKind, ActivityStep, TestResult } from "./names.js";
export const POST_TEXT_MAX = 2000;
/** The checks of one pull request the office carries. */
export const CHECK_RUNS_MAX = 40;
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
  /** What is asked beyond the title (the command, the file); absent when there is nothing more. */
  detail: z.string().optional(),
});
export type OfficePermission = z.output<typeof OfficePermissionSchema>;

/** How full an agent's context window is, as its provider last said. */
export const AgentContextSchema = z.object({
  usedTokens: z.number().nonnegative(),
  maxTokens: z.number().positive(),
});
export type AgentContext = z.output<typeof AgentContextSchema>;

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
  /** Absent for a provider that reports no context window, and before an agent's first turn. */
  context: AgentContextSchema.optional(),
  /** A sub-agent's number among its parent's, as the office stored it on the agent. */
  number: z.number().int().positive().optional(),
  /** On a parent: the number its next sub-agent gets. */
  next: z.number().int().positive().optional(),
  /** The office's name for a numbered sub-agent: `<parent's name>-<number>`. */
  name: z.string().optional(),
  /**
   * For an idle agent: when anything about it last changed on the host, its turn's end at the
   * earliest. Absent for any other status: a running agent's time moves with every step.
   */
  idleSince: z.string().optional(),
});
export type OfficeAgent = z.output<typeof OfficeAgentSchema>;

/** The ticket a workspace was started on, as the Tasks plugin keeps it on the workspace. */
export const WorkspaceTicketSchema = z.object({ key: z.string(), url: z.string().nullable() });
export type WorkspaceTicket = z.output<typeof WorkspaceTicketSchema>;

/** One check of a pull request: a job of its pipeline. */
export const WorkspaceCheckSchema = z.object({
  name: z.string(),
  status: z.enum(["success", "failure", "pending", "skipped", "cancelled"]),
  /** The run's page on the forge, where its log is. */
  url: z.string().nullable(),
  workflow: z.string().optional(),
  duration: z.string().optional(),
});
export type WorkspaceCheck = z.output<typeof WorkspaceCheckSchema>;

/** A script or a service of a workspace, from the project's own configuration. */
export const WorkspaceScriptSchema = z.object({
  name: z.string(),
  kind: z.enum(["script", "service"]),
  running: z.boolean(),
  /** A service's health check; null for a script and for a service without one. */
  health: z.enum(["healthy", "unhealthy"]).nullable(),
  /** How its last run ended; null while it runs and before its first run. */
  exitCode: z.number().nullable(),
  port: z.number().nullable(),
  /** The terminal it runs in, or ran in; null before its first run. */
  terminalId: z.string().nullable(),
});
export type WorkspaceScript = z.output<typeof WorkspaceScriptSchema>;

/** The pull or merge request of a workspace's branch, as the host's forge reports it. */
export const WorkspacePullRequestSchema = z.object({
  number: z.number().nullable(),
  url: z.string(),
  title: z.string(),
  /** The branch it would be merged into; null when the forge did not say. */
  base: z.string().nullable(),
  state: z.enum(["open", "draft", "merged", "closed"]),
  /** Its checks taken together. */
  checks: z.enum(["none", "pending", "success", "failure"]),
  /** Its checks one by one, the failing and the running first; at most CHECK_RUNS_MAX of them. */
  runs: z.array(WorkspaceCheckSchema),
  review: z.enum(["approved", "changes_requested", "pending"]).nullable(),
  /** It cannot be merged as it is. */
  conflicts: z.boolean(),
});
export type WorkspacePullRequest = z.output<typeof WorkspacePullRequestSchema>;

export const OfficeWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectName: z.string(),
  branch: z.string().optional(),
  ticket: WorkspaceTicketSchema.optional(),
  /** The lines its checkout adds and removes, as the sidebar counts them; absent when none. */
  changes: z.object({ additions: z.number(), deletions: z.number() }).optional(),
  /** Its scripts and services; absent when the project has none. */
  scripts: z.array(WorkspaceScriptSchema).optional(),
  pullRequest: WorkspacePullRequestSchema.optional(),
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

/** A running agent's newest tool call: what it is for, and a key that changes with each call. */
export const ActivityStepSchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  key: z.string(),
  result: z.enum(TEST_RESULTS).optional(),
});

/** The most steps of one agent's checklist the office sends. */
export const CHECKLIST_STEP_MAX = 50;
/** The most characters of a step's text; longer text is cut to one line this long. */
export const CHECKLIST_TEXT_MAX = 200;

/** An unfinished step of an agent's own checklist; finished steps are not sent. */
export const ChecklistStepSchema = z.object({
  text: z.string(),
  status: z.enum(["pending", "in_progress"]),
});
export type ChecklistStep = z.output<typeof ChecklistStepSchema>;

/** Each agent's unfinished steps, by agent id; an agent with none is absent. */
export const ChecklistsSchema = z.record(z.string(), z.array(ChecklistStepSchema));
export type Checklists = z.output<typeof ChecklistsSchema>;

/** The stand-up notes writer, and the 8:00 schedule that starts it. */
export const NotesStateSchema = z.object({
  /** A notes folder is set in the office's settings. */
  folderSet: z.boolean(),
  /** A writer is at work. */
  writing: z.boolean(),
  /** Epoch ms of the last finished write; null before the first. */
  writtenAt: z.number().nullable(),
  /** The writer that stopped on an error, left for the owner. */
  failedAgentId: z.string().nullable(),
  /** Why the last write could not start or stopped; null when it went well. */
  problem: z.string().nullable(),
  /** Why the 8:00 schedule could not follow the settings; null once it does. */
  scheduleError: z.string().nullable(),
});
export type NotesState = z.output<typeof NotesStateSchema>;

export const OfficeSnapshotSchema = z.object({
  agents: z.array(OfficeAgentSchema),
  workspaces: z.array(OfficeWorkspaceSchema),
  /** The "doing now" line of each running agent that has one. */
  activity: z.record(z.string(), z.string()),
  /** The step of each running agent: the tool call it is at, or made since the read before. */
  doing: z.record(z.string(), ActivityStepSchema).optional(),
  /** Each agent's own checklist, kept after the agent stops. */
  checklists: ChecklistsSchema.optional(),
  boards: z.record(z.string(), z.array(PostSchema)),
  wake: WakeStateSchema,
  /** Absent until the office's server has read the writer's state. */
  notes: NotesStateSchema.optional(),
});
export type OfficeSnapshot = z.output<typeof OfficeSnapshotSchema>;

export const OfficeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), state: OfficeSnapshotSchema }),
  z.object({ type: z.literal("agents"), agents: z.array(OfficeAgentSchema) }),
  z.object({ type: z.literal("workspaces"), workspaces: z.array(OfficeWorkspaceSchema) }),
  z.object({
    type: z.literal("activity"),
    activity: z.record(z.string(), z.string()),
    doing: z.record(z.string(), ActivityStepSchema).optional(),
    checklists: ChecklistsSchema.optional(),
  }),
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

/** An idle agent that has had a port open this long has forgotten its server. */
export const FORGOTTEN_AFTER_MS = 30 * 60 * 1000;

/** What one agent's processes hold on the host. */
export const MachineAgentSchema = z.object({
  agentId: z.string(),
  title: z.string().nullable(),
  /** "closed" for an agent whose runtime ended and left processes behind. */
  status: AgentStatusSchema,
  rssBytes: z.number(),
  processCount: z.number().int(),
  /** The TCP ports its processes listen on, lowest first. */
  ports: z.array(z.number().int()),
  /** Since when an idle agent has been idle; null in any other state. */
  idleSince: z.string().nullable(),
  /** Idle for FORGOTTEN_AFTER_MS with a port open, or closed with processes left. */
  forgotten: z.boolean(),
});
export type MachineAgent = z.output<typeof MachineAgentSchema>;

export const MachineSchema = z.object({
  readAt: z.string(),
  /** The daemon's cgroup when it has a cap, else the host; null when neither can be read. */
  memory: z.object({ usedBytes: z.number(), totalBytes: z.number() }).nullable(),
  /** 0 to 100 over every core since the reading before; null on the first. */
  cpuPercent: z.number().nullable(),
  /** The agents with a process on the host: the forgotten first, then by memory. */
  agents: z.array(MachineAgentSchema),
});
export type Machine = z.output<typeof MachineSchema>;

export const MachineEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reading"), machine: MachineSchema }),
  /** The host has no /proc to read (macOS, Windows). */
  z.object({ type: z.literal("unavailable") }),
]);
export type MachineEvent = z.output<typeof MachineEventSchema>;

/** A reading now, then one every MACHINE_INTERVAL_MS while someone listens. */
export const machineSubscription = defineSubscription({
  name: "office.machine",
  input: z.object({}),
  event: MachineEventSchema,
});

export const CleanupResultSchema = z.object({
  agentId: z.string(),
  ok: z.boolean(),
  error: z.string().nullable(),
});
export type CleanupResult = z.output<typeof CleanupResultSchema>;

/**
 * Frees what the named agents hold: closes an idle agent's runtime, which its next prompt
 * resumes, and stops the processes a closed agent left behind.
 */
export const cleanupRpc = defineRpc({
  name: "office.machine.cleanup.request",
  input: z.object({ agentIds: z.array(z.string().min(1)).min(1).max(50) }),
  output: z.object({ results: z.array(CleanupResultSchema) }),
});

export const JANITOR_ACTIONS = ["clean", "reset"] as const;
export type JanitorAction = (typeof JANITOR_ACTIONS)[number];

export const JanitorResultSchema = z.object({ ok: z.boolean(), error: z.string().nullable() });
export type JanitorResult = z.output<typeof JanitorResultSchema>;

/**
 * Tidies an idle agent's conversation with its provider's own command: "clean" compacts it, so
 * the agent keeps a summary, and "reset" starts a new one, so the agent keeps nothing.
 */
export const janitorRpc = defineRpc({
  name: "office.janitor.request",
  input: z.object({ agentId: z.string().min(1), action: z.enum(JANITOR_ACTIONS) }),
  output: JanitorResultSchema,
});

export const ScriptLogResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    /** The newest lines of the script's output, colour codes removed. */
    lines: z.array(z.string()),
    /** Rows of output above these that the terminal still holds. */
    earlier: z.number().int().nonnegative(),
    readAt: z.string(),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type ScriptLogResult = z.output<typeof ScriptLogResultSchema>;

/** The end of a workspace script's output, read from the terminal the script runs in. */
export const scriptLogRpc = defineRpc({
  name: "office.script.log.request",
  input: z.object({ workspaceId: z.string().min(1), script: z.string().min(1) }),
  output: ScriptLogResultSchema,
});

/** A skill as the library lists it: one per name, with the folders it is in. */
export const SkillInfoSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  /** ".claude", ".agents", ".codex": where it was found. */
  folders: z.array(z.string()),
});
export type SkillInfo = z.output<typeof SkillInfoSchema>;

export const SkillsResultSchema = z.object({
  /** The host's own skills: every agent of the tool that reads the folder has them. */
  host: z.array(SkillInfoSchema),
  /** Each workspace's skills, by workspace id; a workspace without a folder is absent. */
  workspaces: z.record(z.string(), z.array(SkillInfoSchema)),
  readAt: z.string(),
});
export type SkillsResult = z.output<typeof SkillsResultSchema>;

/** The skills in the host's skills folders and in every workspace's. */
export const skillsRpc = defineRpc({
  name: "office.skills.request",
  input: z.object({}),
  output: SkillsResultSchema,
});

/**
 * A month of the stand-up notes, `YYYYMM`, read from the notes folder; this month in the notes
 * time zone when none is asked for. Only six digits are taken, so a month cannot name a path.
 */
export const notesReadRpc = defineRpc({
  name: "office.notes.read.request",
  input: z.object({
    month: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
  }),
  output: z.object({
    folderSet: z.boolean(),
    month: z.string(),
    /** The file's text; null when the month has no file. */
    text: z.string().nullable(),
    /** The nearest earlier and later months that have a file; null where none. */
    previous: z.string().nullable(),
    next: z.string().nullable(),
  }),
});

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

/** Deletes every done task of a board. */
export const clearDoneRpc = defineRpc({
  name: "office.board.clear_done.request",
  input: z.object({ board: z.string().min(1) }),
  output: DeleteResultSchema,
});

export const setWakesPausedRpc = defineRpc({
  name: "office.set_wakes_paused.request",
  input: z.object({ paused: z.boolean() }),
  output: WakeStateSchema,
});

/**
 * Starts the stand-up notes writer, as the bell does. `started` is false when none started: one
 * is at work, no folder is set, or it could not start (the snapshot's `notes.problem` says why).
 */
export const notesWriteRpc = defineRpc({
  name: "office.notes.write.request",
  input: z.object({}),
  output: z.object({ started: z.boolean() }),
});

/**
 * The script of the page that draws the 3D office: the vendored my-office scene with three.js,
 * one self-contained file. A browser evaluates it in a frame of its own.
 */
export const worldRpc = defineRpc({
  name: "office.world.request",
  input: z.object({}),
  output: z.string(),
});
