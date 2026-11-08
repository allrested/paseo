import type { AccountUsage } from "../shared/rpc.js";
import { AUTO_ACCOUNT, MAIN_PROVIDER } from "../shared/settings.js";
import type { ProviderUsage, UsageReportEntry, UsageTone } from "./api.js";

// The daemon fails a creation whose before-hook throws or takes 30 s (REQUEST_TIMEOUT_MS in
// packages/server/src/server/plugins/runtime.ts), so the choice gets a third of that.
export const DECIDE_TIMEOUT_MS = 10_000;

export interface UsageSummary {
  /** Some report for the provider's launch scope is available. */
  known: boolean;
  /** No report is available, and one says the login expired or was rejected. */
  expired: boolean;
  usage: AccountUsage | null;
  /** The tightest window's heads-up tone from the daemon, or null when usage is unknown. */
  tone: UsageTone | null;
}

export function summarizeUsage(usage: ProviderUsage): UsageSummary {
  const known = usage.reports.some((entry) => entry.report.status === "available");
  const tightest = known ? usage.tightest : null;
  return {
    known,
    expired: !known && usage.reports.some((entry) => loginRejected(entry)),
    usage:
      tightest === null
        ? null
        : { usedPct: tightest.usedPct, windowLabel: tightest.label, planLabel: planLabel(usage) },
    tone: tightest?.tone ?? null,
  };
}

function loginRejected(entry: UsageReportEntry): boolean {
  const { report } = entry;
  return (
    report.status === "unavailable" &&
    (report.problem.kind === "expired" || report.problem.kind === "rejected")
  );
}

function planLabel(usage: ProviderUsage): string | null {
  for (const { report } of usage.reports) {
    if (report.status === "available") return report.planLabel ?? null;
  }
  return null;
}

export interface AccountHeadroom {
  provider: string;
  /** The provider is ready and the account is signed in with a login that has not expired. */
  usable: boolean;
  /** The tightest window's used share, or null when unknown. */
  usedPct: number | null;
  /** The tightest window's heads-up tone from the daemon, or null when unknown. */
  tone: UsageTone | null;
}

/**
 * The usable account with the lowest known used share. An account whose tightest window has the
 * daemon's `danger` tone (95% or more, or on pace to run out within 30 minutes) is skipped, so the
 * plugin keeps no copy of those thresholds. A tie keeps list order.
 */
export function chooseAuto(accounts: readonly AccountHeadroom[]): string | null {
  let best: string | null = null;
  let bestPct = Number.POSITIVE_INFINITY;
  for (const account of accounts) {
    if (!account.usable || account.tone === "danger" || account.usedPct === null) continue;
    if (account.usedPct < bestPct) {
      best = account.provider;
      bestPct = account.usedPct;
    }
  }
  return best;
}

export interface CreateRequest {
  provider: string;
  cwd: string;
}

export interface DefaultAccountDeps {
  /** The saved default account, or null when the stored setting is invalid. */
  setting(): Promise<string | null>;
  /** Headroom of every profile in list order, or of the one provider `only` names. */
  headroom(only: string | null): Promise<AccountHeadroom[]>;
  /** This plugin is moving an agent in `cwd` to plain `claude` (the handoff guard). */
  movingToMain(cwd: string): boolean;
  onError(error: unknown): void;
  /** How long the choice may take; the daemon wiring passes DECIDE_TIMEOUT_MS. */
  timeoutMs: number;
}

/**
 * The provider an agent creation should use. Only plain `claude` creations change. A failure, or a
 * choice slower than `deps.timeoutMs`, keeps `claude`. Never rejects.
 */
export async function chooseCreateProvider(
  deps: DefaultAccountDeps,
  request: CreateRequest,
): Promise<string> {
  if (request.provider !== MAIN_PROVIDER || deps.movingToMain(request.cwd)) {
    return request.provider;
  }
  try {
    return (await withTimeout(decide(deps), deps.timeoutMs)) ?? MAIN_PROVIDER;
  } catch (error) {
    deps.onError(error);
    return MAIN_PROVIDER;
  }
}

async function decide(deps: DefaultAccountDeps): Promise<string> {
  const setting = await deps.setting();
  if (setting === null || setting === MAIN_PROVIDER) return MAIN_PROVIDER;
  if (setting === AUTO_ACCOUNT) return chooseAuto(await deps.headroom(null)) ?? MAIN_PROVIDER;
  const [chosen] = await deps.headroom(setting);
  return chosen?.usable ? setting : MAIN_PROVIDER;
}

// Promise.race subscribes to `work`, so a rejection after the timeout is still handled. The timer
// is unref'd, as in waitAtMost (plugins/shared-mcp/server/process-runner.ts): the plugin runs in
// the daemon, and a pending choice must not keep it alive.
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms).unref();
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
