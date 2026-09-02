/**
 * Idle ACP session reaper.
 *
 * A provider session is kept warm between turns so the next prompt is fast.
 * That is deliberate — but until now it had no upper bound: `session.close()`
 * ran only on an explicit close, archive or delete, so every agent that was
 * ever prompted held its provider process for the life of the server.
 *
 * Observed in production: a sandbox accumulated 11 live `kiro-cli acp` +
 * `kiro-cli-chat` pairs over five days (~290 MiB each, ~2.5 GiB), all still
 * parented to the running Paseo server. They were never orphans, so nothing
 * reaped them; the host reached 95% memory and container deploys began failing.
 *
 * The reaper closes sessions that have been idle past a threshold, using the
 * ordinary `closeAgent` path. A closed agent keeps its persisted state and is
 * restored by `resumeAgentFromPersistence` — the same path taken after a server
 * restart, so this reuses a well-travelled route rather than inventing a
 * lifecycle.
 *
 * Policy lives here, pure and unit-testable; the manager only supplies
 * candidates and performs the close.
 */

/** The slice of a managed agent the reap decision needs. */
export interface ReapCandidate {
  id: string;
  lifecycle: string;
  /** Last time anything about the agent changed (`touchUpdatedAt`). */
  updatedAt: Date;
  /** Non-null while a foreground turn is in flight. */
  activeForegroundTurnId: string | null;
  /** Non-null while any turn (including background) is in flight. */
  activeTurnId: string | null;
  /** Outstanding permission prompts waiting on a human. */
  pendingPermissionCount: number;
}

export interface IdleReaperConfig {
  enabled: boolean;
  /** Idle duration before a session is eligible, in milliseconds. */
  idleMs: number;
  /** How often to sweep, in milliseconds. */
  sweepMs: number;
}

/** Sweep at a twelfth of the idle window, bounded to something sane. */
const MIN_SWEEP_MS = 30_000;
const MAX_SWEEP_MS = 5 * 60_000;

export const DEFAULT_IDLE_MINUTES = 60;

/**
 * Reaping is OPT-IN. It closes sessions a user may expect to still be warm, so
 * it stays off until an operator asks for it — and any malformed value leaves
 * it off rather than guessing a threshold.
 */
export function idleReaperConfigFromEnv(env: Record<string, string | undefined>): IdleReaperConfig {
  const disabled: IdleReaperConfig = { enabled: false, idleMs: 0, sweepMs: MIN_SWEEP_MS };
  const raw = (env.PASEO_IDLE_SESSION_REAP_MINUTES ?? "").trim();
  if (!raw) {
    return disabled;
  }
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return disabled;
  }
  const idleMs = Math.round(minutes * 60_000);
  return {
    enabled: true,
    idleMs,
    sweepMs: Math.min(MAX_SWEEP_MS, Math.max(MIN_SWEEP_MS, Math.round(idleMs / 12))),
  };
}

/**
 * The agents whose sessions are safe to close right now.
 *
 * Fail-closed on every axis: a candidate is reaped only when it is provably
 * doing nothing. Anything ambiguous — mid-turn, awaiting a permission answer,
 * or in a lifecycle other than `idle` — is left alone. Closing a session under
 * active work is far worse than holding a process for another sweep.
 */
export function selectIdleAgentsToReap(
  candidates: readonly ReapCandidate[],
  now: Date,
  idleMs: number,
): string[] {
  if (!(idleMs > 0)) {
    return [];
  }
  const cutoff = now.getTime() - idleMs;
  const reapable: string[] = [];
  for (const candidate of candidates) {
    if (!isReapable(candidate, cutoff)) {
      continue;
    }
    reapable.push(candidate.id);
  }
  return reapable;
}

function isReapable(candidate: ReapCandidate, cutoff: number): boolean {
  // "initializing" is still starting up, "running" is mid-turn, "error" may be
  // inspected by the user, "closed" has no session left to reap.
  if (candidate.lifecycle !== "idle") {
    return false;
  }
  // Belt and braces: an idle agent should have neither, but the lifecycle field
  // and the turn fields are updated separately, so never trust one alone.
  if (candidate.activeForegroundTurnId !== null || candidate.activeTurnId !== null) {
    return false;
  }
  // A pending permission is a human being asked a question. Closing the session
  // would silently cancel it.
  if (candidate.pendingPermissionCount > 0) {
    return false;
  }
  // An updatedAt in the future (clock skew, a bad restore) must not read as
  // "infinitely idle".
  const updatedAt = candidate.updatedAt.getTime();
  if (!Number.isFinite(updatedAt)) {
    return false;
  }
  return updatedAt <= cutoff;
}
