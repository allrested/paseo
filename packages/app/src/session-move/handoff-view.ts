import type { TFunction } from "i18next";
import type { AgentMoveTarget } from "@getpaseo/protocol/messages";
import { chooseBestMoveTarget } from "@getpaseo/protocol/usage-heads-up";
import { i18n } from "@/i18n/i18next";
import { formatPct, formatResetLabel, formatResetTime, formatRunsOutLabel } from "@/usage/format";
import { usedPctTone } from "@/usage/tone";
import type { UsageTone } from "@/usage/types";
import { USAGE_LIMIT_PCT, findCurrentTarget, type AgentMoveTargetsView } from "./move-targets";
import type { UsageHeadsUp } from "./usage-heads-up";

/** Why the card is up: the account cannot take another turn, or is about to run out. */
export type HandoffReason = "limit" | "danger" | "warning";

/** One account as the card draws it: its name, its tightest window and how full that is. */
export interface HandoffAccount {
  label: string;
  windowLabel: string | null;
  /** Null when the account's usage is not reported: the card draws no bar and no number. */
  usedPct: number | null;
}

/** Where the chat can go on. */
export type HandoffNext =
  | { kind: "loading" }
  /** The accounts could not be read: the host is away or refused. */
  | { kind: "unknown" }
  /** Every other account is full, signed out or unavailable. */
  | { kind: "none" }
  | { kind: "ready"; target: AgentMoveTarget };

/** The agent's own account next to the account its chat can continue on. */
export interface HandoffView {
  reason: HandoffReason;
  current: HandoffAccount;
  resetsAt: string | null;
  /** Only on a heads-up, while the run-out comes before the reset. */
  runsOutAt: string | null;
  next: HandoffNext;
}

function resolveNext(targets: AgentMoveTargetsView): HandoffNext {
  if (targets.kind === "loading") return { kind: "loading" };
  if (targets.kind !== "ready") return { kind: "unknown" };
  const target = chooseBestMoveTarget(targets.targets);
  return target ? { kind: "ready", target } : { kind: "none" };
}

/**
 * The reset a limit names: the agent's own target's, only while that account is used up. A limit
 * error under full usage, such as an HTTP 429, has no window that resets it.
 */
function limitResetsAt(current: AgentMoveTarget | null): string | null {
  if (!current || current.usedPct === null || current.usedPct < USAGE_LIMIT_PCT) return null;
  return current.resetsAt;
}

/** The card for an agent whose account hit its limit. `provider` names it until the targets load. */
export function resolveLimitHandoff(input: {
  provider: string;
  targets: AgentMoveTargetsView;
}): HandoffView {
  const current = findCurrentTarget(input.targets);
  return {
    reason: "limit",
    current: {
      label: current?.label ?? input.provider,
      windowLabel: current?.windowLabel ?? null,
      usedPct: current?.usedPct ?? null,
    },
    resetsAt: limitResetsAt(current),
    runsOutAt: null,
    next: resolveNext(input.targets),
  };
}

/** The card for an account that is about to run out. */
export function resolveHeadsUpHandoff(headsUp: UsageHeadsUp): HandoffView {
  return {
    reason: headsUp.tone,
    current: {
      label: headsUp.account,
      windowLabel: headsUp.windowLabel,
      usedPct: headsUp.usedPct,
    },
    resetsAt: headsUp.resetsAt,
    runsOutAt: headsUp.runsOutAt,
    next: headsUp.best ? { kind: "ready", target: headsUp.best } : { kind: "none" },
  };
}

/**
 * How the card lays out, from its own width: a pane can be narrow in a wide window. `stacked` is
 * one account over the other with the actions under them. `wide` puts the accounts side by side
 * over one row that holds the status and the actions.
 */
export interface HandoffLayout {
  kind: "stacked" | "wide";
  /** Every action keeps its name; otherwise only the move does and the rest are icons. */
  namedActions: boolean;
}

/** Below this the status and the actions no longer fit on one row. */
const WIDE_MIN_WIDTH = 560;
/** From this three named actions fit beside the status. */
const NAMED_ACTIONS_MIN_WIDTH = 720;

export function resolveHandoffLayout(width: number): HandoffLayout {
  return {
    kind: width < WIDE_MIN_WIDTH ? "stacked" : "wide",
    namedActions: width >= NAMED_ACTIONS_MIN_WIDTH,
  };
}

