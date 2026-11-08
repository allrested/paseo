import { describe, expect, it, vi } from "vitest";
import type { ProviderUsage, UsageReportEntry } from "./api.js";
import {
  DECIDE_TIMEOUT_MS,
  chooseAuto,
  chooseCreateProvider,
  summarizeUsage,
  type AccountHeadroom,
  type CreateRequest,
  type DefaultAccountDeps,
  type UsageSummary,
} from "./default-account.js";

function entry(report: UsageReportEntry["report"]): UsageReportEntry {
  return {
    id: "claude:test",
    account: {},
    fetchedAt: "2026-11-06T00:00:00.000Z",
    sourceId: "claude",
    sourceLabel: "Claude",
    report,
  };
}

const EXPIRED: UsageSummary = { known: false, expired: true, usage: null, tone: null };

const ACCOUNTS: AccountHeadroom[] = [
  { provider: "claude", usable: true, usedPct: 60, tone: "none" },
  { provider: "claude-work", usable: true, usedPct: 30, tone: "none" },
  { provider: "claude-off", usable: false, usedPct: 5, tone: "none" },
];

interface DepsFixture {
  deps: DefaultAccountDeps;
  headroomCalls: (string | null)[];
  errors: unknown[];
}

function fixture(
  setting: () => Promise<string | null>,
  movingCwd: string | null = null,
): DepsFixture {
  const headroomCalls: (string | null)[] = [];
  const errors: unknown[] = [];
  const deps: DefaultAccountDeps = {
    setting,
    headroom: async (only) => {
      headroomCalls.push(only);
      return only === null ? ACCOUNTS : ACCOUNTS.filter((account) => account.provider === only);
    },
    movingToMain: (cwd) => cwd === movingCwd,
    onError: (error) => errors.push(error),
    timeoutMs: DECIDE_TIMEOUT_MS,
  };
  return { deps, headroomCalls, errors };
}

function saved(value: string | null): () => Promise<string | null> {
  return async () => value;
}

const PLAIN: CreateRequest = { provider: "claude", cwd: "/repo" };

describe("summarizeUsage", () => {
  it("keeps the tightest window, its tone and the plan of an available report", () => {
    const usage: ProviderUsage = {
      reports: [
        entry({
          status: "available",
          planLabel: "Max",
          windows: [{ id: "weekly", label: "Weekly", usedPct: 70 }],
        }),
      ],
      tightest: { label: "Weekly", usedPct: 70, resetsAt: null, tone: "none" },
      error: null,
    };
    const expected: UsageSummary = {
      known: true,
      expired: false,
      usage: { usedPct: 70, windowLabel: "Weekly", planLabel: "Max" },
      tone: "none",
    };
    expect(summarizeUsage(usage)).toEqual(expected);
  });

  it("reads a rejected or expired login as expired", () => {
    const rejected = entry({ status: "unavailable", problem: { kind: "rejected", status: 401 } });
    const expired = entry({
      status: "unavailable",
      problem: { kind: "expired", expiresAt: "2026-11-01T00:00:00.000Z" },
    });
    expect(summarizeUsage({ reports: [rejected], tightest: null, error: null })).toEqual(EXPIRED);
    expect(summarizeUsage({ reports: [expired], tightest: null, error: null })).toEqual(EXPIRED);
  });

  it("knows nothing without reports", () => {
    expect(
      summarizeUsage({ reports: [], tightest: null, error: "Usage is off on this host." }),
    ).toEqual({ known: false, expired: false, usage: null, tone: null });
  });
});

