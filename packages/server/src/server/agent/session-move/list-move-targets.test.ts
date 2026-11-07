import { expect, test } from "vitest";
import type { ProviderUsageWindow, UsageReportEntry } from "@getpaseo/protocol/messages";
import type { ProviderSnapshotEntry } from "../agent-sdk-types.js";
import type { ProviderLaunchInfo } from "../provider-snapshot-manager.js";
import {
  listAgentMoveTargets,
  type ListMoveTargetsInput,
  type UsageScopeQuery,
} from "./list-move-targets.js";

const NOW = Date.parse("2026-11-06T10:00:00.000Z");
const WEEKLY_RESET = "2026-11-07T09:00:00.000Z";
const WORK_DIR = "/home/me/.claude-work";

const CLAUDE: ProviderLaunchInfo = {
  providerId: "claude",
  family: "claude",
  label: "Claude",
  enabled: true,
  env: {},
};

const WORK: ProviderLaunchInfo = {
  providerId: "claude-work",
  family: "claude",
  label: "Claude (work)",
  enabled: true,
  env: { CLAUDE_CONFIG_DIR: WORK_DIR },
};

const READY = new Map<string, ProviderSnapshotEntry["status"]>([
  ["claude", "ready"],
  ["claude-work", "ready"],
]);

function entry(windows: ProviderUsageWindow[]): UsageReportEntry {
  return {
    id: "claude:account",
    account: {},
    fetchedAt: "2026-11-06T09:59:00.000Z",
    sourceId: "claude",
    sourceLabel: "Claude",
    report: { status: "available", windows },
  };
}

function input(overrides: Partial<ListMoveTargetsInput>): ListMoveTargetsInput {
  return {
    agentId: "agent-1",
    findAgent: async () => ({ provider: "claude", cwd: "/repo" }),
    providers: { statusesIn: () => READY, launchInfos: () => [CLAUDE, WORK] },
    usageEnabled: true,
    listUsageReportsForScope: async () => [],
    usageLookup: (_key, load) => load(),
    logger: { warn: () => undefined },
    now: NOW,
    ...overrides,
  };
}

test("lists every provider with the tightest window of its own account, read by family and profile env", async () => {
  const scopes: UsageScopeQuery[] = [];
  const targets = await listAgentMoveTargets(
    input({
      listUsageReportsForScope: async (scope) => {
        scopes.push(scope);
        return scope.env.CLAUDE_CONFIG_DIR
          ? [entry([{ id: "weekly", label: "Weekly", usedPct: 12, resetsAt: WEEKLY_RESET }])]
          : [
              entry([
                {
                  id: "weekly",
                  label: "Weekly",
                  usedPct: 84,
                  resetsAt: WEEKLY_RESET,
                  runsOutAt: "2026-11-06T14:00:00.000Z",
                },
              ]),
            ];
      },
    }),
  );

  expect(scopes).toEqual([
    { provider: "claude", env: {} },
    { provider: "claude", env: { CLAUDE_CONFIG_DIR: WORK_DIR } },
  ]);
  expect(targets).toEqual([
    {
      provider: "claude",
      label: "Claude",
      family: "claude",
      available: true,
      current: true,
      usedPct: 84,
      resetsAt: WEEKLY_RESET,
      runsOutAt: "2026-11-06T14:00:00.000Z",
      windowLabel: "Weekly",
    },
    {
      provider: "claude-work",
      label: "Claude (work)",
      family: "claude",
      available: true,
      current: false,
      usedPct: 12,
      resetsAt: WEEKLY_RESET,
      runsOutAt: null,
      windowLabel: "Weekly",
    },
  ]);
});

test("judges availability from the provider snapshot of the agent's own directory", async () => {
  const cwds: string[] = [];
  const statuses = new Map<string, ProviderSnapshotEntry["status"]>([
    ["claude", "ready"],
    ["claude-work", "unavailable"],
  ]);
  const targets = await listAgentMoveTargets(
    input({
      providers: {
        statusesIn: (cwd) => {
          cwds.push(cwd);
          return statuses;
        },
        launchInfos: () => [CLAUDE, WORK],
      },
    }),
  );

  expect(cwds).toEqual(["/repo"]);
  expect(targets.map((target) => [target.provider, target.available])).toEqual([
    ["claude", true],
    ["claude-work", false],
  ]);
});

test("reads no usage while the host's usage check is off", async () => {
  const scopes: UsageScopeQuery[] = [];
  const targets = await listAgentMoveTargets(
    input({
      usageEnabled: false,
      listUsageReportsForScope: async (scope) => {
        scopes.push(scope);
        return [];
      },
    }),
  );

  expect(scopes).toEqual([]);
  expect(targets.map((target) => target.usedPct)).toEqual([null, null]);
});

test("lists a target with unknown usage when its lookup fails, and logs the failure", async () => {
  const warnings: string[] = [];
  const targets = await listAgentMoveTargets(
    input({
      listUsageReportsForScope: async () => {
        throw new Error("vendor down");
      },
      logger: {
        warn: (_details: unknown, message?: string) => {
          warnings.push(message ?? "");
        },
      },
    }),
  );

  expect(targets.map((target) => [target.provider, target.usedPct])).toEqual([
    ["claude", null],
    ["claude-work", null],
  ]);
  expect(warnings).toEqual([
    "move targets: usage lookup failed",
    "move targets: usage lookup failed",
  ]);
});

test("refuses an agent it cannot find", async () => {
  await expect(listAgentMoveTargets(input({ findAgent: async () => null }))).rejects.toThrow(
    "Agent not found: agent-1",
  );
});
