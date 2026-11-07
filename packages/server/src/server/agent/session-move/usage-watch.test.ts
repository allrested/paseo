import { describe, expect, it } from "vitest";
import type { Logger } from "pino";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { ProviderUsageWindow, UsageReportEntry } from "@getpaseo/protocol/messages";
import type { ProviderLaunchInfo } from "../provider-snapshot-manager.js";
import type { UsageScopeQuery } from "./list-move-targets.js";
import type { MoveTarget } from "./move-targets.js";
import {
  USAGE_WATCH_INTERVAL_MS,
  createUsageWatch,
  isWatchedAgent,
  startUsageWatch,
  type IntervalTimer,
  type UsageNotice,
  type UsageWatch,
  type UsageWatchDeps,
  type WatchCandidate,
  type WatchedAgent,
} from "./usage-watch.js";

const RESETS = "2026-11-07T09:00:00.000Z";

const WORK: ProviderLaunchInfo = {
  providerId: "claude-work",
  family: "claude",
  label: "Claude (work)",
  enabled: true,
  env: { CLAUDE_CONFIG_DIR: "/home/me/.claude-work" },
};

const CODEX: ProviderLaunchInfo = {
  providerId: "codex",
  family: "codex",
  label: "Codex",
  enabled: true,
  env: {},
};

const FIX_LOGIN: WatchedAgent = { id: "agent-1", provider: "claude-work", title: "Fix login" };

function moveTarget(overrides: Partial<MoveTarget> & { provider: string }): MoveTarget {
  return {
    label: overrides.provider,
    family: "claude",
    available: true,
    current: false,
    usedPct: null,
    resetsAt: null,
    runsOutAt: null,
    windowLabel: null,
    ...overrides,
  };
}

const CURRENT: MoveTarget = moveTarget({
  provider: "claude-work",
  label: "Claude (work)",
  current: true,
  usedPct: 81,
});
const CLAUDE: MoveTarget = moveTarget({ provider: "claude", label: "Claude", usedPct: 12 });

function weeklyReport(usedPct: number, family = "claude"): UsageReportEntry[] {
  const weekly: ProviderUsageWindow = { id: "weekly", label: "Weekly", usedPct, resetsAt: RESETS };
  return [
    {
      id: `${family}:work`,
      account: {},
      fetchedAt: "2026-11-06T10:00:00.000Z",
      sourceId: "claude",
      sourceLabel: "Claude",
      report: { status: "available", windows: [weekly] },
    },
  ];
}

function recordingLogger(logs: string[]): Pick<Logger, "info" | "warn"> {
  return {
    info: (_details: unknown, message?: string) => {
      logs.push(`info ${message ?? ""}`);
    },
    warn: (_details: unknown, message?: string) => {
      logs.push(`warn ${message ?? ""}`);
    },
  };
}

interface Harness {
  watch: UsageWatch;
  notices: UsageNotice[];
  scopes: UsageScopeQuery[];
  logs: string[];
  /** The weekly window's used percent, per CLI family; a family without one reports nothing. */
  usage: Map<string, number>;
}

function harness(overrides: Partial<UsageWatchDeps> = {}): Harness {
  const notices: UsageNotice[] = [];
  const scopes: UsageScopeQuery[] = [];
  const logs: string[] = [];
  const usage = new Map<string, number>();
  const deps: UsageWatchDeps = {
    runningAgents: async () => [FIX_LOGIN],
    launchInfo: (providerId) =>
      [WORK, CODEX].find((info) => info.providerId === providerId) ?? null,
    usageEnabled: () => true,
    listUsageReportsForScope: async (scope) => {
      scopes.push(scope);
      const usedPct = usage.get(scope.provider);
      return usedPct === undefined ? [] : weeklyReport(usedPct, scope.provider);
    },
    listMoveTargets: async () => [CURRENT, CLAUDE],
    notify: async (notice) => {
      notices.push(notice);
    },
    logger: recordingLogger(logs),
    ...overrides,
  };
  return { watch: createUsageWatch(deps), notices, scopes, logs, usage };
}

async function checkAt(subject: Harness, usedPcts: number[]): Promise<void> {
  for (const usedPct of usedPcts) {
    subject.usage.set("claude", usedPct);
    await subject.watch.check();
  }
}

