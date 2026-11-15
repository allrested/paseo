import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentMoveTarget } from "@getpaseo/protocol/messages";
import { i18n } from "@/i18n/i18next";
import { formatResetTime } from "@/usage/format";
import {
  describeHandoff,
  resolveHandoffLayout,
  resolveHeadsUpHandoff,
  resolveLimitHandoff,
  type HandoffView,
} from "./handoff-view";
import type { AgentMoveTargetsView } from "./move-targets";
import type { UsageHeadsUp } from "./usage-heads-up";

// Thursday 2026-11-05, 08:00 UTC.
const NOW = Date.parse("2026-11-05T08:00:00.000Z");
const RESETS = "2026-11-05T09:36:00.000Z";
const RUNS_OUT = "2026-11-05T08:20:00.000Z";
const PASSED = "2026-11-05T07:00:00.000Z";

function target(overrides: Partial<AgentMoveTarget> & { provider: string }): AgentMoveTarget {
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

function own(overrides: Partial<AgentMoveTarget> = {}): AgentMoveTarget {
  return target({
    provider: "claude",
    label: "Claude",
    current: true,
    usedPct: 100,
    resetsAt: RESETS,
    windowLabel: "5-hour",
    ...overrides,
  });
}

const WORK: AgentMoveTarget = target({
  provider: "claude-work",
  label: "Claude (work)",
  usedPct: 27,
  windowLabel: "Weekly",
});

function ready(...targets: AgentMoveTarget[]): AgentMoveTargetsView {
  return { kind: "ready", targets };
}

function limit(targets: AgentMoveTargetsView): HandoffView {
  return resolveLimitHandoff({ provider: "claude", targets });
}

function headsUp(overrides: Partial<UsageHeadsUp> = {}): UsageHeadsUp {
  return {
    windowKey: "claude\n5-hour",
    account: "Claude",
    usedPct: 84,
    windowLabel: "5-hour",
    resetsAt: RESETS,
    runsOutAt: null,
    tone: "warning",
    level: 1,
    best: WORK,
    ...overrides,
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("resolveLimitHandoff", () => {
  it("puts the agent's used-up account next to the account with the most room", () => {
    const full = target({ provider: "codex", label: "Codex", family: "codex", usedPct: 100 });

    expect(limit(ready(own(), full, WORK))).toEqual({
      reason: "limit",
      current: { label: "Claude", windowLabel: "5-hour", usedPct: 100 },
      resetsAt: RESETS,
      runsOutAt: null,
      next: { kind: "ready", target: WORK },
    });
  });

  it("names no reset while the account is not used up or its usage is unknown", () => {
    // A limit error under full usage, such as an HTTP 429, has no window that resets it.
    expect([99, null].map((usedPct) => limit(ready(own({ usedPct }), WORK)).resetsAt)).toEqual([
      null,
      null,
    ]);
  });

  it("has nowhere to go when every other account is full, signed out or unavailable", () => {
    const full = target({ provider: "codex", label: "Codex", family: "codex", usedPct: 100 });
    const signedOut = { ...WORK, available: false, signedOut: true };

    expect(limit(ready(own(), full, signedOut)).next).toEqual({ kind: "none" });
  });

  it("names the provider and waits while the accounts load", () => {
    expect(limit({ kind: "loading" })).toEqual({
      reason: "limit",
      current: { label: "claude", windowLabel: null, usedPct: null },
      resetsAt: null,
      runsOutAt: null,
      next: { kind: "loading" },
    });
  });

  it("says the accounts are unknown when the host is away or refuses", () => {
    const views: AgentMoveTargetsView[] = [
      { kind: "disconnected" },
      { kind: "error", message: "Agent not found" },
    ];

    expect(views.map((targets) => limit(targets).next)).toEqual([
      { kind: "unknown" },
      { kind: "unknown" },
    ]);
  });
});

describe("resolveHeadsUpHandoff", () => {
  it("carries the heads-up's account, timing and best target", () => {
    expect(resolveHeadsUpHandoff(headsUp({ tone: "danger", runsOutAt: RUNS_OUT }))).toEqual({
      reason: "danger",
      current: { label: "Claude", windowLabel: "5-hour", usedPct: 84 },
      resetsAt: RESETS,
      runsOutAt: RUNS_OUT,
      next: { kind: "ready", target: WORK },
    });
  });

  it("has nowhere to go when no target has room", () => {
    expect(resolveHeadsUpHandoff(headsUp({ best: null })).next).toEqual({ kind: "none" });
  });
});

describe("resolveHandoffLayout", () => {
  it("stacks the accounts in a phone or a narrow pane, where only the move keeps its name", () => {
    expect([326, 559].map(resolveHandoffLayout)).toEqual([
      { kind: "stacked", namedActions: false },
      { kind: "stacked", namedActions: false },
    ]);
  });

  it("puts the accounts side by side from 560, and names every action from 720", () => {
    expect([560, 719, 720, 820].map(resolveHandoffLayout)).toEqual([
      { kind: "wide", namedActions: false },
      { kind: "wide", namedActions: false },
      { kind: "wide", namedActions: true },
      { kind: "wide", namedActions: true },
    ]);
  });
});

describe("describeHandoff", () => {
  const options = { now: NOW, t: i18n.t, locale: "en" };

  it("says the limit, its reset and where the chat continues", () => {
    expect(describeHandoff(limit(ready(own(), WORK)), options)).toEqual({
      current: { name: "Claude", window: "5-hour", value: "100%", percent: 100, tone: "danger" },
      status: {
        alarm: "Limit reached",
        countdown: "resets in 1h 36m",
        atRisk: false,
        exactTime: formatResetTime(RESETS, NOW, i18n.t),
      },
      next: {
        name: "Claude (work)",
        window: "Weekly",
        value: "27%",
        percent: 27,
        tone: "default",
      },
      note: null,
      moveLabel: "Continue on Claude (work)",
    });
  });

  it("drops a reset that has passed: nothing reads the account again until the next turn", () => {
    const passed = limit(ready(own({ resetsAt: PASSED }), WORK));

    expect(describeHandoff(passed, options).status).toEqual({
      alarm: "Limit reached",
      countdown: null,
      atRisk: false,
      exactTime: null,
    });
  });

  it("draws no bar and no number for an account whose usage is not reported", () => {
    const unknown = limit(ready(own({ usedPct: null }), { ...WORK, usedPct: null }));
    const copy = describeHandoff(unknown, options);

    expect(copy.current).toEqual({
      name: "Claude",
      window: "5-hour",
      value: null,
      percent: 0,
      tone: "default",
    });
    expect(copy.next).toEqual({
      name: "Claude (work)",
      window: "Weekly",
      value: null,
      percent: 0,
      tone: "default",
    });
  });

  it("says why there is no account to continue on, and offers no move", () => {
    const full = { ...WORK, usedPct: 100 };
    const copies = [
      limit({ kind: "loading" }),
      limit(ready(own(), full)),
      limit({ kind: "disconnected" }),
    ].map((view) => describeHandoff(view, options));

    expect(copies.map((copy) => [copy.next, copy.note, copy.moveLabel])).toEqual([
      [null, "Checking other accounts...", null],
      [null, "No other account has room", null],
      [null, "Could not read the other accounts", null],
    ]);
  });

  it("counts down to the reset before the limit, and names the move as a choice", () => {
    const copy = describeHandoff(resolveHeadsUpHandoff(headsUp()), options);

    expect(copy.current).toEqual({
      name: "Claude",
      window: "5-hour",
      value: "84%",
      percent: 84,
      tone: "warning",
    });
    expect(copy.status).toEqual({
      alarm: null,
      countdown: "resets in 1h 36m",
      atRisk: false,
      exactTime: formatResetTime(RESETS, NOW, i18n.t),
    });
    expect(copy.moveLabel).toBe("Move to Claude (work)");
  });

  it("counts down to the run-out while the account is on pace to run out", () => {
    const atRisk = resolveHeadsUpHandoff(headsUp({ tone: "danger", runsOutAt: RUNS_OUT }));

    expect(describeHandoff(atRisk, options).status).toEqual({
      alarm: null,
      countdown: "runs out in 20m",
      atRisk: true,
      exactTime: `resets ${formatResetTime(RESETS, NOW, i18n.t)}`,
    });
  });
});
