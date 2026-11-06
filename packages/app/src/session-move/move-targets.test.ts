import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentMoveTarget } from "@getpaseo/protocol/messages";
import { i18n } from "@/i18n/i18next";
import {
  MOVE_BACK_RECHECK_MS,
  describeMoveTarget,
  findCurrentTarget,
  findTargetByProvider,
  groupTargetsByFamily,
  isSelectableTarget,
  moveTargetsRecheckMs,
  resolveMoveTargetsView,
  type AgentMoveTargetsView,
} from "./move-targets";

const NOW = Date.parse("2026-11-06T10:00:00.000Z");
const IN_TWO_HOURS = "2026-11-06T12:00:00.000Z";

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

const NOT_READY: AgentMoveTargetsView[] = [
  { kind: "loading" },
  { kind: "disconnected" },
  { kind: "error", message: "Unknown agent" },
];

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("describeMoveTarget", () => {
  function badgeOf(usedPct: number, resetsAt: string | null = null) {
    return describeMoveTarget(target({ provider: "codex", usedPct, resetsAt }), { now: NOW }).badge;
  }

  it("marks the agent's own target as current", () => {
    expect(
      describeMoveTarget(target({ provider: "claude", current: true, usedPct: 100 }), { now: NOW })
        .badge,
    ).toEqual({ label: "Current", variant: "muted" });
  });

  it("marks a target that cannot take the agent as unavailable", () => {
    expect(
      describeMoveTarget(target({ provider: "codex", available: false, usedPct: 10 }), {
        now: NOW,
      }).badge,
    ).toEqual({ label: "Unavailable", variant: "muted" });
  });

  it("shows no badge while the target's usage is unknown", () => {
    expect(describeMoveTarget(target({ provider: "codex" }), { now: NOW }).badge).toBeNull();
  });

  it("colours the usage the way the usage bars do", () => {
    expect([69, 70, 90, 91, 100].map((usedPct) => badgeOf(usedPct)?.variant)).toEqual([
      "muted",
      "warning",
      "warning",
      "error",
      "error",
    ]);
  });

  it("names the reset of a used-up target", () => {
    expect(badgeOf(100, IN_TWO_HOURS)?.label).toBe("100% used, resets in 2h");
  });

  it("names only the usage of a used-up target without a reset", () => {
    expect(badgeOf(100)?.label).toBe("100% used");
  });

  it("names only the usage of a target under its limit, even with a reset", () => {
    expect(badgeOf(40, IN_TWO_HOURS)?.label).toBe("40% used");
  });

  it("reads the badge after the target's label", () => {
    expect(
      describeMoveTarget(target({ provider: "codex", label: "Codex", usedPct: 40 }), { now: NOW })
        .accessibilityLabel,
    ).toBe("Codex, 40% used");
    expect(
      describeMoveTarget(target({ provider: "codex", label: "Codex" }), { now: NOW })
        .accessibilityLabel,
    ).toBe("Codex");
  });
});

describe("groupTargetsByFamily", () => {
  it("names each family after its base provider and keeps the order", () => {
    const groups = groupTargetsByFamily([
      target({ provider: "claude-work", label: "Claude (work)" }),
      target({ provider: "codex-team", label: "Codex (team)", family: "codex" }),
      target({ provider: "claude", label: "Claude" }),
    ]);
    const [claude, codex] = groups;
    expect(groups).toHaveLength(2);
    expect(claude).toMatchObject({ family: "claude", label: "Claude" });
    expect(claude?.targets.map((member) => member.provider)).toEqual(["claude-work", "claude"]);
    expect(codex).toMatchObject({ family: "codex", label: "codex" });
    expect(codex?.targets.map((member) => member.provider)).toEqual(["codex-team"]);
  });
});

describe("isSelectableTarget", () => {
  it("refuses the agent's own target and an unavailable one", () => {
    expect(isSelectableTarget(target({ provider: "codex" }))).toBe(true);
    expect(isSelectableTarget(target({ provider: "claude", current: true }))).toBe(false);
    expect(isSelectableTarget(target({ provider: "codex", available: false }))).toBe(false);
  });
});

describe("findCurrentTarget and findTargetByProvider", () => {
  const current = target({ provider: "claude-work", current: true });
  const codex = target({ provider: "codex", family: "codex" });
  const ready: AgentMoveTargetsView = { kind: "ready", targets: [codex, current] };

  it("find the agent's own target and a target by provider", () => {
    expect(findCurrentTarget(ready)).toBe(current);
    expect(findTargetByProvider(ready, "codex")).toBe(codex);
    expect(findTargetByProvider(ready, "gemini")).toBeNull();
    expect(findTargetByProvider(ready, null)).toBeNull();
  });

  it("find nothing until the targets are ready", () => {
    expect(NOT_READY.map((view) => findCurrentTarget(view))).toEqual([null, null, null]);
    expect(NOT_READY.map((view) => findTargetByProvider(view, "codex"))).toEqual([
      null,
      null,
      null,
    ]);
  });
});

describe("resolveMoveTargetsView", () => {
  const targets = [target({ provider: "codex" })];

  it("is ready once the targets load", () => {
    expect(resolveMoveTargetsView({ canRequest: true, data: targets, error: null })).toEqual({
      kind: "ready",
      targets,
    });
  });

  it("shows the host's refusal", () => {
    expect(
      resolveMoveTargetsView({
        canRequest: true,
        data: undefined,
        error: new Error("Unknown agent"),
      }),
    ).toEqual({ kind: "error", message: "Unknown agent" });
  });

  it("is loading until the host answers", () => {
    expect(resolveMoveTargetsView({ canRequest: true, data: undefined, error: null })).toEqual({
      kind: "loading",
    });
  });

  it("is disconnected without the host, even with targets loaded before", () => {
    expect(resolveMoveTargetsView({ canRequest: false, data: targets, error: null })).toEqual({
      kind: "disconnected",
    });
  });
});

describe("moveTargetsRecheckMs", () => {
  function recheck(usedPct: number | null) {
    return moveTargetsRecheckMs([target({ provider: "claude", usedPct })], "claude");
  }

  it("rechecks while the original's account is used up", () => {
    expect(recheck(100)).toBe(MOVE_BACK_RECHECK_MS);
  });

  it("stops once the original's account is under its limit", () => {
    expect(recheck(99.9)).toBe(false);
  });

  it("does not poll for usage it cannot read", () => {
    expect(recheck(null)).toBe(false);
    expect(moveTargetsRecheckMs([target({ provider: "codex", usedPct: 100 })], "claude")).toBe(
      false,
    );
    expect(moveTargetsRecheckMs(undefined, "claude")).toBe(false);
  });
});
