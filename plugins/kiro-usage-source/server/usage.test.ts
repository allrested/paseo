import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discover, fetchUsage, kiroDatabasePath } from "./usage.js";

// node:sqlite has no @types/node@20 typings; require it with a narrow local type.
const testRequire = createRequire(import.meta.url);
interface TestSqliteDb {
  exec(sql: string): void;
  prepare(sql: string): { run(...params: unknown[]): void };
  close(): void;
}

function writeKiroStore(home: string, token: object, profile?: object): string {
  const path = kiroDatabasePath(home);
  mkdirSync(dirname(path), { recursive: true });
  const { DatabaseSync } = testRequire("node:sqlite") as {
    DatabaseSync: new (path: string) => TestSqliteDb;
  };
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE auth_kv (key TEXT PRIMARY KEY, value TEXT)");
  db.exec("CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT)");
  db.prepare("INSERT INTO auth_kv (key, value) VALUES (?, ?)").run(
    "kirocli:odic:token",
    JSON.stringify(token),
  );
  if (profile)
    db.prepare("INSERT INTO state (key, value) VALUES (?, ?)").run(
      "api.codewhisperer.profile",
      JSON.stringify(profile),
    );
  db.close();
  return path;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("kiro usage source", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "usage-kiro-"));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("reads the Identity Center session and reports each usage breakdown as a balance", async () => {
    const path = writeKiroStore(
      home,
      { access_token: "kiro-token", region: "eu-central-1", expires_at: "2099-01-01T00:00:00Z" },
      { arn: "arn:aws:codewhisperer:eu-central-1:1:profile/P" },
    );
    const fetchApi = vi.fn(async () =>
      jsonResponse({
        nextDateReset: 1.7882208e9,
        subscriptionInfo: { subscriptionTitle: "KIRO PRO" },
        usageBreakdownList: [
          {
            resourceType: "CREDIT",
            displayName: "Credit",
            displayNamePlural: "Credits",
            currentUsage: 49,
            currentUsageWithPrecision: 49.32,
            usageLimit: 1000,
            usageLimitWithPrecision: 1000,
          },
          { resourceType: "AGENTIC_REQUEST", currentUsage: null, usageLimit: null },
        ],
      }),
    );

    const report = await fetchUsage(
      { store: "sqlite", locator: path },
      fetchApi as unknown as typeof fetch,
    );

    expect(report).toEqual({
      status: "available",
      planLabel: "KIRO PRO",
      windows: [],
      balances: [
        {
          id: "credit",
          label: "Credits",
          used: 49.32,
          remaining: 950.68,
          limit: 1000,
          unit: "credits",
          resetsAt: new Date(1.7882208e12).toISOString(),
          tone: "ok",
        },
      ],
      details: [],
    });
    expect(fetchApi).toHaveBeenCalledWith(
      "https://q.eu-central-1.amazonaws.com/",
      expect.objectContaining({
        method: "POST",
        signal: expect.any(AbortSignal),
        body: JSON.stringify({ profileArn: "arn:aws:codewhisperer:eu-central-1:1:profile/P" }),
      }),
    );
  });

  it("reports an expired session without calling the API", async () => {
    const path = writeKiroStore(home, {
      access_token: "kiro-token",
      expires_at: "2020-01-01T00:00:00Z",
    });
    const fetchApi = vi.fn();
    expect(
      await fetchUsage({ store: "sqlite", locator: path }, fetchApi as unknown as typeof fetch),
    ).toEqual({
      status: "unavailable",
      problem: { kind: "expired", expiresAt: "2020-01-01T00:00:00.000Z", refreshedBy: "kiro-cli" },
    });
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it("reports a rejected session as unavailable", async () => {
    const path = writeKiroStore(home, { access_token: "kiro-token" });
    expect(
      await fetchUsage({ store: "sqlite", locator: path }, async () => jsonResponse({}, 403)),
    ).toEqual({
      status: "unavailable",
      problem: { kind: "rejected", status: 403, refreshedBy: "kiro-cli" },
    });
  });

  it("discovers the login of Kiro sessions and of the daemon's home only", async () => {
    const path = writeKiroStore(home, { access_token: "kiro-token" });
    const account = { key: "default", input: { store: "sqlite", locator: path } };
    expect(await discover({ kind: "session", provider: "kiro", env: { HOME: home } })).toEqual([
      account,
    ]);
    expect(await discover({ kind: "session", provider: "claude", env: { HOME: home } })).toEqual(
      [],
    );
    const empty = mkdtempSync(join(tmpdir(), "usage-kiro-empty-"));
    try {
      expect(await discover({ kind: "session", provider: "kiro", env: { HOME: empty } })).toEqual(
        [],
      );
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
