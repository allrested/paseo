import type { TFunction } from "i18next";
import type { AgentMoveTarget } from "@getpaseo/protocol/messages";
import { usageHeadsUpTone } from "@getpaseo/protocol/usage-heads-up";
import type { StatusBadgeVariant } from "@/components/ui/status-badge";
import { i18n } from "@/i18n/i18next";
import { formatDisplayPct, formatResetLabel } from "@/usage/format";
import { usedPctTone } from "@/usage/tone";
import type { UsageTone } from "@/usage/types";

/** An account at or past this much usage cannot take another turn. */
export const USAGE_LIMIT_PCT = 100;

/**
 * How often a mounted Move back re-reads the original's account while it is used up, and a
 * usage heads-up re-reads the agent's own. The daemon caches each usage report for five minutes,
 * so a faster poll would only re-read the cache.
 */
export const MOVE_BACK_RECHECK_MS = 5 * 60_000;

export type AgentMoveTargetsView =
  | { kind: "loading" }
  | { kind: "disconnected" }
  | { kind: "error"; message: string }
  | { kind: "ready"; targets: AgentMoveTarget[] };

/** Moving needs the host, so targets loaded before it went away do not count. */
export function resolveMoveTargetsView(input: {
  canRequest: boolean;
  data: AgentMoveTarget[] | undefined;
  error: Error | null;
}): AgentMoveTargetsView {
  if (!input.canRequest) return { kind: "disconnected" };
  if (input.data) return { kind: "ready", targets: input.data };
  if (input.error) return { kind: "error", message: input.error.message };
  return { kind: "loading" };
}

export function isSelectableTarget(target: AgentMoveTarget): boolean {
  return target.available && !target.current;
}

export interface MoveTargetFamily {
  family: string;
  /** The family's base provider label when it is a target, e.g. "Claude" for its profiles. */
  label: string;
  targets: AgentMoveTarget[];
}

export function groupTargetsByFamily(targets: readonly AgentMoveTarget[]): MoveTargetFamily[] {
  const families = new Map<string, AgentMoveTarget[]>();
  for (const target of targets) {
    const members = families.get(target.family);
    if (members) members.push(target);
    else families.set(target.family, [target]);
  }
  return Array.from(families, ([family, members]) => ({
    family,
    label: members.find((target) => target.provider === family)?.label ?? family,
    targets: members,
  }));
}

/** The target the agent runs on now. */
export function findCurrentTarget(view: AgentMoveTargetsView): AgentMoveTarget | null {
  if (view.kind !== "ready") return null;
  return view.targets.find((target) => target.current) ?? null;
}

export function findTargetByProvider(
  view: AgentMoveTargetsView,
  provider: string | null,
): AgentMoveTarget | null {
  if (view.kind !== "ready" || provider === null) return null;
  return view.targets.find((target) => target.provider === provider) ?? null;
}

/**
 * How long to wait before reading the targets again: polled while `provider`'s account is used
 * up, so a mounted Move back notices when it frees up. No usage, no target or no data, no poll.
 */
export function moveTargetsRecheckMs(
  targets: readonly AgentMoveTarget[] | undefined,
  provider: string,
): number | false {
  const usedPct = targets?.find((target) => target.provider === provider)?.usedPct ?? null;
  return usedPct !== null && usedPct >= USAGE_LIMIT_PCT ? MOVE_BACK_RECHECK_MS : false;
}

/**
 * The targets query's refetch interval. Fork delta (usage heads-up): while `pollTargets` is set
 * the agent's own account is read every five minutes; otherwise only a Move back polls.
 */
export function moveTargetsRefetchMs(input: {
  pollTargets: boolean;
  recheckProvider: string | null;
  targets: readonly AgentMoveTarget[] | undefined;
}): number | false {
  if (input.pollTargets) return MOVE_BACK_RECHECK_MS;
  if (input.recheckProvider === null) return false;
  return moveTargetsRecheckMs(input.targets, input.recheckProvider);
}

export interface MoveTargetBadge {
  label: string;
  variant: StatusBadgeVariant;
}

export interface MoveTargetDescription {
  badge: MoveTargetBadge | null;
  /** The row's label for assistive tech, which replaces the text of its children. */
  accessibilityLabel: string;
}

const TONE_BADGE_VARIANT: Record<UsageTone, StatusBadgeVariant> = {
  danger: "error",
  warning: "warning",
  ok: "muted",
  default: "muted",
};

/**
 * The badge colour for a target's tightest window: its usage tone, raised to the heads-up tone
 * while the window is on pace to run out, so a window at 30% that runs out soon shows a warning.
 */
function usageBadgeVariant(input: {
  target: AgentMoveTarget;
  usedPct: number;
  now: number;
}): StatusBadgeVariant {
  const { target, usedPct, now } = input;
  const variant = TONE_BADGE_VARIANT[usedPctTone(usedPct)];
  if (!target.runsOutAt) return variant;
  const headsUp = usageHeadsUpTone(
    { usedPct, resetsAt: target.resetsAt ?? null, runsOutAt: target.runsOutAt },
    now,
  );
  if (headsUp === "danger" || variant === "error") return "error";
  return headsUp === "warning" ? "warning" : variant;
}

function describeBadge(
  target: AgentMoveTarget,
  options: { now: number; locale?: string; t: TFunction },
): MoveTargetBadge | null {
  const { now, locale, t } = options;
  if (target.current) return { label: t("sessionMove.dialog.current"), variant: "muted" };
  if (!target.available) return { label: t("sessionMove.dialog.unavailable"), variant: "muted" };
  if (target.usedPct === null) return null;
  const used = formatDisplayPct(target.usedPct, "used", locale, t);
  const reset =
    target.usedPct >= USAGE_LIMIT_PCT ? formatResetLabel(target.resetsAt, false, now, t) : null;
  return {
    label: reset ? t("sessionMove.dialog.usage", { used, reset }) : used,
    variant: usageBadgeVariant({ target, usedPct: target.usedPct, now }),
  };
}

/** A target row's trailing badge and accessible label. */
export function describeMoveTarget(
  target: AgentMoveTarget,
  options: { now: number; locale?: string; t?: TFunction },
): MoveTargetDescription {
  const badge = describeBadge(target, { ...options, t: options.t ?? i18n.t });
  return {
    badge,
    accessibilityLabel: badge ? `${target.label}, ${badge.label}` : target.label,
  };
}
