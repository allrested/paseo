import { describe, expect, it } from "vitest";
import {
  RUN_OUT_DANGER_MS,
  RUN_OUT_HEADS_UP_MS,
  chooseBestMoveTarget,
  chooseTightestWindow,
  msUntilRunOut,
  usageHeadsUpTone,
  usageLevel,
  windowUsedPct,
  type MoveTargetUsage,
  type UsagePace,
  type UsageWindowPace,
} from "./usage-heads-up.js";

const NOW = Date.parse("2026-11-06T10:00:00.000Z");
const MINUTE = 60_000;
const LATE_RESET = "2026-11-07T10:00:00.000Z";

function at(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

function pace(overrides: Partial<UsagePace>): UsagePace {
  return { usedPct: 50, resetsAt: LATE_RESET, runsOutAt: null, ...overrides };
}

function target(overrides: Partial<MoveTargetUsage> & { provider: string }): MoveTargetUsage {
  return { family: "claude", available: true, current: false, usedPct: null, ...overrides };
}

/** A usage window with the label its source gives it. */
interface LabelledWindow extends UsageWindowPace {
  label: string;
}

function usageWindow(label: string, fields: UsageWindowPace): LabelledWindow {
  return { label, ...fields };
}

describe("windowUsedPct", () => {
  it("reads used percent, or derives it from remaining percent", () => {
    expect(windowUsedPct({ usedPct: 40, remainingPct: 10 })).toBe(40);
    expect(windowUsedPct({ remainingPct: 75 })).toBe(25);
    expect(windowUsedPct({ usedPct: null, remainingPct: null })).toBeNull();
  });
});

describe("usageLevel", () => {
  it("steps at 80% and 95%", () => {
    expect([null, 79.9, 80, 94.9, 95, 100].map(usageLevel)).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe("msUntilRunOut", () => {
  it("counts down to a run-out that comes before the reset", () => {
    expect(msUntilRunOut(pace({ runsOutAt: at(90 * MINUTE) }), NOW)).toBe(90 * MINUTE);
  });

  it("is null without a run-out, or with one at or after the reset", () => {
    expect(msUntilRunOut(pace({}), NOW)).toBeNull();
    expect(
      msUntilRunOut(pace({ runsOutAt: at(60 * MINUTE), resetsAt: at(60 * MINUTE) }), NOW),
    ).toBeNull();
    expect(
      msUntilRunOut(pace({ runsOutAt: at(61 * MINUTE), resetsAt: at(60 * MINUTE) }), NOW),
    ).toBeNull();
  });

  it("keeps a run-out without a known reset, and reads a passed one as now", () => {
    expect(msUntilRunOut(pace({ resetsAt: null, runsOutAt: at(5 * MINUTE) }), NOW)).toBe(
      5 * MINUTE,
    );
    expect(msUntilRunOut(pace({ runsOutAt: at(-5 * MINUTE) }), NOW)).toBe(0);
  });
});

describe("usageHeadsUpTone", () => {
  it("warns from 80% and turns to danger at 95%", () => {
    expect([79, 80, 94, 95].map((usedPct) => usageHeadsUpTone(pace({ usedPct }), NOW))).toEqual([
      "none",
      "warning",
      "warning",
      "danger",
    ]);
  });

  it("warns on pace to run out within 3 hours, and turns to danger within 30 minutes", () => {
    const runningOut = (ms: number) =>
      usageHeadsUpTone(pace({ usedPct: 60, runsOutAt: at(ms) }), NOW);
    expect(runningOut(RUN_OUT_HEADS_UP_MS + MINUTE)).toBe("none");
    expect(runningOut(RUN_OUT_HEADS_UP_MS)).toBe("warning");
    expect(runningOut(RUN_OUT_DANGER_MS + MINUTE)).toBe("warning");
    expect(runningOut(RUN_OUT_DANGER_MS)).toBe("danger");
  });

  it("ignores a run-out that falls after the reset", () => {
    expect(
      usageHeadsUpTone(
        pace({ usedPct: 60, runsOutAt: at(20 * MINUTE), resetsAt: at(10 * MINUTE) }),
        NOW,
      ),
    ).toBe("none");
  });
});

describe("chooseBestMoveTarget", () => {
  const current = target({ provider: "claude-work", current: true, usedPct: 84 });

  it("picks the available target with the lowest usage", () => {
    const kiro = target({ provider: "kiro", family: "kiro", usedPct: 12 });
    expect(
      chooseBestMoveTarget([
        current,
        target({ provider: "codex", family: "codex", usedPct: 40 }),
        kiro,
      ]),
    ).toBe(kiro);
  });

  it("skips the current, unavailable and used-up targets", () => {
    expect(
      chooseBestMoveTarget([
        current,
        target({ provider: "codex", family: "codex", usedPct: 5, available: false }),
        target({ provider: "kiro", family: "kiro", usedPct: 100 }),
      ]),
    ).toBeNull();
  });

  it("never suggests an account at or above the current one's usage", () => {
    expect(
      chooseBestMoveTarget([current, target({ provider: "codex", family: "codex", usedPct: 84 })]),
    ).toBeNull();
  });

  it("gives a tie to the current account's family, because that move is native", () => {
    const personal = target({ provider: "claude-personal", usedPct: 12 });
    expect(
      chooseBestMoveTarget([
        current,
        target({ provider: "kiro", family: "kiro", usedPct: 12 }),
        personal,
      ]),
    ).toBe(personal);
  });

  it("ranks a target with unknown usage after every known one, and offers it when nothing else has room", () => {
    const opencode = target({ provider: "opencode", family: "opencode", usedPct: null });
    const kiro = target({ provider: "kiro", family: "kiro", usedPct: 70 });
    expect(chooseBestMoveTarget([current, opencode, kiro])).toBe(kiro);
    expect(chooseBestMoveTarget([current, opencode])).toBe(opencode);
  });

  it("ranks a target on pace to run out after a steady one, and offers it when nothing else has room", () => {
    const steady = target({ provider: "codex", family: "codex", usedPct: 40 });
    const pacing = target({
      provider: "kiro",
      family: "kiro",
      usedPct: 12,
      runsOutAt: at(20 * MINUTE),
    });
    expect(chooseBestMoveTarget([current, pacing, steady])).toBe(steady);
    expect(chooseBestMoveTarget([current, pacing])).toBe(pacing);
  });

  it("moves an account on pace to run out to a fuller steady target below the heads-up level", () => {
    const running = target({
      provider: "claude-work",
      current: true,
      usedPct: 60,
      runsOutAt: at(20 * MINUTE),
    });
    const weekly = target({ provider: "codex", family: "codex", usedPct: 70 });
    expect(chooseBestMoveTarget([running, weekly])).toBe(weekly);
    expect(
      chooseBestMoveTarget([
        target({ provider: "claude-work", current: true, usedPct: 60 }),
        weekly,
      ]),
    ).toBeNull();
    expect(
      chooseBestMoveTarget([running, target({ provider: "kiro", family: "kiro", usedPct: 80 })]),
    ).toBeNull();
    expect(
      chooseBestMoveTarget([
        running,
        target({ provider: "kiro", family: "kiro", usedPct: 70, runsOutAt: at(40 * MINUTE) }),
      ]),
    ).toBeNull();
  });
});

describe("chooseTightestWindow", () => {
  it("picks the fullest window while none has a heads-up, and the first of a tie", () => {
    const session = usageWindow("Session", { usedPct: 40, resetsAt: LATE_RESET });
    const weekly = usageWindow("Weekly", { remainingPct: 30, resetsAt: LATE_RESET });
    const monthly = usageWindow("Monthly", { usedPct: 70, resetsAt: LATE_RESET });
    expect(chooseTightestWindow([session, weekly, monthly], NOW)).toEqual({
      window: weekly,
      usedPct: 70,
      resetsAt: LATE_RESET,
      runsOutAt: null,
      tone: "none",
    });
  });

  it("ranks a 60% window that runs out in 20 minutes above a 75% one with no run-out", () => {
    const weekly = usageWindow("Weekly", { usedPct: 75, resetsAt: LATE_RESET });
    const session = usageWindow("Session", {
      usedPct: 60,
      resetsAt: at(240 * MINUTE),
      runsOutAt: at(20 * MINUTE),
    });
    expect(chooseTightestWindow([weekly, session], NOW)).toEqual({
      window: session,
      usedPct: 60,
      resetsAt: at(240 * MINUTE),
      runsOutAt: at(20 * MINUTE),
      tone: "danger",
    });
  });

  it("keeps a used-up window tightest, and breaks a tie on the sooner run-out", () => {
    const usedUp = usageWindow("Session", { usedPct: 100, resetsAt: at(120 * MINUTE) });
    const runningOut = usageWindow("Weekly", {
      usedPct: 96,
      resetsAt: LATE_RESET,
      runsOutAt: at(10 * MINUTE),
    });
    expect(chooseTightestWindow([runningOut, usedUp], NOW)?.window).toBe(usedUp);

    const later = usageWindow("Weekly", {
      usedPct: 85,
      resetsAt: LATE_RESET,
      runsOutAt: at(150 * MINUTE),
    });
    const sooner = usageWindow("Monthly", {
      usedPct: 85,
      resetsAt: LATE_RESET,
      runsOutAt: at(100 * MINUTE),
    });
    expect(chooseTightestWindow([later, sooner], NOW)?.window).toBe(sooner);
  });

  it("skips a window without a used share and drops a run-out that falls after the reset", () => {
    const extra = usageWindow("Extra usage", {});
    expect(chooseTightestWindow([extra], NOW)).toBeNull();
    const weekly = usageWindow("Weekly", {
      usedPct: 50,
      resetsAt: at(60 * MINUTE),
      runsOutAt: at(90 * MINUTE),
    });
    expect(chooseTightestWindow([extra, weekly], NOW)).toEqual({
      window: weekly,
      usedPct: 50,
      resetsAt: at(60 * MINUTE),
      runsOutAt: null,
      tone: "none",
    });
  });
});
