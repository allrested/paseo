import { resolveHeadsUpHandoff, resolveLimitHandoff, type HandoffView } from "./handoff-view";
import type { MoveBannerFacts } from "./move-banner-facts";
import type { UsageHeadsUp } from "./usage-heads-up";
import { USAGE_LIMIT_PCT, findTargetByProvider, type AgentMoveTargetsView } from "./move-targets";

export type MoveBannerKind = "none" | "limit" | "moved-from";

export type MoveBannerView =
  | { kind: "none" }
  | { kind: "limit"; handoff: HandoffView }
  | { kind: "heads-up"; headsUp: UsageHeadsUp; handoff: HandoffView }
  | { kind: "moved-from"; label: string | null; highlighted: boolean };

interface MoveBannerViewInput {
  facts: MoveBannerFacts;
  targets: AgentMoveTargetsView;
  /** The undismissed heads-up about the agent's own account; null on hosts without it. */
  headsUp: UsageHeadsUp | null;
}

/**
 * Which notice the banner shows, before the move targets that fill it in are loaded. The limit
 * comes from the host's `limitReached` alone, and wins over the move back.
 */
export function resolveMoveBannerKind(facts: MoveBannerFacts): MoveBannerKind {
  if (facts.kind === "inactive") return "none";
  if (facts.hasReachedLimit) return "limit";
  if (facts.movedFromAgentId !== null) return "moved-from";
  return "none";
}

/**
 * What the banner shows, in this order: the limit, the usage heads-up, then "Moved from". A limit
 * and a heads-up show the agent's own account next to the one its chat can continue on; a move
 * names the original's target, highlighted once its usage is known to be under the limit.
 */
export function resolveMoveBannerView(input: MoveBannerViewInput): MoveBannerView {
  const { facts, targets, headsUp } = input;
  if (facts.kind === "inactive") return { kind: "none" };
  const kind = resolveMoveBannerKind(facts);
  if (kind === "limit") {
    return { kind, handoff: resolveLimitHandoff({ provider: facts.provider, targets }) };
  }
  // After the limit, ahead of "Moved from".
  if (headsUp) return { kind: "heads-up", headsUp, handoff: resolveHeadsUpHandoff(headsUp) };
  if (kind === "moved-from") {
    const original = findTargetByProvider(targets, facts.movedFromProvider);
    const originalUsedPct = original?.usedPct ?? null;
    return {
      kind,
      label: original?.label ?? facts.movedFromProvider,
      highlighted: originalUsedPct !== null && originalUsedPct < USAGE_LIMIT_PCT,
    };
  }
  return { kind: "none" };
}
