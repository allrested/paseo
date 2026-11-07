import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Claude Code's workflow run id: `wf_`, 8 hex digits, a dash and 3 hex digits. */
export const RUN_ID_PATTERN = /^wf_[0-9a-f]{8}-[0-9a-f]{3}$/;

/** The plugin timeline item that takes the place of a `Workflow` tool card. */
export const WORKFLOW_ITEM_KIND = "claude-workflow";
export const WORKFLOW_ITEM_VERSION = 1;

export const WorkflowItemSchema = z.object({
  runId: z.string().regex(RUN_ID_PATTERN),
  /** The `Summary:` line of the tool result, or null when it has none. */
  summary: z.string().nullable(),
});
export type WorkflowItem = z.output<typeof WorkflowItemSchema>;

export const AgentStateSchema = z.enum(["running", "done", "failed", "stopped", "unreadable"]);
export type AgentState = z.output<typeof AgentStateSchema>;

export const LastToolSchema = z.object({
  name: z.string(),
  /** Relative to the agent's cwd, or a base name for a file outside it. */
  file: z.string().nullable(),
  /** True until the tool's result arrives, and only while the agent runs. */
  running: z.boolean(),
});
export type LastTool = z.output<typeof LastToolSchema>;

export const RunAgentSchema = z.object({
  key: z.string(),
  label: z.string(),
  phase: z.string(),
  state: AgentStateSchema,
  toolCalls: z.number().int().nonnegative(),
  lastTool: LastToolSchema.nullable(),
  /** The newest context size Claude Code reports for the agent. */
  tokens: z.number().int().nonnegative().nullable(),
  /** Epoch milliseconds. */
  firstActivityAt: z.number().nullable(),
  lastActivityAt: z.number().nullable(),
});
export type RunAgent = z.output<typeof RunAgentSchema>;

export const RunStateSchema = z.enum(["running", "completed", "killed", "stopped"]);
export type RunState = z.output<typeof RunStateSchema>;

export const LoadedRunSchema = z.object({
  state: RunStateSchema,
  /** The run record's workflow name. */
  name: z.string().nullable(),
  /** Epoch milliseconds, for Completed and Killed runs. */
  endedAt: z.number().nullable(),
  /** In start order; an agent still queued is not listed. */
  agents: z.array(RunAgentSchema),
});
export type LoadedRun = z.output<typeof LoadedRunSchema>;

export const UnavailableReasonSchema = z.enum([
  "agent-not-found",
  "not-claude",
  "run-not-found",
  "run-unreadable",
]);
export type UnavailableReason = z.output<typeof UnavailableReasonSchema>;

export const UnavailableRunSchema = z.object({
  state: z.literal("unavailable"),
  reason: UnavailableReasonSchema,
});
export type UnavailableRun = z.output<typeof UnavailableRunSchema>;

export const RunViewSchema = z.union([LoadedRunSchema, UnavailableRunSchema]);
export type RunView = z.output<typeof RunViewSchema>;

export const runRpc = defineRpc({
  name: "claude-workflows.run.request",
  input: z.object({
    agentId: z.string().min(1),
    runId: z.string().regex(RUN_ID_PATTERN),
  }),
  output: RunViewSchema,
});
export type RunRequest = z.output<typeof runRpc.input>;
