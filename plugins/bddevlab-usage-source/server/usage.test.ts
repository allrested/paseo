import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discover, fetchUsage } from "./usage.js";

const USAGE_URL = "https://api.bddevlab.online/api/usage/token/";
const input = { store: "env" as const, locator: "BDDEVLAB_API_KEY" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("bddevlab usage source", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.BDDEVLAB_API_KEY;
    delete process.env.BDDEVLAB_API_KEY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.BDDEVLAB_API_KEY;
    else process.env.BDDEVLAB_API_KEY = original;
  });

  it("reports quota as credits", async () => {
    process.env.BDDEVLAB_API_KEY = "bd_test_token";
    const fetchApi = vi.fn(async () =>
      jsonResponse({
        code: true,
        message: "ok",
        data: {
          object: "token_usage",
          name: "500M",
          total_granted: 500_000_000,
          total_used: 120_500_000,
          total_available: 379_500_000,
          unlimited_quota: false,
        },
      }),
    );

    expect(await fetchUsage(input, fetchApi as unknown as typeof fetch)).toEqual({
      status: "available",
      planLabel: "500M",
      windows: [],
      balances: [
        {
          id: "credits",
          label: "Credits",
          used: 1205,
          remaining: 3795,
          limit: 5000,
          unit: "credits",
          tone: "ok",
        },
      ],
      details: [],
    });
    expect(fetchApi).toHaveBeenCalledWith(
      USAGE_URL,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({ Authorization: "Bearer bd_test_token" }),
      }),
    );
  });

  it("drops the limit when the key has unlimited quota", async () => {
    process.env.BDDEVLAB_API_KEY = "bd_test_token";
    const report = await fetchUsage(input, async () =>
      jsonResponse({
        data: {
          name: "unlimited",
          total_granted: 0,
          total_used: 700_000,
          total_available: 0,
          unlimited_quota: true,
        },
      }),
    );

    expect(report).toMatchObject({
      status: "available",
      balances: [{ id: "credits", used: 7, remaining: null, limit: null, tone: "default" }],
      details: [{ id: "quota", label: "Quota", value: "Unlimited" }],
    });
  });

  it("reports a rejected key as unavailable", async () => {
    process.env.BDDEVLAB_API_KEY = "bd_bad_token";
    expect(
      await fetchUsage(input, async () => jsonResponse({ message: "unauthorized" }, 401)),
    ).toEqual({ status: "unavailable", problem: { kind: "rejected", status: 401 } });
  });

  it("discovers nothing without BDDEVLAB_API_KEY", async () => {
    expect(await discover({ kind: "global" })).toEqual([]);
  });

  it("follows sessions whose model is billed through the gateway, whatever CLI runs them", async () => {
    process.env.BDDEVLAB_API_KEY = "bd_test_token";
    const account = { key: "default", input };
    expect(await discover({ kind: "global" })).toEqual([account]);
    expect(
      await discover({
        kind: "session",
        provider: "opencode",
        model: "bddevlab/claude-opus-5",
        env: {},
      }),
    ).toEqual([account]);
    expect(
      await discover({ kind: "session", provider: "opencode", model: "claude-opus-5", env: {} }),
    ).toEqual([]);
    expect(await discover({ kind: "session", provider: "claude", env: {} })).toEqual([]);
  });
});
