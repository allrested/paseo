/** A count that goes up while somebody listens: what makes legs step and screens scroll. */
export interface Ticker {
  frame(): number;
  /** Starts the count with the first listener and stops it with the last. */
  subscribe(listener: () => void): () => void;
}

export interface TickerTimers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const REAL: TickerTimers = {
  set: (run, ms) => setInterval(run, ms),
  clear: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export function createTicker(intervalMs: number, timers: TickerTimers = REAL): Ticker {
  const listeners = new Set<() => void>();
  let frame = 0;
  let handle: unknown = null;
  return {
    frame: () => frame,
    subscribe(listener) {
      listeners.add(listener);
      if (handle === null) {
        handle = timers.set(() => {
          frame += 1;
          for (const each of listeners) each();
        }, intervalMs);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0 || handle === null) return;
        timers.clear(handle);
        handle = null;
      };
    },
  };
}
