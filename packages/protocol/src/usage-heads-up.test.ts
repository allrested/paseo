import { describe, expect, it } from "vitest";
import { usageLevel, windowUsedPct } from "./usage-heads-up.js";

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
