import pino from "pino";
import { expect, test } from "vitest";
import type { UsageReportEntry } from "@getpaseo/protocol/messages";
import type { UsageScopeQuery } from "../../agent/session-move/list-move-targets.js";
import type { SessionOutboundMessage } from "../../messages.js";
import { UsageSession, tightestUsageWindow } from "./usage-session.js";

test("lists reports from usage sources", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const requested: Array<{ forceRefresh?: boolean; reportIds?: string[] }> = [];
  const entry = {
    id: "fixture:one",
    account: {},
    fetchedAt: "2026-01-01T00:00:00.000Z",
    sourceId: "fixture",
    sourceLabel: "Fixture",
    report: { status: "available" as const, windows: [] },
  };
  const usage = new UsageSession({
    isEnabled: () => true,
    emit: (message) => emitted.push(message),
    runtime: {
      async listUsageReports(options) {
        requested.push({ forceRefresh: options.forceRefresh, reportIds: options.reportIds });
        options.onReport?.(entry);
        return [entry];
      },
      async listLegacyUsage() {
        return { fetchedAt: "2026-01-01T00:00:00.000Z", providers: [] };
      },
    },
    logger: pino({ level: "silent" }),
  });

  await usage.handleListReports({ type: "usage.list_reports.request", requestId: "list" });
  expect(requested).toEqual([{ forceRefresh: undefined, reportIds: undefined }]);
  expect(emitted).toEqual([
    { type: "usage.list_reports.update", payload: { requestId: "list", report: entry } },
    { type: "usage.list_reports.response", payload: { requestId: "list", error: null } },
  ]);
});

test("surfaces a legacy usage-list failure as an rpc_error envelope", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const usage = new UsageSession({
    isEnabled: () => true,
    emit: (message) => emitted.push(message),
    runtime: {
      async listUsageReports() {
        return [];
      },
      async listLegacyUsage(): Promise<never> {
        throw new Error("quota service down");
      },
    },
    logger: pino({ level: "silent" }),
  });
  await usage.handleLegacyList({ type: "provider.usage.list.request", requestId: "u1" });
  expect(emitted[0]).toMatchObject({
    type: "rpc_error",
    payload: { requestId: "u1", code: "provider_usage_list_failed" },
  });
});

test("request failures terminate with an error response and no updates", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const usage = new UsageSession({
    isEnabled: () => true,
    emit: (message) => emitted.push(message),
    logger: pino({ level: "silent" }),
  });
  await usage.handleListReports({ type: "usage.list_reports.request", requestId: "failed" });
  expect(emitted).toEqual([
    {
      type: "usage.list_reports.response",
      payload: { requestId: "failed", error: "Plugin runtime is unavailable" },
    },
  ]);
});

test("off rejects both protocols before runtime discovery and turning on restores reports", async () => {
  let enabled = false;
  let calls = 0;
  const emitted: SessionOutboundMessage[] = [];
  const usage = new UsageSession({
    isEnabled: () => enabled,
    emit: (message) => emitted.push(message),
    logger: pino({ level: "silent" }),
    runtime: {
      async listUsageReports() {
        calls++;
        return [];
      },
      async listLegacyUsage() {
        calls++;
        return { fetchedAt: "now", providers: [] };
      },
    },
  });
  await usage.handleListReports({ type: "usage.list_reports.request", requestId: "off" });
  await usage.handleLegacyList({ type: "provider.usage.list.request", requestId: "old" });
  expect(calls).toBe(0);
  expect(emitted[0]).toMatchObject({ payload: { error: "Usage is off on this host." } });
  expect(emitted[1]).toMatchObject({
    type: "rpc_error",
    payload: { error: "Usage is off on this host." },
  });
  enabled = true;
  await usage.handleListReports({ type: "usage.list_reports.request", requestId: "on" });
  expect(calls).toBe(1);
  expect(emitted[2]).toMatchObject({ payload: { error: null } });
});

function usageEntry(id: string, report: UsageReportEntry["report"]): UsageReportEntry {
  return {
    id,
    account: {},
    fetchedAt: "2026-11-06T00:00:00.000Z",
    sourceId: "claude",
    sourceLabel: "Claude",
    report,
  };
}

// The time the tightest-window tests judge run-outs at.
const NOW = Date.parse("2026-11-06T00:00:00.000Z");

// Session at 40% used and Weekly with 30% left: Weekly is the tightest at 70%.
const workReport = usageEntry("claude:work", {
  status: "available",
  planLabel: "Max",
  windows: [
    { id: "five_hour", label: "Session", usedPct: 40, resetsAt: "2026-11-06T05:00:00.000Z" },
    { id: "weekly", label: "Weekly", remainingPct: 30, resetsAt: "2026-11-10T00:00:00.000Z" },
  ],
});

interface ProviderReportsFixture {
  usage: UsageSession;
  emitted: SessionOutboundMessage[];
  scopes: UsageScopeQuery[];
  keys: string[];
}

