import { describe, expect, test } from "vitest";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("usage.provider.list_reports messages", () => {
  test("parses the request inside the session inbound union", () => {
    const request = {
      type: "usage.provider.list_reports.request",
      requestId: "usage-one",
      provider: "claude-work",
    };

    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  test("parses a response with reports and the tightest window", () => {
    const response = {
      type: "usage.provider.list_reports.response",
      payload: {
        requestId: "usage-one",
        provider: "claude-work",
        reports: [
          {
            id: "claude:work",
            account: { label: "work" },
            fetchedAt: "2026-11-06T00:00:00.000Z",
            sourceId: "claude",
            sourceLabel: "Claude",
            report: {
              status: "available",
              planLabel: "Max",
              windows: [
                {
                  id: "weekly",
                  label: "Weekly",
                  usedPct: 70,
                  resetsAt: "2026-11-10T00:00:00.000Z",
                },
              ],
            },
          },
        ],
        tightest: {
          label: "Weekly",
          usedPct: 70,
          resetsAt: "2026-11-10T00:00:00.000Z",
          tone: "none",
        },
        error: null,
      },
    };

    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  test("parses an error response without reports", () => {
    const response = {
      type: "usage.provider.list_reports.response",
      payload: {
        requestId: "usage-gone",
        provider: "claude-gone",
        reports: [],
        tightest: null,
        error: "Unknown provider: claude-gone",
      },
    };

    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  test("keeps the usageProviderReports feature flag", () => {
    const info = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "srv_usage",
      features: { usageProviderReports: true },
    });

    expect(info.features?.usageProviderReports).toBe(true);
  });
});
