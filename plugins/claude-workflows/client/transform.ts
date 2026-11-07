import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";
import { z } from "zod";
import { WORKFLOW_ITEM_KIND, WORKFLOW_ITEM_VERSION, type WorkflowItem } from "../shared/run.js";

type ToolCallTransformer = PluginTimelineTransformerContribution<"tool_call">["transform"];

/** Claude's provider keeps a tool result that is not JSON as `{ output: "<text>" }`. */
const ClaudeToolOutputSchema = z.object({ output: z.string() });

// The launch result names the run on a line of its own, as the replay source reads it
// (packages/server/src/server/agent/providers/claude/subagents/workflow-replay-source.ts), but
// only in Claude Code's run id format, so the card never asks the daemon for anything else.
const RUN_ID_LINE = /(?:^|\n)Run ID:[^\S\n]*(wf_[0-9a-f]{8}-[0-9a-f]{3})(?![0-9A-Za-z-])/u;
const SUMMARY_LINE = /(?:^|\n)Summary:[^\S\n]*([^\n]*)/u;

/**
 * Swaps the card of Claude Code's `Workflow` tool for the workflow card once the tool result
 * names a run. Without a run id (the launch is pending or failed) the plain card stays.
 */
export const transformWorkflowCall: ToolCallTransformer = ({ item }) => {
  if (item.name !== "Workflow" || item.detail.type !== "unknown") return undefined;
  const output = ClaudeToolOutputSchema.safeParse(item.detail.output);
  if (!output.success) return undefined;
  const text = output.data.output;
  const runId = RUN_ID_LINE.exec(text)?.[1];
  if (runId === undefined) return undefined;
  const data = { runId, summary: summaryOf(text) } satisfies WorkflowItem;
  return {
    items: [{ type: "plugin", kind: WORKFLOW_ITEM_KIND, version: WORKFLOW_ITEM_VERSION, data }],
  };
};

/** The text of the result's `Summary:` line, or null when it has none or a blank one. */
function summaryOf(text: string): string | null {
  const summary = SUMMARY_LINE.exec(text)?.[1]?.trim() ?? "";
  return summary === "" ? null : summary;
}
