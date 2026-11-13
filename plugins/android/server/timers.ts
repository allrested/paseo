import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from "node:timers";

export interface Clock {
  /** Runs `run` once after `ms`; the returned function cancels it. */
  setTimeout(run: () => void, ms: number): () => void;
  now(): number;
}

/** Node timers that never keep the daemon alive on their own. */
export const nodeClock: Clock = {
  setTimeout(run, ms) {
    const timer = setNodeTimeout(run, ms);
    timer.unref();
    return () => clearNodeTimeout(timer);
  },
  now: () => Date.now(),
};
