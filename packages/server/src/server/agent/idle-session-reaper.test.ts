import { expect, test } from "vitest";

import {
  DEFAULT_IDLE_MINUTES,
  idleReaperConfigFromEnv,
  selectIdleAgentsToReap,
  type ReapCandidate,
} from "./idle-session-reaper.js";

const NOW = new Date("2026-09-02T12:00:00.000Z");
const HOUR_MS = 60 * 60_000;

function candidate(overrides: Partial<ReapCandidate> = {}): ReapCandidate {
  return {
    id: "agent-1",
    lifecycle: "idle",
    // Two hours stale by default, so the base candidate is reapable.
    updatedAt: new Date(NOW.getTime() - 2 * HOUR_MS),
    activeForegroundTurnId: null,
    activeTurnId: null,
    pendingPermissionCount: 0,
    ...overrides,
  };
}

// ---- selection ------------------------------------------------------------

test("reaps an agent idle beyond the threshold", () => {
  expect(selectIdleAgentsToReap([candidate()], NOW, HOUR_MS)).toEqual(["agent-1"]);
});

test("leaves an agent that has not been idle long enough", () => {
  const fresh = candidate({ updatedAt: new Date(NOW.getTime() - 59 * 60_000) });
  expect(selectIdleAgentsToReap([fresh], NOW, HOUR_MS)).toEqual([]);
});

test("reaps exactly at the threshold, not a millisecond before", () => {
  const atThreshold = candidate({ id: "at", updatedAt: new Date(NOW.getTime() - HOUR_MS) });
  const justUnder = candidate({ id: "under", updatedAt: new Date(NOW.getTime() - HOUR_MS + 1) });
  expect(selectIdleAgentsToReap([atThreshold, justUnder], NOW, HOUR_MS)).toEqual(["at"]);
});

test.each(["initializing", "running", "error", "closed"])(
  "never reaps a %s agent however stale",
  (lifecycle) => {
    const ancient = candidate({ lifecycle, updatedAt: new Date(0) });
    expect(selectIdleAgentsToReap([ancient], NOW, HOUR_MS)).toEqual([]);
  },
);

test("never reaps an agent with a foreground turn in flight", () => {
  // The lifecycle and turn fields are maintained separately, so a stale
  // lifecycle must not be enough on its own.
  const busy = candidate({ activeForegroundTurnId: "turn-9" });
  expect(selectIdleAgentsToReap([busy], NOW, HOUR_MS)).toEqual([]);
});

test("never reaps an agent with a background turn in flight", () => {
  const busy = candidate({ activeTurnId: "turn-9" });
  expect(selectIdleAgentsToReap([busy], NOW, HOUR_MS)).toEqual([]);
});

test("never reaps an agent awaiting a permission answer", () => {
  // Closing the session would silently cancel a question put to a human.
  const waiting = candidate({ pendingPermissionCount: 1 });
  expect(selectIdleAgentsToReap([waiting], NOW, HOUR_MS)).toEqual([]);
});

test("an updatedAt in the future does not read as infinitely idle", () => {
  const skewed = candidate({ updatedAt: new Date(NOW.getTime() + 10 * HOUR_MS) });
  expect(selectIdleAgentsToReap([skewed], NOW, HOUR_MS)).toEqual([]);
});

test("an invalid updatedAt is never reaped", () => {
  const broken = candidate({ updatedAt: new Date(Number.NaN) });
  expect(selectIdleAgentsToReap([broken], NOW, HOUR_MS)).toEqual([]);
});

test("a non-positive threshold reaps nothing", () => {
  expect(selectIdleAgentsToReap([candidate()], NOW, 0)).toEqual([]);
  expect(selectIdleAgentsToReap([candidate()], NOW, -1)).toEqual([]);
});

test("selects only the eligible agents out of a mixed set", () => {
  const agents = [
    candidate({ id: "stale-idle" }),
    candidate({ id: "fresh", updatedAt: NOW }),
    candidate({ id: "running", lifecycle: "running" }),
    candidate({ id: "permission", pendingPermissionCount: 2 }),
    candidate({ id: "also-stale", updatedAt: new Date(NOW.getTime() - 5 * HOUR_MS) }),
  ];
  expect(selectIdleAgentsToReap(agents, NOW, HOUR_MS)).toEqual(["stale-idle", "also-stale"]);
});

test("an empty candidate list is fine", () => {
  expect(selectIdleAgentsToReap([], NOW, HOUR_MS)).toEqual([]);
});

// ---- configuration --------------------------------------------------------

test("reaping is off unless explicitly configured", () => {
  expect(idleReaperConfigFromEnv({}).enabled).toBe(false);
  expect(idleReaperConfigFromEnv({ PASEO_IDLE_SESSION_REAP_MINUTES: "" }).enabled).toBe(false);
  expect(idleReaperConfigFromEnv({ PASEO_IDLE_SESSION_REAP_MINUTES: "   " }).enabled).toBe(false);
});

test.each(["nonsense", "0", "-30", "NaN", "Infinity"])(
  "a malformed threshold (%s) leaves reaping off rather than guessing",
  (value) => {
    expect(idleReaperConfigFromEnv({ PASEO_IDLE_SESSION_REAP_MINUTES: value }).enabled).toBe(false);
  },
);

test("a configured threshold is honoured in milliseconds", () => {
  const config = idleReaperConfigFromEnv({ PASEO_IDLE_SESSION_REAP_MINUTES: "90" });
  expect(config.enabled).toBe(true);
  expect(config.idleMs).toBe(90 * 60_000);
});

test("the sweep interval is derived from the threshold and bounded", () => {
  // Short threshold: floored so a tiny value cannot busy-spin the loop.
  const short = idleReaperConfigFromEnv({ PASEO_IDLE_SESSION_REAP_MINUTES: "1" });
  expect(short.sweepMs).toBe(30_000);

  // Long threshold: capped so a very large value still sweeps regularly.
  const long = idleReaperConfigFromEnv({ PASEO_IDLE_SESSION_REAP_MINUTES: "1440" });
  expect(long.sweepMs).toBe(5 * 60_000);

  // In between: a twelfth of the window.
  const middle = idleReaperConfigFromEnv({ PASEO_IDLE_SESSION_REAP_MINUTES: "60" });
  expect(middle.sweepMs).toBe(5 * 60_000);
});

test("a fractional threshold is accepted and rounded", () => {
  const config = idleReaperConfigFromEnv({ PASEO_IDLE_SESSION_REAP_MINUTES: "1.5" });
  expect(config.enabled).toBe(true);
  expect(config.idleMs).toBe(90_000);
});

test("the documented default is a whole number of minutes", () => {
  expect(Number.isInteger(DEFAULT_IDLE_MINUTES)).toBe(true);
  expect(DEFAULT_IDLE_MINUTES).toBeGreaterThan(0);
});
