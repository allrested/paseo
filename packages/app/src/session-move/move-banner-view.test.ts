import { describe, expect, it } from "vitest";
import type { AgentMoveTarget } from "@getpaseo/protocol/messages";
import type { MoveBannerFacts } from "./move-banner-facts";
import {
  resolveMoveBannerKind,
  resolveMoveBannerView,
  upcomingLimitReset,
} from "./move-banner-view";
import type { AgentMoveTargetsView } from "./move-targets";

const TARGET_RESETS_AT = "2026-11-06T15:00:00.000Z";

type LiveFacts = Extract<MoveBannerFacts, { kind: "live" }>;

function facts(overrides: Partial<Omit<LiveFacts, "kind">> = {}): MoveBannerFacts {
  return {
    kind: "live",
    provider: "claude-work",
    hasReachedLimit: false,
    movedFromAgentId: null,
    movedFromProvider: null,
    ...overrides,
  };
}

const INACTIVE: MoveBannerFacts = { kind: "inactive" };

function target(overrides: Partial<AgentMoveTarget> & { provider: string }): AgentMoveTarget {
  return {
    label: overrides.provider,
    family: "claude",
    available: true,
    current: false,
    usedPct: null,
    resetsAt: null,
    ...overrides,
  };
}

function readyTargets(...targets: AgentMoveTarget[]): AgentMoveTargetsView {
  return { kind: "ready", targets };
}

const LOADING_TARGETS: AgentMoveTargetsView = { kind: "loading" };

function currentTarget(usedPct: number | null): AgentMoveTarget {
  return target({
    provider: "claude-work",
    label: "Claude (work)",
    current: true,
    usedPct,
    resetsAt: TARGET_RESETS_AT,
  });
}

describe("resolveMoveBannerKind", () => {
  it("shows nothing for an agent that is neither limited nor moved", () => {
    expect(resolveMoveBannerKind(facts())).toBe("none");
  });

  it("shows nothing for an agent that is archived or not in the session", () => {
    expect(resolveMoveBannerKind(INACTIVE)).toBe("none");
  });

  it("shows the limit when the host reports the agent hit it", () => {
    expect(resolveMoveBannerKind(facts({ hasReachedLimit: true }))).toBe("limit");
  });

  it("offers the move back for an agent that was moved", () => {
    const moved = facts({ movedFromAgentId: "original", movedFromProvider: "claude" });
    expect(resolveMoveBannerKind(moved)).toBe("moved-from");
  });

  it("puts the limit ahead of the move back", () => {
    const movedAndLimited = facts({
      hasReachedLimit: true,
      movedFromAgentId: "original",
      movedFromProvider: "claude",
    });
    expect(resolveMoveBannerKind(movedAndLimited)).toBe("limit");
  });
});

describe("resolveMoveBannerView", () => {
  const limited = facts({ hasReachedLimit: true });

  it("shows nothing for an agent that is neither limited nor moved", () => {
    expect(
      resolveMoveBannerView({ facts: facts(), targets: readyTargets(currentTarget(100)) }),
    ).toEqual({ kind: "none" });
  });

  it("shows nothing for an inactive agent", () => {
    expect(
      resolveMoveBannerView({ facts: INACTIVE, targets: readyTargets(currentTarget(100)) }),
    ).toEqual({ kind: "none" });
  });

  it("names the agent's own target and its reset when that account is used up", () => {
    expect(
      resolveMoveBannerView({
        facts: limited,
        targets: readyTargets(target({ provider: "codex", family: "codex" }), currentTarget(100)),
      }),
    ).toEqual({ kind: "limit", account: "Claude (work)", resetsAt: TARGET_RESETS_AT });
  });

  it("names no reset when the agent's account is not used up", () => {
    expect(
      [99, null].map((usedPct) =>
        resolveMoveBannerView({ facts: limited, targets: readyTargets(currentTarget(usedPct)) }),
      ),
    ).toEqual([
      { kind: "limit", account: "Claude (work)", resetsAt: null },
      { kind: "limit", account: "Claude (work)", resetsAt: null },
    ]);
  });

  it("names the provider while the targets load or the host is away", () => {
    const views: AgentMoveTargetsView[] = [LOADING_TARGETS, { kind: "disconnected" }];
    expect(views.map((targets) => resolveMoveBannerView({ facts: limited, targets }))).toEqual([
      { kind: "limit", account: "claude-work", resetsAt: null },
      { kind: "limit", account: "claude-work", resetsAt: null },
    ]);
  });

  it("shows the limit rather than the move back for a moved agent at its limit", () => {
    expect(
      resolveMoveBannerView({
        facts: facts({
          hasReachedLimit: true,
          movedFromAgentId: "original",
          movedFromProvider: "claude",
        }),
        targets: readyTargets(currentTarget(100)),
      }),
    ).toEqual({ kind: "limit", account: "Claude (work)", resetsAt: TARGET_RESETS_AT });
  });

  describe("after a move", () => {
    const moved = facts({ movedFromAgentId: "original", movedFromProvider: "claude" });

    function viewWithOriginal(usedPct: number | null) {
      return resolveMoveBannerView({
        facts: moved,
        targets: readyTargets(
          currentTarget(10),
          target({ provider: "claude", label: "Claude", usedPct }),
        ),
      });
    }

    it("labels the original with its target", () => {
      expect(viewWithOriginal(100)).toEqual({
        kind: "moved-from",
        label: "Claude",
        highlighted: false,
      });
    });

    it("highlights the move back once the original's account is under its limit", () => {
      expect(viewWithOriginal(99)).toEqual({
        kind: "moved-from",
        label: "Claude",
        highlighted: true,
      });
    });

    it("does not highlight the move back while the original's usage is unknown", () => {
      expect(viewWithOriginal(null)).toEqual({
        kind: "moved-from",
        label: "Claude",
        highlighted: false,
      });
    });

    it("labels the original with its provider while the targets load", () => {
      expect(resolveMoveBannerView({ facts: moved, targets: LOADING_TARGETS })).toEqual({
        kind: "moved-from",
        label: "claude",
        highlighted: false,
      });
    });

    it("has no label until the original is in the session", () => {
      expect(
        resolveMoveBannerView({
          facts: facts({ movedFromAgentId: "original" }),
          targets: readyTargets(currentTarget(10)),
        }),
      ).toEqual({ kind: "moved-from", label: null, highlighted: false });
    });
  });
});

describe("upcomingLimitReset", () => {
  const resetAt = Date.parse(TARGET_RESETS_AT);

  it("keeps a reset that is still ahead", () => {
    expect(upcomingLimitReset(TARGET_RESETS_AT, resetAt - 60_000)).toBe(TARGET_RESETS_AT);
  });

  it("drops a reset that has passed, since nothing reads the targets again", () => {
    expect(upcomingLimitReset(TARGET_RESETS_AT, resetAt)).toBeNull();
    expect(upcomingLimitReset(TARGET_RESETS_AT, resetAt + 60_000)).toBeNull();
    expect(upcomingLimitReset(null, resetAt)).toBeNull();
  });
});
