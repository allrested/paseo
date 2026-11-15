import { describe, expect, it } from "vitest";
import type { AgentMoveTarget } from "@getpaseo/protocol/messages";
import type { MoveBannerFacts } from "./move-banner-facts";
import { resolveHeadsUpHandoff, resolveLimitHandoff } from "./handoff-view";
import { resolveMoveBannerKind, resolveMoveBannerView } from "./move-banner-view";
import type { AgentMoveTargetsView } from "./move-targets";
import type { UsageHeadsUp } from "./usage-heads-up";

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

const HEADS_UP: UsageHeadsUp = {
  windowKey: "claude-work\nWeekly",
  account: "Claude (work)",
  usedPct: 84,
  windowLabel: "Weekly",
  resetsAt: TARGET_RESETS_AT,
  runsOutAt: null,
  tone: "warning",
  level: 1,
  best: null,
};

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
      resolveMoveBannerView({
        headsUp: null,
        facts: facts(),
        targets: readyTargets(currentTarget(100)),
      }),
    ).toEqual({ kind: "none" });
  });

  it("shows nothing for an inactive agent", () => {
    expect(
      resolveMoveBannerView({
        headsUp: null,
        facts: INACTIVE,
        targets: readyTargets(currentTarget(100)),
      }),
    ).toEqual({ kind: "none" });
  });

  it("shows the agent's own account and where its chat can continue when it hit the limit", () => {
    const targets = readyTargets(
      target({ provider: "codex", family: "codex" }),
      currentTarget(100),
    );

    expect(resolveMoveBannerView({ headsUp: null, facts: limited, targets })).toEqual({
      kind: "limit",
      handoff: resolveLimitHandoff({ provider: "claude-work", targets }),
    });
  });

  it("shows the limit while the targets load or the host is away", () => {
    const views: AgentMoveTargetsView[] = [LOADING_TARGETS, { kind: "disconnected" }];
    expect(
      views.map((targets) => resolveMoveBannerView({ headsUp: null, facts: limited, targets })),
    ).toEqual(
      views.map((targets) => ({
        kind: "limit",
        handoff: resolveLimitHandoff({ provider: "claude-work", targets }),
      })),
    );
  });

  it("shows the limit rather than the move back for a moved agent at its limit", () => {
    const targets = readyTargets(currentTarget(100));

    expect(
      resolveMoveBannerView({
        headsUp: null,
        facts: facts({
          hasReachedLimit: true,
          movedFromAgentId: "original",
          movedFromProvider: "claude",
        }),
        targets,
      }),
    ).toEqual({
      kind: "limit",
      handoff: resolveLimitHandoff({ provider: "claude-work", targets }),
    });
  });

  it("shows the heads-up for an agent that is neither limited nor moved", () => {
    expect(
      resolveMoveBannerView({
        headsUp: HEADS_UP,
        facts: facts(),
        targets: readyTargets(currentTarget(84)),
      }),
    ).toEqual({
      kind: "heads-up",
      headsUp: HEADS_UP,
      handoff: resolveHeadsUpHandoff(HEADS_UP),
    });
  });

  it("keeps the limit notice ahead of the heads-up", () => {
    const view = resolveMoveBannerView({
      headsUp: HEADS_UP,
      facts: limited,
      targets: readyTargets(currentTarget(100)),
    });

    expect(view.kind).toBe("limit");
  });

  it("puts the heads-up ahead of Moved from", () => {
    expect(
      resolveMoveBannerView({
        headsUp: HEADS_UP,
        facts: facts({ movedFromAgentId: "original", movedFromProvider: "claude" }),
        targets: readyTargets(currentTarget(84)),
      }),
    ).toEqual({
      kind: "heads-up",
      headsUp: HEADS_UP,
      handoff: resolveHeadsUpHandoff(HEADS_UP),
    });
  });

  it("shows no heads-up for an inactive agent", () => {
    expect(
      resolveMoveBannerView({
        headsUp: HEADS_UP,
        facts: INACTIVE,
        targets: readyTargets(currentTarget(84)),
      }),
    ).toEqual({ kind: "none" });
  });

  describe("after a move", () => {
    const moved = facts({ movedFromAgentId: "original", movedFromProvider: "claude" });

    function viewWithOriginal(usedPct: number | null) {
      return resolveMoveBannerView({
        headsUp: null,
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
      expect(
        resolveMoveBannerView({ headsUp: null, facts: moved, targets: LOADING_TARGETS }),
      ).toEqual({
        kind: "moved-from",
        label: "claude",
        highlighted: false,
      });
    });

    it("has no label until the original is in the session", () => {
      expect(
        resolveMoveBannerView({
          headsUp: null,
          facts: facts({ movedFromAgentId: "original" }),
          targets: readyTargets(currentTarget(10)),
        }),
      ).toEqual({ kind: "moved-from", label: null, highlighted: false });
    });
  });
});
