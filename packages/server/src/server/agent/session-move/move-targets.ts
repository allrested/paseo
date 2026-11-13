import { chooseTightestWindow } from "@getpaseo/protocol/usage-heads-up";
import type { ProviderSnapshotEntry } from "../agent-sdk-types.js";
import type { ProviderLaunchInfo } from "../provider-snapshot-manager.js";
import type { TargetLogin } from "./target-login.js";

export interface MoveTarget {
  provider: string;
  label: string;
  family: string;
  available: boolean;
  current: boolean;
  usedPct: number | null;
  resetsAt: string | null;
  /** When the tightest window runs out at its pace, only while that comes before its reset. */
  runsOutAt: string | null;
  windowLabel: string | null;
  /** Present, and true, only when the target's own CLI says nobody is signed in. */
  signedOut?: true;
}

export interface UsageWindowLike {
  label?: string;
  usedPct?: number | null;
  remainingPct?: number | null;
  resetsAt?: string | null;
  runsOutAt?: string | null;
}

export interface MoveTargetInput {
  info: ProviderLaunchInfo;
  /** The provider's snapshot status in the agent's workspace; null when it has no entry yet. */
  status: ProviderSnapshotEntry["status"] | null;
  currentProvider: string;
  windows: readonly UsageWindowLike[] | null;
  /** The time each window's heads-up tone is judged at. */
  now: number;
  /** What the target's CLI says about its login; left out when it was not asked. */
  login?: TargetLogin;
}

/**
 * The tightest window decides whether a target has room and what its heads-up says. A window on
 * pace to run out soon outranks a fuller one with no projected run-out, and a used-up window
 * always wins.
 */
export function toMoveTarget(input: MoveTargetInput): MoveTarget {
  // The nearer heads-up first, then the fuller window, then the sooner run-out. Below any
  // heads-up this is the old rule, the fullest window.
  const tightest = chooseTightestWindow(input.windows ?? [], input.now);
  return {
    provider: input.info.providerId,
    label: input.info.label,
    family: input.info.family,
    // A loading target stays selectable: the move waits for it and refuses it if it fails.
    available:
      input.info.enabled &&
      input.status !== "unavailable" &&
      input.status !== "error" &&
      input.login !== "signed_out",
    current: input.info.providerId === input.currentProvider,
    usedPct: tightest?.usedPct ?? null,
    resetsAt: tightest?.resetsAt ?? null,
    runsOutAt: tightest?.runsOutAt ?? null,
    windowLabel: tightest?.window.label ?? null,
    ...(input.login === "signed_out" ? { signedOut: true as const } : {}),
  };
}

export interface UsageLookupOptions {
  ttlMs?: number;
  timeoutMs?: number;
  now?: () => number;
}

/**
 * Wraps a usage lookup so the move dialog stays fast: a result is reused for `ttlMs`, and a
 * lookup slower than `timeoutMs` resolves to null (unknown usage) instead of holding the dialog.
 * A slow lookup that finishes later still fills the cache. Concurrent callers for one key share
 * the lookup in flight. Failures are not cached.
 */
// ponytail: process-wide map keyed by provider id with no size cap; the provider list is small.
export function createUsageLookup<T>(
  options: UsageLookupOptions = {},
): (key: string, load: () => Promise<T>) => Promise<T | null> {
  const ttlMs = options.ttlMs ?? 60_000;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { at: number; value: T }>();
  const inFlight = new Map<string, Promise<T>>();
  return async (key, load) => {
    const hit = entries.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    let loaded = inFlight.get(key);
    if (!loaded) {
      loaded = load()
        .then((value) => {
          entries.set(key, { at: now(), value });
          return value;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, loaded);
    }
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    // The race below only observes `loaded`; this keeps a late rejection from going unhandled.
    loaded.catch(() => undefined);
    try {
      return await Promise.race([loaded, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  };
}
