import { describe, expect, test } from "vitest";
import { createUsageLookup, toMoveTarget, type MoveTargetInput } from "./move-targets.js";

const info = {
  providerId: "claude-work",
  family: "claude",
  label: "Claude (work)",
  enabled: true,
  env: {},
};

test("uses the tightest usage window", () => {
  expect(
    toMoveTarget({
      info,
      status: "ready",
      currentProvider: "claude",
      windows: [
        { usedPct: 40, resetsAt: "2026-11-05T10:00:00Z" },
        { usedPct: 100, resetsAt: "2026-11-05T14:00:00Z" },
      ],
    }),
  ).toEqual({
    provider: "claude-work",
    label: "Claude (work)",
    family: "claude",
    available: true,
    current: false,
    usedPct: 100,
    resetsAt: "2026-11-05T14:00:00Z",
  });
});

test("reports unknown usage as null", () => {
  expect(
    toMoveTarget({ info, status: "ready", currentProvider: "claude-work", windows: null }),
  ).toMatchObject({
    current: true,
    usedPct: null,
  });
});

test("derives used percent from remaining percent when a window reports only that", () => {
  expect(
    toMoveTarget({
      info,
      status: "ready",
      currentProvider: "claude",
      windows: [
        { remainingPct: 75, resetsAt: "2026-11-05T10:00:00Z" },
        { usedPct: 10, remainingPct: 0, resetsAt: "2026-11-05T14:00:00Z" },
      ],
    }),
  ).toMatchObject({ usedPct: 25, resetsAt: "2026-11-05T10:00:00Z" });
});

test("marks a target unavailable when its CLI is missing or its catalog failed, and keeps a loading one selectable", () => {
  const availability = (status: MoveTargetInput["status"], enabled = true) =>
    toMoveTarget({ info: { ...info, enabled }, status, currentProvider: "claude", windows: null })
      .available;

  expect(availability("ready")).toBe(true);
  expect(availability("loading")).toBe(true);
  expect(availability(null)).toBe(true);
  expect(availability("unavailable")).toBe(false);
  expect(availability("error")).toBe(false);
  expect(availability("ready", false)).toBe(false);
});

describe("createUsageLookup", () => {
  test("reuses a result within the TTL and reloads after it", async () => {
    let clock = 0;
    let loads = 0;
    const lookup = createUsageLookup<number>({ ttlMs: 60_000, now: () => clock });
    const load = async () => ++loads;

    expect(await lookup("claude", load)).toBe(1);
    clock = 59_999;
    expect(await lookup("claude", load)).toBe(1);
    expect(await lookup("codex", load)).toBe(2);
    clock = 60_000;
    expect(await lookup("claude", load)).toBe(3);
  });

  test("resolves a slow lookup to null and caches it once it lands", async () => {
    let finish: (value: string) => void = () => {};
    const slow = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const lookup = createUsageLookup<string>({ timeoutMs: 5 });

    expect(await lookup("claude", () => slow)).toBeNull();
    finish("late");
    await slow;
    expect(await lookup("claude", async () => "fresh")).toBe("late");
  });

  test("shares one lookup between concurrent callers for the same key", async () => {
    let loads = 0;
    const lookup = createUsageLookup<number>();
    const load = async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 1));
      return loads;
    };

    expect(await Promise.all([lookup("claude", load), lookup("claude", load)])).toEqual([1, 1]);
    expect(loads).toBe(1);
  });

  test("does not cache a failed lookup", async () => {
    const lookup = createUsageLookup<string>();

    await expect(lookup("claude", async () => Promise.reject(new Error("down")))).rejects.toThrow(
      "down",
    );
    expect(await lookup("claude", async () => "ok")).toBe("ok");
  });
});
