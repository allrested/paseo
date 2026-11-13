import type { Clock } from "./timers.js";

// Test helper, as plugins/office/server/fake-clock.ts. Nothing imports it from index.server.ts,
// so it is not in the bundle.
export interface FakeClock extends Clock {
  /** Moves time forward, running each due timer in time order, then stops at now + ms. */
  advance(ms: number): void;
  pending(): number;
}

interface Scheduled {
  id: number;
  at: number;
  run: () => void;
}

export function createFakeClock(start = 0): FakeClock {
  let current = start;
  let nextId = 0;
  const scheduled = new Map<number, Scheduled>();
  function firstDue(limit: number): Scheduled | null {
    let first: Scheduled | null = null;
    for (const entry of scheduled.values()) {
      if (entry.at > limit) continue;
      if (first === null || entry.at < first.at || (entry.at === first.at && entry.id < first.id)) {
        first = entry;
      }
    }
    return first;
  }
  return {
    now: () => current,
    setTimeout(run, ms) {
      const id = nextId;
      nextId += 1;
      scheduled.set(id, { id, at: current + Math.max(0, ms), run });
      return () => {
        scheduled.delete(id);
      };
    },
    advance(ms) {
      const target = current + ms;
      for (let next = firstDue(target); next !== null; next = firstDue(target)) {
        scheduled.delete(next.id);
        current = next.at;
        next.run();
      }
      current = target;
    },
    pending: () => scheduled.size,
  };
}

/** Lets promise chains started by a timer or a call run until they wait on something new. */
export async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