/** An account's row: its name, its window as the source names it, and its bar. */
export interface HandoffAccountCopy {
  name: string;
  window: string | null;
  /** "98%"; null without a reported usage, and then there is no bar. */
  value: string | null;
  percent: number;
  tone: UsageTone;
}

/** The line under the agent's own account. */
export interface HandoffStatusCopy {
  /** "Limit reached", in the danger colour. */
  alarm: string | null;
  /** "resets in 1h 36m", or "runs out in 20m" while the account is on pace to run out. */
  countdown: string | null;
  /** The countdown is a run-out, drawn in the danger colour. */
  atRisk: boolean;
  /** The reset on the clock: "9:10 PM". */
  exactTime: string | null;
}

export interface HandoffCopy {
  current: HandoffAccountCopy;
  status: HandoffStatusCopy;
  next: HandoffAccountCopy | null;
  /** What stands in the next account's place while there is none to show. */
  note: string | null;
  /** The one-tap move, named after the account it goes to. */
  moveLabel: string | null;
}

interface CopyOptions {
  now: number;
  t?: TFunction;
  locale?: string;
}

function describeAccount(account: HandoffAccount, locale?: string): HandoffAccountCopy {
  return {
    name: account.label,
    // Shown verbatim: sources name windows such as "Weekly · Fable", which no case rule survives.
    window: account.windowLabel,
    value: account.usedPct === null ? null : formatPct(account.usedPct, locale),
    percent: account.usedPct ?? 0,
    tone: account.usedPct === null ? "default" : usedPctTone(account.usedPct),
  };
}

function describeStatus(view: HandoffView, now: number, t: TFunction): HandoffStatusCopy {
  // A reset that has passed says nothing: the account is read again at the next turn.
  const resetsAt = view.resetsAt !== null && Date.parse(view.resetsAt) > now ? view.resetsAt : null;
  const clock = formatResetTime(resetsAt, now, t);
  if (view.reason === "limit") {
    return {
      alarm: t("sessionMove.handoff.limitReached"),
      countdown: formatResetLabel(resetsAt, false, now, t),
      atRisk: false,
      exactTime: clock,
    };
  }
  const runsOut = formatRunsOutLabel(view.runsOutAt, now, t);
  if (runsOut) {
    return {
      alarm: null,
      countdown: runsOut,
      atRisk: true,
      // Beside a run-out a bare time would read as the moment the quota ends.
      exactTime: clock ? t("sessionMove.headsUp.resets", { reset: clock }) : null,
    };
  }
  return {
    alarm: null,
    countdown: formatResetLabel(resetsAt, false, now, t),
    atRisk: false,
    exactTime: clock,
  };
}

function describeNote(next: HandoffNext, t: TFunction): string | null {
  if (next.kind === "loading") return t("sessionMove.handoff.checking");
  if (next.kind === "unknown") return t("sessionMove.handoff.unknown");
  if (next.kind === "none") return t("sessionMove.handoff.noRoom");
  return null;
}

function describeMove(view: HandoffView, t: TFunction): string | null {
  if (view.next.kind !== "ready") return null;
  const { label } = view.next.target;
  // At the limit the chat is stopped, so the move is how it goes on; before it, a move is a choice.
  return view.reason === "limit"
    ? t("sessionMove.handoff.continueOn", { label })
    : t("sessionMove.headsUp.moveTo", { label });
}

function nextAccount(target: AgentMoveTarget): HandoffAccount {
  return {
    label: target.label,
    windowLabel: target.windowLabel ?? null,
    usedPct: target.usedPct,
  };
}

/** The card's words: "Claude 5-hour 100%, Limit reached, resets in 1h 36m" over the next account. */
export function describeHandoff(view: HandoffView, options: CopyOptions): HandoffCopy {
  const t = options.t ?? i18n.t;
  return {
    current: describeAccount(view.current, options.locale),
    status: describeStatus(view, options.now, t),
    next:
      view.next.kind === "ready"
        ? describeAccount(nextAccount(view.next.target), options.locale)
        : null,
    note: describeNote(view.next, t),
    moveLabel: describeMove(view, t),
  };
}
