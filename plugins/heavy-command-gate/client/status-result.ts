import type { GateStatus } from "../shared/rpc.js";

/**
 * What a status poll resolves to. A failed request resolves, it does not throw: a query that holds
 * no data resets to pending and drops its error at every fetch, which would swap the screen for
 * its loading line each time.
 */
export type StatusResult =
  // The gate has answered at least once. `error` is why the newest request failed, if it did.
  | { status: GateStatus; error: string | null }
  // The gate has not answered yet, and the newest request failed.
  | { status: null; error: string };

/** How one status request ended. */
export type StatusOutcome = { ok: true; status: GateStatus } | { ok: false; error: unknown };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A failure keeps the last status the gate gave, so the screen does not lose its lists. */
export function mergeStatus(
  previous: StatusResult | undefined,
  outcome: StatusOutcome,
): StatusResult {
  if (outcome.ok) return { status: outcome.status, error: null };
  const error = messageOf(outcome.error);
  const last = previous?.status ?? null;
  return last === null ? { status: null, error } : { status: last, error };
}
