import { describe, expect, it } from "vitest";
import { AgentMoveTargetSchema, type AgentMoveTarget } from "./messages.js";

const TARGET: AgentMoveTarget = {
  provider: "claude-work",
  label: "Claude (work)",
  family: "claude",
  available: true,
  current: true,
  usedPct: 84,
  resetsAt: "2026-11-07T09:00:00.000Z",
};

describe("AgentMoveTargetSchema (usage heads-up)", () => {
  it("still reads a target from a host that sends no run-out or window label", () => {
    expect(AgentMoveTargetSchema.parse(TARGET)).toEqual(TARGET);
  });

  it("keeps the run-out and the window label", () => {
    const withPace = { ...TARGET, runsOutAt: "2026-11-06T14:00:00.000Z", windowLabel: "Weekly" };
    expect(AgentMoveTargetSchema.parse(withPace)).toEqual(withPace);
    const unknown = { ...TARGET, runsOutAt: null, windowLabel: null };
    expect(AgentMoveTargetSchema.parse(unknown)).toEqual(unknown);
  });
});
