import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  const noHome = () => ({ ...process.env, PASEO_HOME: join(tmpdir(), "bddevlab-usage-no-home") });

  it("discovers nothing without BDDEVLAB_API_KEY", async () => {
    expect(await discover({ kind: "global" }, noHome())).toEqual([]);
  });

  it("follows sessions whose model is billed through the gateway, whatever CLI runs them", async () => {
    process.env.BDDEVLAB_API_KEY = "bd_test_token";
    const account = { key: "default", input };
    expect(await discover({ kind: "global" }, noHome())).toEqual([account]);
    expect(
      await discover(
        {
          kind: "session",
          provider: "opencode",
          model: "bddevlab/claude-opus-5",
          env: {},
        },
        noHome(),
      ),
    ).toEqual([account]);
    expect(
      await discover(
        { kind: "session", provider: "opencode", model: "claude-opus-5", env: {} },
        noHome(),
      ),
    ).toEqual([]);
    expect(await discover({ kind: "session", provider: "claude", env: {} }, noHome())).toEqual([]);
  });
});

describe("a provider entry that points Claude Code at the gateway", () => {
  let home: string;
  let original: string | undefined;
  beforeEach(async () => {
    original = process.env.BDDEVLAB_API_KEY;
    delete process.env.BDDEVLAB_API_KEY;
    home = await mkdtemp(join(tmpdir(), "bddevlab-usage-"));
    await writeFile(
      join(home, "config.json"),
      JSON.stringify({
        agents: {
          providers: {
            "claude-api": {
              extends: "claude",
              env: {
                ANTHROPIC_BASE_URL: "https://api.bddevlab.online/",
                ANTHROPIC_AUTH_TOKEN: "bd_profile_token",
              },
            },
            zai: {
              extends: "claude",
              env: {
                ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
                ANTHROPIC_AUTH_TOKEN: "z",
              },
            },
          },
        },
      }),
    );
  });
  afterEach(async () => {
    if (original === undefined) delete process.env.BDDEVLAB_API_KEY;
    else process.env.BDDEVLAB_API_KEY = original;
    await rm(home, { recursive: true, force: true });
  });

  const env = () => ({ PASEO_HOME: home });
  const profile = {
    key: "provider.claude-api",
    label: "claude-api",
    input: { store: "provider" as const, locator: "claude-api" },
  };

  it("is an account of the host", async () => {
    expect(await discover({ kind: "global" }, env())).toEqual([profile]);
  });

  it("has a key the daemon accepts", async () => {
    // packages/plugin/src/server/usage.ts: [A-Za-z0-9._-]{1,128}
    for (const account of await discover({ kind: "global" }, env())) {
      expect(account.key).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
    }
  });

  it("is the account of a session launched with its endpoint and token", async () => {
    const launch = {
      ANTHROPIC_BASE_URL: "https://api.bddevlab.online",
      ANTHROPIC_AUTH_TOKEN: "bd_profile_token",
    };
    expect(
      await discover(
        { kind: "session", provider: "claude", model: "claude-fable-5.1[1m]", env: launch },
        env(),
      ),
    ).toEqual([profile]);
    // Another endpoint, or a token no entry carries, is not this account.
    expect(
      await discover(
        {
          kind: "session",
          provider: "claude",
          env: { ...launch, ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic" },
        },
        env(),
      ),
    ).toEqual([]);
    expect(
      await discover(
        { kind: "session", provider: "claude", env: { ...launch, ANTHROPIC_AUTH_TOKEN: "other" } },
        env(),
      ),
    ).toEqual([]);
  });

  it("reads the token from the entry when it fetches", async () => {
    const fetchApi = vi.fn(async () =>
      jsonResponse({
        data: { name: "plan", total_granted: 100_000, total_used: 0, total_available: 100_000 },
      }),
    );
    const report = await fetchUsage(profile.input, fetchApi as unknown as typeof fetch, env());
    expect(report).toMatchObject({ status: "available", planLabel: "plan" });
    expect(fetchApi).toHaveBeenCalledWith(
      USAGE_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer bd_profile_token" }),
      }),
    );
  });

  it("says so when the entry is gone", async () => {
    await expect(
      fetchUsage(
        { store: "provider", locator: "removed" },
        (async () => jsonResponse({})) as unknown as typeof fetch,
        env(),
      ),
    ).rejects.toThrow("BDDevLab login store no longer exists");
  });

  it("finds nothing without a host config", async () => {
    expect(await discover({ kind: "global" }, { PASEO_HOME: join(home, "missing") })).toEqual([]);
  });
});
