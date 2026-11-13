import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderUsageWindow, UsageReportEntry } from "@getpaseo/protocol/messages";
import {
  createDaemonTestContext,
  type DaemonTestContext,
} from "../../test-utils/daemon-test-context.js";
import { startUsageLimitFallback } from "./usage-limit-fallback.js";

// Turns run in the daemon; under load they take longer than the 1s waitFor default.
const WAIT = { timeout: 10_000 };
const NOW = new Date("2026-11-13T08:00:00.000Z");
const FAIL_PROMPT = "Emit a turn failure: connection reset by peer";
const OK_PROMPT = "Reply with OK. Do not use tools.";

function weeklyReport(window: Partial<ProviderUsageWindow>): UsageReportEntry[] {
  return [
    {
      id: "claude:work",
      account: {},
      fetchedAt: NOW.toISOString(),
      sourceId: "claude",
      sourceLabel: "Claude",
      report: {
        status: "available",
        windows: [
          { id: "weekly", label: "Weekly", resetsAt: "2026-11-14T09:00:00.000Z", ...window },
        ],
      },
    },
  ];
}

describe("usage limit fallback", () => {
  let ctx: DaemonTestContext;
  let stop: (() => void) | null = null;
  let usageReads: string[];

  beforeEach(async () => {
    ctx = await createDaemonTestContext();
    usageReads = [];
  });

  afterEach(async () => {
    stop?.();
    stop = null;
    await ctx.cleanup();
  });

  function manager() {
    return ctx.daemon.daemon.agentManager;
  }

  function start(input: {
    usage: (agentId: string) => Promise<UsageReportEntry[]>;
    usageEnabled?: boolean;
  }): void {
    stop = startUsageLimitFallback({
      agentManager: manager(),
      usageEnabled: () => input.usageEnabled ?? true,
      listAgentUsage: (agentId) => {
        usageReads.push(agentId);
        return input.usage(agentId);
      },
      now: () => NOW,
      logger: { warn: () => {} },
    });
  }

  async function createAgent(): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), "usage-limit-fallback-"));
    const agent = await ctx.client.createAgent({
      config: { provider: "claude", cwd, modeId: "bypassPermissions" },
    });
    return agent.id;
  }

  async function failTurn(agentId: string): Promise<void> {
    await manager()
      .runAgent(agentId, FAIL_PROMPT)
      .catch(() => {});
    await vi.waitFor(() => {
      expect(manager().getAgent(agentId)?.lastError).toBe("connection reset by peer");
    }, WAIT);
  }

  /** Lets a usage read that already resolved reach its decision. */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  }

  it("flags the limit when a turn fails on an unknown error and the account's window is spent", async () => {
    start({ usage: async () => weeklyReport({ usedPct: 100 }) });
    const agentId = await createAgent();

    await failTurn(agentId);

    await vi.waitFor(() => {
      expect(manager().getAgent(agentId)?.limitReached).toEqual({
        at: NOW.toISOString(),
        message: "connection reset by peer",
      });
    }, WAIT);
  });

  it("reads a window that reports only what remains", async () => {
    start({ usage: async () => weeklyReport({ remainingPct: 0 }) });
    const agentId = await createAgent();

    await failTurn(agentId);

    await vi.waitFor(() => {
      expect(manager().getAgent(agentId)?.limitReached?.message).toBe("connection reset by peer");
    }, WAIT);
  });

  it("leaves the agent alone while the account still has room", async () => {
    start({ usage: async () => weeklyReport({ usedPct: 99 }) });
    const agentId = await createAgent();

    await failTurn(agentId);
    await vi.waitFor(() => expect(usageReads).toEqual([agentId]), WAIT);
    await settle();

    expect(manager().getAgent(agentId)?.limitReached ?? null).toBeNull();
  });

  it("reads no usage when usage is turned off", async () => {
    start({ usage: async () => weeklyReport({ usedPct: 100 }), usageEnabled: false });
    const agentId = await createAgent();

    await failTurn(agentId);
    await settle();

    expect(usageReads).toEqual([]);
    expect(manager().getAgent(agentId)?.limitReached ?? null).toBeNull();
  });

  it("drops a report that arrives after the agent's next turn succeeded", async () => {
    let deliver!: (reports: UsageReportEntry[]) => void;
    const pending = new Promise<UsageReportEntry[]>((resolve) => {
      deliver = resolve;
    });
    start({ usage: () => pending });
    const agentId = await createAgent();

    await failTurn(agentId);
    await vi.waitFor(() => expect(usageReads).toEqual([agentId]), WAIT);
    await manager().runAgent(agentId, OK_PROMPT);
    deliver(weeklyReport({ usedPct: 100 }));
    await settle();

    expect(manager().getAgent(agentId)?.limitReached ?? null).toBeNull();
  });

  it("stays out of the way when the usage read fails", async () => {
    start({
      usage: async () => {
        throw new Error("usage source down");
      },
    });
    const agentId = await createAgent();

    await failTurn(agentId);
    await vi.waitFor(() => expect(usageReads).toEqual([agentId]), WAIT);
    await settle();

    expect(manager().getAgent(agentId)?.limitReached ?? null).toBeNull();
  });
});
