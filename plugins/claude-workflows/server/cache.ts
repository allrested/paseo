/** At most this many runs are kept; when full, the least recently used goes first. */
export const CACHE_CAPACITY = 32;

/** A run no call has used for this long is dropped on the next call. */
export const CACHE_IDLE_MS = 10 * 60 * 1000;

export interface RunCache<State> {
  /** Runs `work` on the key's state once every earlier call for the key has settled. */
  use<Result>(key: string, work: (state: State) => Promise<Result>): Promise<Result>;
}

export interface RunCacheOptions<State> {
  create(): State;
  now(): number;
}

interface Slot<State> {
  state: State;
  usedAt: number;
  /** Settles when the latest call for the key settles; never rejects. */
  tail: Promise<unknown>;
}

/** An LRU of per-run state that serializes calls per run. It holds no timer. */
export function createRunCache<State>(options: RunCacheOptions<State>): RunCache<State> {
  const slots = new Map<string, Slot<State>>();
  return {
    use(key, work) {
      const now = options.now();
      for (const [entryKey, entry] of slots) {
        if (now - entry.usedAt >= CACHE_IDLE_MS) slots.delete(entryKey);
      }
      const slot = slots.get(key) ?? newSlot(options, now);
      // Map order is use order, so the first key is the least recently used.
      slots.delete(key);
      if (slots.size >= CACHE_CAPACITY) {
        const [oldest] = slots.keys();
        slots.delete(oldest);
      }
      slots.set(key, slot);
      slot.usedAt = now;
      const result = slot.tail.then(() => work(slot.state));
      slot.tail = result.catch(() => undefined);
      return result;
    },
  };
}

function newSlot<State>(options: RunCacheOptions<State>, now: number): Slot<State> {
  const state = options.create();
  return { state, usedAt: now, tail: Promise.resolve() };
}
