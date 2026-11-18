import { describe, expect, it } from "vitest";
import type { AgentAttentionNotificationPayload } from "./agent-attention-notification.js";
import { AgentAttentionRequiredMessageSchema, AgentStreamEventPayloadSchema } from "./messages.js";

const USAGE_NOTIFICATION: AgentAttentionNotificationPayload<"usage"> = {
  title: "Claude (work) 81% of Weekly",
  body: "Fix login",
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

  it("parses the same legacy agent stream event once its reason is finished", () => {
    expect(
      AgentStreamEventPayloadSchema.safeParse({
        type: "attention_required",
        provider: "claude",
        reason: "finished",
        timestamp: "2026-11-06T10:00:00.000Z",
        shouldNotify: false,
        notification: {
          ...USAGE_NOTIFICATION,
          data: { ...USAGE_NOTIFICATION.data, reason: "finished" },
        },
      }).success,
    ).toBe(true);
  });
});
