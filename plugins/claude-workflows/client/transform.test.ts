import { describe, expect, it } from "vitest";
import { WORKFLOW_ITEM_KIND, WORKFLOW_ITEM_VERSION } from "../shared/run.js";
import { transformWorkflowCall } from "./transform.js";

type TransformInput = Parameters<typeof transformWorkflowCall>[0];
type ToolCallItem = TransformInput["item"];
type ToolDetail = ToolCallItem["detail"];

const RUN_ID = "wf_0a1b2c3d-4e5";
const SESSION_DIR = "/home/user/.claude/projects/-tmp-x/0f8c2d4e-1a2b-4c3d-8e9f-0123456789ab";

/** A tool result shaped like Claude Code's launch result, with invented values. */
const RESULT = [
  "Workflow launched in background.",
  "Task ID: w0a1b2c3d",
  `Run ID: ${RUN_ID}`,
  "Summary: Read three files and report",
  `Transcript dir: ${SESSION_DIR}/subagents/workflows/${RUN_ID}`,
  `Script file: ${SESSION_DIR}/workflows/scripts/read-files-${RUN_ID}.js`,
  "",
  "You will be notified when it completes.",
].join("\n");

function unknownDetail(output: unknown): ToolDetail {
  return { type: "unknown", input: null, output };
}

function completed(name: string, detail: ToolDetail): ToolCallItem {
  return { type: "tool_call", callId: "toolu_01", name, detail, status: "completed", error: null };
}

function launched(text: string): ToolCallItem {
  return completed("Workflow", unknownDetail({ output: text }));
}

function transform(item: ToolCallItem) {
  return transformWorkflowCall({ item, phase: "complete" });
}

function workflowCard(summary: string | null) {
  const data = { runId: RUN_ID, summary };
  return {
    items: [{ type: "plugin", kind: WORKFLOW_ITEM_KIND, version: WORKFLOW_ITEM_VERSION, data }],
  };
}

describe("transformWorkflowCall", () => {
  it("swaps a launched Workflow card for the workflow card", () => {
    expect(transform(launched(RESULT))).toEqual(workflowCard("Read three files and report"));
  });

  it("keeps the summary null when the result has none or a blank one", () => {
    const withoutSummary = RESULT.replace(/\nSummary:[^\n]*/u, "");
    const blankSummary = RESULT.replace(/\nSummary:[^\n]*/u, "\nSummary:   ");

    expect(transform(launched(withoutSummary))).toEqual(workflowCard(null));
    expect(transform(launched(blankSummary))).toEqual(workflowCard(null));
  });

  it("keeps the plain card while the launch is pending, after it failed, or without a run id", () => {
    const pending: ToolCallItem = {
      type: "tool_call",
      callId: "toolu_01",
      name: "Workflow",
      detail: unknownDetail(null),
      status: "running",
      error: null,
    };
    const failed: ToolCallItem = {
      type: "tool_call",
      callId: "toolu_01",
      name: "Workflow",
      detail: unknownDetail(null),
      status: "failed",
      error: { message: "Tool call failed" },
    };

    expect(transform(pending)).toBeUndefined();
    expect(transform(failed)).toBeUndefined();
    expect(transform(launched("No run was started"))).toBeUndefined();
  });

  it("leaves other tools alone", () => {
    for (const name of ["Bash", "Task", "workflow", "WorkflowStatus"]) {
      expect(transform(completed(name, unknownDetail({ output: RESULT })))).toBeUndefined();
    }
  });

  it("leaves output shapes other than Claude's alone", () => {
    expect(transform(completed("Workflow", unknownDetail(RESULT)))).toBeUndefined();
    expect(transform(completed("Workflow", unknownDetail({ result: RESULT })))).toBeUndefined();
    expect(transform(completed("Workflow", { type: "plan", text: RESULT }))).toBeUndefined();
  });

  it("takes the run id only from its own line and only in Claude Code's format", () => {
    const midLine = RESULT.replace("Run ID:", "Previous Run ID:");
    const tooLong = RESULT.replace(RUN_ID, `${RUN_ID}f`);
    const upperCase = RESULT.replace(RUN_ID, RUN_ID.toUpperCase());
    const tabbed = RESULT.replace("Run ID: ", "Run ID:\t");

    expect(transform(launched(midLine))).toBeUndefined();
    expect(transform(launched(tooLong))).toBeUndefined();
    expect(transform(launched(upperCase))).toBeUndefined();
    expect(transform(launched(tabbed))).toEqual(workflowCard("Read three files and report"));
    expect(transform(launched(`Run ID: ${RUN_ID}`))).toEqual(workflowCard(null));
  });
});
