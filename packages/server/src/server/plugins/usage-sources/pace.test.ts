import { describe, expect, test } from "vitest";
import type { ProviderUsageWindow } from "@getpaseo/protocol/messages";
import { createUsagePace, type UsagePaceTracker } from "./pace.js";

const T0 = Date.parse("2026-11-06T10:00:00.000Z");
const MINUTE = 60_000;
const RESETS_AT = "2026-11-06T14:00:00.000Z";
const KEY = "claude:work:weekly";

function weekly(overrides: Partial<ProviderUsageWindow> = {}): ProviderUsageWindow {
  return { id: "weekly", label: "Weekly", resetsAt: RESETS_AT, ...overrides };
}

/** Feeds `[minutes after T0, window]` samples in order and returns the last projection. */
function feed(
  pace: UsagePaceTracker,
  samples: Array<[number, ProviderUsageWindow]>,
): ProviderUsageWindow | null {
  let last: ProviderUsageWindow | null = null;
  for (const [minutes, window] of samples) {
    last = pace.project({ key: KEY, window, at: T0 + minutes * MINUTE });
  }
  return last;
}

describe("createUsagePace", () => {
  test("projects the run-out from the slope between the oldest and newest sample", () => {
    expect(
      feed(createUsagePace(), [
        [0, weekly({ usedPct: 50 })],
        [10, weekly({ usedPct: 58 })],
        [20, weekly({ usedPct: 60 })],
      ]),
    ).toEqual(weekly({ usedPct: 60, runsOutAt: "2026-11-06T11:40:00.000Z", shortfallPct: 70 }));
  });

  test("leaves a single sample unprojected", () => {
    expect(feed(createUsagePace(), [[0, weekly({ usedPct: 50 })]])).toEqual(
      weekly({ usedPct: 50 }),
    );
  });

  test("needs the oldest and newest sample ten minutes apart", () => {
    expect(
      feed(createUsagePace(), [
        [0, weekly({ usedPct: 50 })],
        [9, weekly({ usedPct: 60 })],
      ]),
    ).toEqual(weekly({ usedPct: 60 }));
    expect(
      feed(createUsagePace(), [
        [0, weekly({ usedPct: 50 })],
        [10, weekly({ usedPct: 60 })],
      ]),
    ).toEqual(weekly({ usedPct: 60, runsOutAt: "2026-11-06T10:50:00.000Z", shortfallPct: 190 }));
  });

  test("leaves runsOutAt empty when the run-out falls after the reset", () => {
    expect(
      feed(createUsagePace(), [
        [0, weekly({ usedPct: 10 })],
        [60, weekly({ usedPct: 11 })],
      ]),
    ).toEqual(weekly({ usedPct: 11 }));
  });

  test("starts the samples over after a drop, which is a reset", () => {
    const pace = createUsagePace();
    expect(
      feed(pace, [
        [0, weekly({ usedPct: 50 })],
        [20, weekly({ usedPct: 90 })],
        [30, weekly({ usedPct: 5 })],
        [35, weekly({ usedPct: 10 })],
      ]),
    ).toEqual(weekly({ usedPct: 10 }));
    expect(feed(pace, [[45, weekly({ usedPct: 15 })]])).toEqual(
      weekly({ usedPct: 15, runsOutAt: "2026-11-06T12:52:30.000Z", shortfallPct: 45 }),
    );
  });

  test("keeps the run-out a source set itself", () => {
    const own = weekly({ usedPct: 60, runsOutAt: "2026-11-06T13:00:00.000Z", shortfallPct: 3 });
    expect(
      feed(createUsagePace(), [
        [0, weekly({ usedPct: 50 })],
        [20, own],
      ]),
    ).toEqual(own);
  });

  test("derives used percent from remaining percent", () => {
    expect(
      feed(createUsagePace(), [
        [0, weekly({ remainingPct: 50 })],
        [20, weekly({ remainingPct: 40 })],
      ]),
    ).toEqual(
      weekly({ remainingPct: 40, runsOutAt: "2026-11-06T11:40:00.000Z", shortfallPct: 70 }),
    );
  });

  test("projects nothing without a reset time, for a used-up window, or for flat usage", () => {
    expect(
      feed(createUsagePace(), [
        [0, weekly({ usedPct: 50, resetsAt: null })],
        [20, weekly({ usedPct: 60, resetsAt: null })],
      ]),
    ).toEqual(weekly({ usedPct: 60, resetsAt: null }));
    expect(
      feed(createUsagePace(), [
        [0, weekly({ usedPct: 90 })],
        [20, weekly({ usedPct: 100 })],
      ]),
    ).toEqual(weekly({ usedPct: 100 }));
    expect(
      feed(createUsagePace(), [
        [0, weekly({ usedPct: 50 })],
        [20, weekly({ usedPct: 50 })],
      ]),
    ).toEqual(weekly({ usedPct: 50 }));
  });

  test("uses only the samples of the last two hours", () => {
    const late = (usedPct: number) => weekly({ usedPct, resetsAt: "2026-11-06T18:00:00.000Z" });
    expect(
      feed(createUsagePace(), [
        [0, late(20)],
        [90, late(50)],
        [130, late(60)],
      ]),
    ).toEqual({ ...late(60), runsOutAt: "2026-11-06T14:50:00.000Z", shortfallPct: 47.5 });
  });

  test("ignores a sample older than the newest instead of reading it as a reset", () => {
    expect(
      feed(createUsagePace(), [
        [0, weekly({ usedPct: 40 })],
        [20, weekly({ usedPct: 60 })],
        [10, weekly({ usedPct: 45 })],
      ]),
    ).toEqual(weekly({ usedPct: 45 }));
    const pace = createUsagePace();
    feed(pace, [
      [0, weekly({ usedPct: 40 })],
      [20, weekly({ usedPct: 60 })],
      [10, weekly({ usedPct: 45 })],
    ]);
    expect(feed(pace, [[30, weekly({ usedPct: 70 })]])).toEqual(
      weekly({ usedPct: 70, runsOutAt: "2026-11-06T11:00:00.000Z", shortfallPct: 180 }),
    );
  });

  test("keeps account windows apart and forgets a removed source's windows", () => {
    const pace = createUsagePace();
    pace.project({ key: "claude:work:weekly", window: weekly({ usedPct: 50 }), at: T0 });
    pace.project({ key: "codex:work:weekly", window: weekly({ usedPct: 10 }), at: T0 });
    pace.forget("claude:");
    const later = T0 + 20 * MINUTE;
    expect(
      pace.project({ key: "claude:work:weekly", window: weekly({ usedPct: 60 }), at: later }),
    ).toEqual(weekly({ usedPct: 60 }));
    expect(
      pace.project({ key: "codex:work:weekly", window: weekly({ usedPct: 20 }), at: later }),
    ).toEqual(weekly({ usedPct: 20, runsOutAt: "2026-11-06T13:00:00.000Z", shortfallPct: 30 }));
  });
});
