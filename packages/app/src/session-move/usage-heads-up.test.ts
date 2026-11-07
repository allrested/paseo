import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentMoveTarget } from "@getpaseo/protocol/messages";
import { i18n } from "@/i18n/i18next";
import type { AgentMoveTargetsView } from "./move-targets";
import {
  describeUsageHeadsUp,
  isUsageHeadsUpDismissed,
  resolveUsageHeadsUp,
  type FormatClock,
  type UsageHeadsUp,
  type UsageHeadsUpDismissal,
} from "./usage-heads-up";

// Thursday 2026-11-05, 08:00 UTC.
const NOW = Date.parse("2026-11-05T08:00:00.000Z");
const RUNS_OUT = "2026-11-05T14:00:00.000Z";
const RESETS = "2026-11-06T09:00:00.000Z";
const IN_TWO_HOURS = "2026-11-05T10:00:00.000Z";
const IN_TWENTY_MINUTES = "2026-11-05T08:20:00.000Z";
const PASSED = "2026-11-05T07:00:00.000Z";

const CLOCK = new Map<string, string>([
  [RUNS_OUT, "Thu 14:00"],
  [RESETS, "Fri 09:00"],
]);

const formatClock: FormatClock = (iso) => (iso === null ? null : (CLOCK.get(iso) ?? null));

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

function current(overrides: Partial<AgentMoveTarget> = {}): AgentMoveTarget {
  return target({
    provider: "claude-work",
    label: "Claude (work)",
    current: true,
    usedPct: 84,
    resetsAt: RESETS,
    runsOutAt: RUNS_OUT,
    windowLabel: "Weekly",
    ...overrides,
  });
}

const KIRO: AgentMoveTarget = target({
  provider: "kiro",
  label: "Kiro CLI",
  family: "kiro",
  usedPct: 12,
});

const CLAUDE: AgentMoveTarget = target({ provider: "claude", label: "Claude", usedPct: 30 });

function ready(...targets: AgentMoveTarget[]): AgentMoveTargetsView {
  return { kind: "ready", targets };
}

function headsUp(overrides: Partial<UsageHeadsUp> = {}): UsageHeadsUp {
  return {
    windowKey: "claude-work\nWeekly",
    account: "Claude (work)",
    usedPct: 84,
    windowLabel: "Weekly",
    resetsAt: RESETS,
    runsOutAt: RUNS_OUT,
    tone: "warning",
    level: 1,
    best: KIRO,
    ...overrides,
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("resolveUsageHeadsUp", () => {
  it("warns about the agent's own account from 80% and suggests the target with the most room", () => {
    expect(resolveUsageHeadsUp(ready(current(), CLAUDE, KIRO), NOW)).toEqual(headsUp());
  });

  it("warns below 80% when the account runs out within 3 hours", () => {
    expect(
      resolveUsageHeadsUp(ready(current({ usedPct: 60, runsOutAt: IN_TWO_HOURS }), KIRO), NOW),
    ).toMatchObject({ tone: "warning", level: 0, runsOutAt: IN_TWO_HOURS });
  });

  it("turns danger at 95% or a run-out within 30 minutes", () => {
    expect(
      resolveUsageHeadsUp(ready(current({ usedPct: 95, runsOutAt: null }), KIRO), NOW),
    ).toMatchObject({ tone: "danger", level: 2 });
    expect(
      resolveUsageHeadsUp(ready(current({ usedPct: 60, runsOutAt: IN_TWENTY_MINUTES }), KIRO), NOW),
    ).toMatchObject({ tone: "danger", level: 0 });
  });

  it("shows nothing under 80% without a near run-out, with unknown usage or before the targets load", () => {
    expect(resolveUsageHeadsUp(ready(current({ usedPct: 79, runsOutAt: null }), KIRO), NOW)).toBe(
      null,
    );
    expect(resolveUsageHeadsUp(ready(current({ usedPct: null, runsOutAt: null })), NOW)).toBe(null);
    expect(resolveUsageHeadsUp(ready(KIRO), NOW)).toBeNull();
    expect(resolveUsageHeadsUp({ kind: "loading" }, NOW)).toBeNull();
  });

  it("suggests no move when every other target is full or fuller than the agent's account", () => {
    expect(
      resolveUsageHeadsUp(
        ready(current(), target({ provider: "kiro", usedPct: 100 }), { ...CLAUDE, usedPct: 90 }),
        NOW,
      ),
    ).toMatchObject({ best: null });
  });
});

describe("isUsageHeadsUpDismissed", () => {
  const dismissedAtWarning: UsageHeadsUpDismissal = { level: 1, resetsAt: RESETS };

  it("hides a dismissed heads-up until the window reaches the next level", () => {
    expect(
      isUsageHeadsUpDismissed({ headsUp: headsUp(), dismissal: dismissedAtWarning, now: NOW }),
    ).toBe(true);
    expect(
      isUsageHeadsUpDismissed({
        headsUp: headsUp({ tone: "danger", level: 2, usedPct: 96 }),
        dismissal: dismissedAtWarning,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("shows the heads-up again once the window has reset, and when it was never dismissed", () => {
    expect(
      isUsageHeadsUpDismissed({
        headsUp: headsUp(),
        dismissal: { level: 1, resetsAt: PASSED },
        now: NOW,
      }),
    ).toBe(false);
    expect(isUsageHeadsUpDismissed({ headsUp: headsUp(), dismissal: null, now: NOW })).toBe(false);
  });
});

describe("describeUsageHeadsUp", () => {
  it("names the account window, its run-out and reset, and the best target's usage", () => {
    expect(describeUsageHeadsUp(headsUp(), { t: i18n.t, formatClock, locale: "en" })).toEqual({
      message: "Claude (work) 84% of Weekly · on pace to run out Thu 14:00, resets Fri 09:00",
      moveLabel: "Move to Kiro CLI · 12%",
    });
  });

  it("leaves out what it does not know", () => {
    expect(
      describeUsageHeadsUp(
        headsUp({
          windowLabel: null,
          runsOutAt: null,
          resetsAt: null,
          best: { ...KIRO, usedPct: null },
        }),
        { t: i18n.t, formatClock, locale: "en" },
      ),
    ).toEqual({ message: "Claude (work) 84%", moveLabel: "Move to Kiro CLI" });
    expect(
      describeUsageHeadsUp(headsUp({ runsOutAt: PASSED, best: null }), {
        t: i18n.t,
        formatClock,
        locale: "en",
      }),
    ).toEqual({ message: "Claude (work) 84% of Weekly · resets Fri 09:00", moveLabel: null });
  });
});
