import { describe, expect, it } from "vitest";
import type { AgentAttentionNotificationPayload } from "./agent-attention-notification.js";
import {
  AgentAttentionRequiredMessageSchema,
  AgentMoveTargetSchema,
  AgentStreamEventPayloadSchema,
  type AgentMoveTarget,
} from "./messages.js";

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

const USAGE_NOTIFICATION: AgentAttentionNotificationPayload<"usage"> = {
  title: "Claude (work) 81% of Weekly",
  body: "Fix login · Move to Claude · 12%",
  data: { serverId: "srv-a", workspaceId: "ws-1", agentId: "agent-a", reason: "usage" },
};

describe("usage attention (usage heads-up)", () => {
  it("carries the usage reason on the dedicated attention message", () => {
    const message = {
      type: "agent_attention_required",
      payload: {
        agentId: "agent-a",
        reason: "usage",
        timestamp: "2026-11-06T10:00:00.000Z",
        shouldNotify: false,
        notification: USAGE_NOTIFICATION,
      },
    };
    expect(AgentAttentionRequiredMessageSchema.parse(message)).toEqual(message);
  });

  it("keeps the usage reason off the legacy agent stream event", () => {
    expect(
      AgentStreamEventPayloadSchema.safeParse({
        type: "attention_required",
        provider: "claude",
        reason: "usage",
        timestamp: "2026-11-06T10:00:00.000Z",
        shouldNotify: false,
        notification: USAGE_NOTIFICATION,
      }).success,
    ).toBe(false);
  });
});