function providerReportsFixture(
  lookup: (
    key: string,
    load: () => Promise<UsageReportEntry[]>,
  ) => Promise<UsageReportEntry[] | null>,
  enabled = true,
): ProviderReportsFixture {
  const emitted: SessionOutboundMessage[] = [];
  const scopes: UsageScopeQuery[] = [];
  const keys: string[] = [];
  const usage = new UsageSession({
    isEnabled: () => enabled,
    emit: (message) => emitted.push(message),
    logger: pino({ level: "silent" }),
    runtime: {
      async listUsageReports() {
        return [];
      },
      async listLegacyUsage() {
        return { fetchedAt: "now", providers: [] };
      },
      async listUsageReportsForScope(scope) {
        scopes.push(scope);
        return [workReport];
      },
    },
    resolveProviderScope: (provider) =>
      provider === "claude-work"
        ? { provider: "claude", env: { CLAUDE_CONFIG_DIR: "/home/u/.claude-work" } }
        : null,
    scopeLookup: (key, load) => {
      keys.push(key);
      return lookup(key, load);
    },
  });
  return { usage, emitted, scopes, keys };
}

test("lists one provider's reports through its launch scope and the shared lookup", async () => {
  const { usage, emitted, scopes, keys } = providerReportsFixture((_key, load) => load());

  await usage.handleProviderReports({
    type: "usage.provider.list_reports.request",
    requestId: "one",
    provider: "claude-work",
  });

  expect(keys).toEqual(["claude-work"]);
  expect(scopes).toEqual([
    { provider: "claude", env: { CLAUDE_CONFIG_DIR: "/home/u/.claude-work" } },
  ]);
  expect(emitted).toEqual([
    {
      type: "usage.provider.list_reports.response",
      payload: {
        requestId: "one",
        provider: "claude-work",
        reports: [workReport],
        tightest: {
          label: "Weekly",
          usedPct: 70,
          resetsAt: "2026-11-10T00:00:00.000Z",
          tone: "none",
        },
        error: null,
      },
    },
  ]);
});

test("reports an unknown provider without reading usage", async () => {
  const { usage, emitted, keys } = providerReportsFixture((_key, load) => load());

  await usage.handleProviderReports({
    type: "usage.provider.list_reports.request",
    requestId: "gone",
    provider: "claude-gone",
  });

  expect(keys).toEqual([]);
  expect(emitted).toEqual([
    {
      type: "usage.provider.list_reports.response",
      payload: {
        requestId: "gone",
        provider: "claude-gone",
        reports: [],
        tightest: null,
        error: "Unknown provider: claude-gone",
      },
    },
  ]);
});

test("treats a lookup that ran out of time as no reports", async () => {
  const { usage, emitted } = providerReportsFixture(async () => null);

  await usage.handleProviderReports({
    type: "usage.provider.list_reports.request",
    requestId: "slow",
    provider: "claude-work",
  });

  expect(emitted).toEqual([
    {
      type: "usage.provider.list_reports.response",
      payload: {
        requestId: "slow",
        provider: "claude-work",
        reports: [],
        tightest: null,
        error: null,
      },
    },
  ]);
});

test("usage off and a runtime without scoped reads refuse before any lookup", async () => {
  const off = providerReportsFixture((_key, load) => load(), false);
  await off.usage.handleProviderReports({
    type: "usage.provider.list_reports.request",
    requestId: "off",
    provider: "claude-work",
  });
  expect(off.keys).toEqual([]);
  expect(off.emitted).toEqual([
    {
      type: "usage.provider.list_reports.response",
      payload: {
        requestId: "off",
        provider: "claude-work",
        reports: [],
        tightest: null,
        error: "Usage is off on this host.",
      },
    },
  ]);

  const emitted: SessionOutboundMessage[] = [];
  const bare = new UsageSession({
    isEnabled: () => true,
    emit: (message) => emitted.push(message),
    logger: pino({ level: "silent" }),
    resolveProviderScope: () => ({ provider: "claude", env: {} }),
  });
  await bare.handleProviderReports({
    type: "usage.provider.list_reports.request",
    requestId: "bare",
    provider: "claude",
  });
  expect(emitted).toEqual([
    {
      type: "usage.provider.list_reports.response",
      payload: {
        requestId: "bare",
        provider: "claude",
        reports: [],
        tightest: null,
        error: "Plugin runtime is unavailable",
      },
    },
  ]);
});

test("the tightest window skips reports and windows without a used share", () => {
  expect(
    tightestUsageWindow(
      [
        usageEntry("rejected", {
          status: "unavailable",
          problem: { kind: "rejected", status: 401 },
        }),
        usageEntry("extra", {
          status: "available",
          windows: [{ id: "extra", label: "Extra usage" }],
        }),
      ],
      NOW,
    ),
  ).toBeNull();
  expect(
    tightestUsageWindow(
      [
        workReport,
        usageEntry("busy", {
          status: "available",
          windows: [{ id: "five_hour", label: "Session", usedPct: 85 }],
        }),
      ],
      NOW,
    ),
  ).toEqual({ label: "Session", usedPct: 85, resetsAt: null, tone: "warning" });
});

test("the tightest window is a 60% one that runs out in 20 minutes, not a 75% one that will not", () => {
  expect(
    tightestUsageWindow(
      [
        usageEntry("work", {
          status: "available",
          windows: [
            { id: "weekly", label: "Weekly", usedPct: 75, resetsAt: "2026-11-10T00:00:00.000Z" },
            {
              id: "five_hour",
              label: "Session",
              usedPct: 60,
              resetsAt: "2026-11-06T04:00:00.000Z",
              runsOutAt: "2026-11-06T00:20:00.000Z",
            },
          ],
        }),
      ],
      NOW,
    ),
  ).toEqual({
    label: "Session",
    usedPct: 60,
    resetsAt: "2026-11-06T04:00:00.000Z",
    tone: "danger",
  });
});
