import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from "node:timers";

export interface Timers {
  /** Runs `run` once after `ms`; the returned function cancels it. */
  setTimeout(run: () => void, ms: number): () => void;
}

/** Node timers that never keep the daemon alive on their own. */
export const nodeTimers: Timers = {
  setTimeout(run, ms) {
    const timer = setNodeTimeout(run, ms);
    timer.unref();
    return () => clearNodeTimeout(timer);
  },
};

export interface Clock extends Timers {
  now(): number;
}

export const nodeClock: Clock = {
  setTimeout: (run, ms) => nodeTimers.setTimeout(run, ms),
  now: () => Date.now(),
};
