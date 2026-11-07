// oxlint-disable oxc/no-async-endpoint-handlers -- RunCache.use is not an Express route.
import { describe, expect, it } from "vitest";
import { CACHE_CAPACITY, CACHE_IDLE_MS, createRunCache } from "./cache.js";

interface Counted {
  id: number;
}

/** Numbers each state it creates, so a test can tell a kept state from a new one. */
function counter(): () => Counted {
  let next = 0;
  return () => {
    next += 1;
    return { id: next };
  };
}

async function readId(state: Counted): Promise<number> {
  return state.id;
}

interface Gate {
  opened: Promise<void>;
  open(): void;
}

function gate(): Gate {
  let release = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, open: () => release() };
}

/** Lets every queued promise callback run. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("createRunCache", () => {
  it("keeps one state per key", async () => {
    const cache = createRunCache({ create: counter(), now: () => 0 });

    const ids = [
      await cache.use("a", readId),
      await cache.use("b", readId),
      await cache.use("a", readId),
    ];

    expect(ids).toEqual([1, 2, 1]);
  });

  it("runs calls for one key one at a time, in call order", async () => {
    const cache = createRunCache({ create: counter(), now: () => 0 });
    const events: string[] = [];
    const first = gate();

    const one = cache.use("run", async () => {
      events.push("one started");
      await first.opened;
      events.push("one finished");
      return 1;
    });
    const two = cache.use("run", async () => {
      events.push("two started");
      return 2;
    });
    await settle();
    expect(events).toEqual(["one started"]);

    first.open();
    await expect(Promise.all([one, two])).resolves.toEqual([1, 2]);
    expect(events).toEqual(["one started", "one finished", "two started"]);
  });

  it("runs the next call for a key after a call that failed", async () => {
    const cache = createRunCache({ create: counter(), now: () => 0 });

    const failing = cache.use("run", async () => {
      throw new Error("read failed");
    });
    const next = cache.use("run", readId);

    await expect(failing).rejects.toThrow("read failed");
    await expect(next).resolves.toBe(1);
  });

  it("does not hold one key's calls behind another's", async () => {
    const cache = createRunCache({ create: counter(), now: () => 0 });
    const held = gate();

    const slow = cache.use("a", async (state) => {
      await held.opened;
      return state.id;
    });

    await expect(cache.use("b", readId)).resolves.toBe(2);
    held.open();
    await expect(slow).resolves.toBe(1);
  });

  it("drops the least recently used key when full", async () => {
    const cache = createRunCache({ create: counter(), now: () => 0 });
    for (let index = 0; index < CACHE_CAPACITY; index++) {
      await cache.use(`run-${index}`, readId);
    }

    await cache.use("run-0", readId);
    await cache.use(`run-${CACHE_CAPACITY}`, readId);

    await expect(cache.use("run-0", readId)).resolves.toBe(1);
    await expect(cache.use("run-1", readId)).resolves.toBe(CACHE_CAPACITY + 2);
  });

  it("drops a key no call has used for ten minutes on the next call", async () => {
    let now = 0;
    const cache = createRunCache({ create: counter(), now: () => now });
    await cache.use("a", readId);
    await cache.use("b", readId);

    now = CACHE_IDLE_MS - 1;
    await expect(cache.use("a", readId)).resolves.toBe(1);
    now = CACHE_IDLE_MS;

    await expect(cache.use("b", readId)).resolves.toBe(3);
    await expect(cache.use("a", readId)).resolves.toBe(1);
  });
});
