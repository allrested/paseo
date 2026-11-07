import { describe, expect, it } from "vitest";
import {
  RUN_ID_PATTERN,
  RunViewSchema,
  WorkflowItemSchema,
  runRpc,
  type LoadedRun,
  type RunAgent,
  type UnavailableRun,
} from "./run.js";

const RUN_ID = "wf_0a1b2c3d-4e5";

const agent: RunAgent = {
  key: "read-a",
  label: "Read a.txt",
  phase: "Read",
  state: "running",
  toolCalls: 2,
  lastTool: { name: "Read", file: "a.txt", running: true },
  tokens: 41_200,
  firstActivityAt: 1_762_509_600_000,
  lastActivityAt: 1_762_509_660_000,
};

const loaded: LoadedRun = { state: "running", name: "read-files", endedAt: null, agents: [agent] };

const unavailable: UnavailableRun = { state: "unavailable", reason: "run-not-found" };

describe("run contract", () => {
  it("accepts Claude Code run ids only", () => {
    expect(RUN_ID_PATTERN.test(RUN_ID)).toBe(true);
    const bad = [
      "wf_0A1B2C3D-4E5",
      "wf_0a1b2c3-4e5",
      "wf_0a1b2c3d-4e5f",
      `../${RUN_ID}`,
      `${RUN_ID}/x`,
    ];
    expect(bad.filter((id) => RUN_ID_PATTERN.test(id))).toEqual([]);
  });

  it("names the RPC and checks its input", () => {
    expect(runRpc.name).toBe("claude-workflows.run.request");
    expect(runRpc.input.safeParse({ agentId: "agent-1", runId: RUN_ID }).success).toBe(true);
    expect(runRpc.input.safeParse({ agentId: "", runId: RUN_ID }).success).toBe(false);
    expect(runRpc.input.safeParse({ agentId: "agent-1", runId: "../../etc" }).success).toBe(false);
  });

  it("parses a loaded view and an unavailable view", () => {
    expect(RunViewSchema.parse(loaded)).toEqual(loaded);
    expect(RunViewSchema.parse(unavailable)).toEqual(unavailable);
  });

  it("rejects views the card cannot show", () => {
    expect(RunViewSchema.safeParse({ ...loaded, state: "paused" }).success).toBe(false);
    expect(RunViewSchema.safeParse({ state: "unavailable", reason: "offline" }).success).toBe(
      false,
    );
    const negative = { ...loaded, agents: [{ ...agent, toolCalls: -1 }] };
    expect(RunViewSchema.safeParse(negative).success).toBe(false);
  });

  it("checks the timeline item data", () => {
    expect(WorkflowItemSchema.parse({ runId: RUN_ID, summary: null })).toEqual({
      runId: RUN_ID,
      summary: null,
    });
    expect(WorkflowItemSchema.safeParse({ runId: "wf_x", summary: null }).success).toBe(false);
  });
});