describe("createUsageWatch", () => {
  it("notifies once when an account window crosses 80% and once more at 95%", async () => {
    const subject = harness();

    await checkAt(subject, [70, 81, 85, 96, 97]);

    expect(subject.notices).toEqual([
      {
        agentId: "agent-1",
        provider: "claude-work",
        title: "Claude (work) 81% of Weekly",
        body: "Fix login · Move to Claude · 12%",
      },
      {
        agentId: "agent-1",
        provider: "claude-work",
        title: "Claude (work) 96% of Weekly",
        body: "Fix login · Move to Claude · 12%",
      },
    ]);
    expect(subject.logs).toEqual(["info usage watch: notified", "info usage watch: notified"]);
  });

  it("counts the first reading as a crossing, and re-arms a window whose usage drops", async () => {
    const subject = harness();

    await checkAt(subject, [96, 10, 82]);

    expect(subject.notices.map((notice) => notice.title)).toEqual([
      "Claude (work) 96% of Weekly",
      "Claude (work) 82% of Weekly",
    ]);
  });

  it("reads each account once, for the first running agent on its provider", async () => {
    const subject = harness({
      runningAgents: async () => [
        FIX_LOGIN,
        { id: "agent-2", provider: "claude-work", title: "Docs" },
        { id: "agent-3", provider: "codex", title: null },
      ],
    });
    subject.usage.set("codex", 40);

    await checkAt(subject, [81]);

    expect(subject.scopes).toEqual([
      { provider: "claude", env: { CLAUDE_CONFIG_DIR: "/home/me/.claude-work" } },
      { provider: "codex", env: {} },
    ]);
    expect(subject.notices.map((notice) => notice.agentId)).toEqual(["agent-1"]);
  });

  it("reads nothing while usage is off or no agent runs", async () => {
    const off = harness({ usageEnabled: () => false });
    const idle = harness({ runningAgents: async () => [] });

    await checkAt(off, [99]);
    await checkAt(idle, [99]);

    expect([off.scopes, off.notices, idle.scopes, idle.notices]).toEqual([[], [], [], []]);
  });

  it("names an untitled agent, and leaves out the move when no target has room or the targets fail", async () => {
    const full = harness({
      runningAgents: async () => [{ ...FIX_LOGIN, title: null }],
      listMoveTargets: async () => [CURRENT, { ...CLAUDE, usedPct: 100 }],
    });
    const failing = harness({
      listMoveTargets: async () => {
        throw new Error("provider snapshot gone");
      },
    });

    await checkAt(full, [81]);
    await checkAt(failing, [81]);

    expect(full.notices.map((notice) => notice.body)).toEqual(["Agent"]);
    expect(failing.notices.map((notice) => notice.body)).toEqual(["Fix login"]);
    expect(failing.logs).toEqual([
      "warn usage watch: move targets failed",
      "info usage watch: notified",
    ]);
  });

  it("logs a failed account check and goes on to the next provider", async () => {
    const subject = harness({
      runningAgents: async () => [FIX_LOGIN, { id: "agent-3", provider: "codex", title: "Port" }],
      listUsageReportsForScope: async (scope) => {
        if (scope.provider === "claude") throw new Error("vendor down");
        return weeklyReport(81, "codex");
      },
      listMoveTargets: async () => [],
    });

    await subject.watch.check();

    expect(subject.notices).toEqual([
      { agentId: "agent-3", provider: "codex", title: "Codex 81% of Weekly", body: "Port" },
    ]);
    expect(subject.logs).toEqual(["warn usage watch: check failed", "info usage watch: notified"]);
  });

  it("notifies once per account window when two providers read the same login", async () => {
    const personal: ProviderLaunchInfo = {
      ...WORK,
      providerId: "claude-personal",
      label: "Claude (personal)",
    };
    const subject = harness({
      runningAgents: async () => [
        FIX_LOGIN,
        { id: "agent-2", provider: "claude-personal", title: "Docs" },
      ],
      launchInfo: (providerId) =>
        [WORK, personal].find((info) => info.providerId === providerId) ?? null,
    });

    await checkAt(subject, [81, 96]);

    expect(subject.notices.map((notice) => [notice.agentId, notice.title])).toEqual([
      ["agent-1", "Claude (work) 81% of Weekly"],
      ["agent-1", "Claude (work) 96% of Weekly"],
    ]);
  });
});

class ManualTimer implements IntervalTimer {
  readonly intervals: number[] = [];
  stops = 0;
  private readonly ticks: Array<() => void> = [];

  every(input: { ms: number; tick: () => void }): () => void {
    this.intervals.push(input.ms);
    this.ticks.push(input.tick);
    return () => {
      this.stops += 1;
    };
  }

  fire(): void {
    for (const tick of this.ticks) tick();
  }
}

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("startUsageWatch", () => {
  it("checks on each tick, skips a tick while a check still runs, and stops", async () => {
    const timer = new ManualTimer();
    const logs: string[] = [];
    let checks = 0;
    let finish: () => void = () => {};
    const watch: UsageWatch = {
      check: () => {
        checks += 1;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    };

    const stop = startUsageWatch({ watch, logger: recordingLogger(logs), timer });
    timer.fire();
    await settle();
    timer.fire();
    await settle();
    const checksWhileBusy = checks;
    finish();
    await settle();
    timer.fire();
    await settle();
    stop();

    expect(timer.intervals).toEqual([USAGE_WATCH_INTERVAL_MS]);
    expect(logs).toEqual(["info usage watch: started"]);
    expect([checksWhileBusy, checks, timer.stops]).toEqual([1, 2, 1]);
  });

  it("logs a failed check instead of letting it escape", async () => {
    const timer = new ManualTimer();
    const logs: string[] = [];
    const watch: UsageWatch = {
      check: async () => {
        throw new Error("boom");
      },
    };

    startUsageWatch({ watch, logger: recordingLogger(logs), timer, intervalMs: 1_000 });
    timer.fire();
    await settle();

    expect(timer.intervals).toEqual([1_000]);
    expect(logs).toEqual(["info usage watch: started", "warn usage watch: tick failed"]);
  });
});

describe("isWatchedAgent", () => {
  const running: WatchCandidate = { lifecycle: "running", workspaceId: "ws-1", labels: {} };

  it("watches a running agent in a workspace", () => {
    expect(isWatchedAgent(running)).toBe(true);
  });

  it("skips idle, internal, background, delegated and workspace-less agents", () => {
    const skipped: WatchCandidate[] = [
      { ...running, lifecycle: "idle" },
      { ...running, internal: true },
      { ...running, background: true },
      { ...running, labels: { [PARENT_AGENT_ID_LABEL]: "parent-1" } },
      { ...running, workspaceId: undefined },
    ];
    expect(skipped.map((agent) => isWatchedAgent(agent))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
