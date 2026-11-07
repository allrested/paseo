import type { AgentMoveTarget } from "@getpaseo/protocol/messages";
import type { MoveBannerFacts } from "./move-banner-facts";
import type { UsageHeadsUp } from "./usage-heads-up";
import {
  USAGE_LIMIT_PCT,
  findCurrentTarget,
  findTargetByProvider,
  type AgentMoveTargetsView,
} from "./move-targets";

export type MoveBannerKind = "none" | "limit" | "moved-from";

export type MoveBannerView =
  | { kind: "none" }
  | { kind: "limit"; account: string; resetsAt: string | null }
  | { kind: "heads-up"; headsUp: UsageHeadsUp }
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
 * The reset a limit notice names: the agent's own target's, only while that account is used up. A
 * limit error under full usage, such as an HTTP 429, has no window that resets it.
 */
function limitResetsAt(current: AgentMoveTarget | null): string | null {
  if (!current || current.usedPct === null || current.usedPct < USAGE_LIMIT_PCT) return null;
  return current.resetsAt;
}

/**
 * What the banner shows, in this order: the limit, the usage heads-up, then "Moved from". A limit
 * names the agent's own target and its reset; a move names the original's target, highlighted
 * once its usage is known to be under the limit.
 */
export function resolveMoveBannerView(input: MoveBannerViewInput): MoveBannerView {
  const { facts, targets, headsUp } = input;
  if (facts.kind === "inactive") return { kind: "none" };
  const kind = resolveMoveBannerKind(facts);
  if (kind === "limit") {
    const current = findCurrentTarget(targets);
    return {
      kind,
      account: current?.label ?? facts.provider,
      resetsAt: limitResetsAt(current),
    };
  }
  // Fork delta (usage heads-up): after the limit, ahead of "Moved from".
  if (headsUp) return { kind: "heads-up", headsUp };
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

/**
 * The reset a limit notice names, while it is still ahead. Nothing reads the targets again in
 * limit mode, so a passed reset would read "resetting now" until the next turn.
 */
export function upcomingLimitReset(resetsAt: string | null, now: number): string | null {
  return resetsAt !== null && Date.parse(resetsAt) > now ? resetsAt : null;
}