describe("chooseAuto", () => {
  it("picks the lowest known share and keeps list order on ties", () => {
    expect(chooseAuto(ACCOUNTS)).toBe("claude-work");
    expect(
      chooseAuto([
        { provider: "claude", usable: true, usedPct: 40, tone: "none" },
        { provider: "claude-work", usable: true, usedPct: 40, tone: "none" },
      ]),
    ).toBe("claude");
  });

  it("skips an unusable account and one at 95% or more, which the daemon marks danger", () => {
    expect(
      chooseAuto([
        { provider: "claude", usable: true, usedPct: 95, tone: "danger" },
        { provider: "claude-work", usable: false, usedPct: 10, tone: "none" },
      ]),
    ).toBeNull();
  });

  it("skips an account on pace to run out within 30 minutes, such as 60% in 20 minutes", () => {
    // The daemon gives a 60% window that runs out in 20 minutes the danger tone (Task 1).
    expect(
      chooseAuto([
        { provider: "claude", usable: true, usedPct: 60, tone: "danger" },
        { provider: "claude-work", usable: true, usedPct: 75, tone: "none" },
      ]),
    ).toBe("claude-work");
  });

  it("keeps an account at 94% whose window will not run out", () => {
    expect(
      chooseAuto([{ provider: "claude-work", usable: true, usedPct: 94, tone: "warning" }]),
    ).toBe("claude-work");
  });

  it("never picks an account with unknown usage (Decision 12)", () => {
    expect(
      chooseAuto([{ provider: "claude-team", usable: true, usedPct: null, tone: null }]),
    ).toBeNull();
  });
});

describe("chooseCreateProvider", () => {
  it("leaves creations of other providers alone without reading the setting", async () => {
    const setting = vi.fn(saved("auto"));
    const { deps } = fixture(setting);

    expect(await chooseCreateProvider(deps, { provider: "codex", cwd: "/repo" })).toBe("codex");
    expect(await chooseCreateProvider(deps, { provider: "claude-work", cwd: "/repo" })).toBe(
      "claude-work",
    );
    expect(setting).not.toHaveBeenCalled();
  });

  it("keeps claude when the saved default is claude or invalid", async () => {
    const main = fixture(saved("claude"));
    expect(await chooseCreateProvider(main.deps, PLAIN)).toBe("claude");
    expect(main.headroomCalls).toEqual([]);

    const invalid = fixture(saved(null));
    expect(await chooseCreateProvider(invalid.deps, PLAIN)).toBe("claude");
    expect(invalid.headroomCalls).toEqual([]);
  });

  it("picks the account with the most room for Auto", async () => {
    const { deps, headroomCalls } = fixture(saved("auto"));

    expect(await chooseCreateProvider(deps, PLAIN)).toBe("claude-work");
    expect(headroomCalls).toEqual([null]);
  });

  it("applies an explicit default only while it is usable", async () => {
    const work = fixture(saved("claude-work"));
    expect(await chooseCreateProvider(work.deps, PLAIN)).toBe("claude-work");
    expect(work.headroomCalls).toEqual(["claude-work"]);

    expect(await chooseCreateProvider(fixture(saved("claude-off")).deps, PLAIN)).toBe("claude");
    expect(await chooseCreateProvider(fixture(saved("claude-gone")).deps, PLAIN)).toBe("claude");
  });

  it("keeps claude in a directory this plugin is moving an agent to claude", async () => {
    const setting = vi.fn(saved("claude-work"));
    const { deps } = fixture(setting, "/repo");

    expect(await chooseCreateProvider(deps, PLAIN)).toBe("claude");
    expect(await chooseCreateProvider(deps, { provider: "claude", cwd: "/other" })).toBe(
      "claude-work",
    );
    expect(setting).toHaveBeenCalledTimes(1);
  });

  it("keeps claude and reports the error when the choice fails", async () => {
    const failure = new Error("settings unreadable");
    const { deps, errors } = fixture(() => Promise.reject(failure));

    expect(await chooseCreateProvider(deps, PLAIN)).toBe("claude");
    expect(errors).toEqual([failure]);
  });

  it("keeps claude when the choice outlasts its timeout", async () => {
    const { deps, errors } = fixture(() => new Promise<string | null>(() => {}));

    // The setting never settles, so only the 20 ms timer can end the choice.
    await expect(chooseCreateProvider({ ...deps, timeoutMs: 20 }, PLAIN)).resolves.toBe("claude");
    expect(errors).toEqual([]);
  });
});
