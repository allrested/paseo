import { expect, test } from "vitest";
import type { Machine, MachineEvent } from "../../shared/contracts.js";
import { createFakeClock, settle } from "../fake-clock.js";
import { MACHINE_INTERVAL_MS, createMachineWatch } from "./watch.js";

function machine(usedBytes: number): Machine {
  return {
    readAt: "2026-11-16T12:00:00.000Z",
    memory: { usedBytes, totalBytes: 16 },
    cpuPercent: null,
    agents: [],
  };
}

function setup(read?: () => Promise<Machine | null>) {
  const clock = createFakeClock();
  const logs: string[] = [];
  let reads = 0;
  const watch = createMachineWatch({
    read:
      read ??
      (async () => {
        reads += 1;
        return machine(reads);
      }),
    timers: clock,
    log: (message) => logs.push(message),
  });
  function subscriber() {
    const events: MachineEvent[] = [];
    const controller = new AbortController();
    const done = watch.attach({
      push: async (event) => void events.push(event),
      signal: controller.signal,
    });
    return { events, leave: () => controller.abort(), done };
  }
  const used = (events: MachineEvent[]) =>
    events.map((event) => (event.type === "reading" ? event.machine.memory?.usedBytes : null));
  return { clock, logs, watch, subscriber, used, reads: () => reads };
}

test("reads at once for the first subscriber, then every interval", async () => {
  const { clock, subscriber, used } = setup();
  const first = subscriber();
  await settle();
  expect(used(first.events)).toEqual([1]);
  clock.advance(MACHINE_INTERVAL_MS - 1);
  await settle();
  expect(used(first.events)).toEqual([1]);
  clock.advance(1);
  await settle();
  expect(used(first.events)).toEqual([1, 2]);
  first.leave();
});

test("a later subscriber gets the last reading at once and no read of its own", async () => {
  const { subscriber, used, reads } = setup();
  const first = subscriber();
  await settle();
  const second = subscriber();
  await settle();
  expect(used(second.events)).toEqual([1]);
  expect(reads()).toBe(1);
  first.leave();
  second.leave();
});

test("nothing is read once the last subscriber left, and the next one reads afresh", async () => {
  const { clock, subscriber, used, reads } = setup();
  const first = subscriber();
  await settle();
  first.leave();
  await first.done;
  expect(clock.pending()).toBe(0);
  clock.advance(MACHINE_INTERVAL_MS * 3);
  await settle();
  expect(reads()).toBe(1);
  const second = subscriber();
  await settle();
  expect(used(second.events)).toEqual([2]);
  second.leave();
});

test("refresh reads now and moves the next read a whole interval on", async () => {
  const { clock, watch, subscriber, used } = setup();
  const first = subscriber();
  await settle();
  clock.advance(MACHINE_INTERVAL_MS / 2);
  watch.refresh();
  await settle();
  expect(used(first.events)).toEqual([1, 2]);
  clock.advance(MACHINE_INTERVAL_MS - 1);
  await settle();
  expect(used(first.events)).toEqual([1, 2]);
  clock.advance(1);
  await settle();
  expect(used(first.events)).toEqual([1, 2, 3]);
  first.leave();
});

test("a refresh during a read runs one more read after it", async () => {
  let reads = 0;
  const releases: (() => void)[] = [];
  const { watch, subscriber, used } = setup(async () => {
    reads += 1;
    const value = reads;
    await new Promise<void>((resolve) => {
      releases.push(resolve);
    });
    return machine(value);
  });
  const first = subscriber();
  await settle();
  watch.refresh();
  watch.refresh();
  releases[0]?.();
  await settle();
  releases[1]?.();
  await settle();
  expect(used(first.events)).toEqual([1, 2]);
  expect(reads).toBe(2);
  first.leave();
});

test("a host that cannot be read says so once and is not read again", async () => {
  let reads = 0;
  const { clock, watch, subscriber } = setup(async () => {
    reads += 1;
    return null;
  });
  const first = subscriber();
  await settle();
  watch.refresh();
  clock.advance(MACHINE_INTERVAL_MS * 2);
  await settle();
  const second = subscriber();
  await settle();
  expect(first.events).toEqual([{ type: "unavailable" }]);
  expect(second.events).toEqual([{ type: "unavailable" }]);
  expect(reads).toBe(1);
  first.leave();
  second.leave();
});

test("a failed read is logged and the next one still comes", async () => {
  let reads = 0;
  const { clock, logs, subscriber, used } = setup(async () => {
    reads += 1;
    if (reads === 1) throw new Error("proc went away");
    return machine(reads);
  });
  const first = subscriber();
  await settle();
  expect(logs).toEqual(["[office] machine reading failed: proc went away"]);
  clock.advance(MACHINE_INTERVAL_MS);
  await settle();
  expect(used(first.events)).toEqual([2]);
  first.leave();
});

test("a read under way when everyone left is dropped, and a newcomer gets a read of its own", async () => {
  let reads = 0;
  const releases: (() => void)[] = [];
  const { subscriber, used } = setup(async () => {
    reads += 1;
    const value = reads;
    await new Promise<void>((resolve) => {
      releases.push(resolve);
    });
    return machine(value);
  });
  const first = subscriber();
  await settle();
  first.leave();
  const second = subscriber();
  releases[0]?.();
  await settle();
  releases[1]?.();
  await settle();
  expect(used(first.events)).toEqual([]);
  expect(used(second.events)).toEqual([2]);
  second.leave();
});

test("stop ends every subscription and leaves no timer", async () => {
  const { clock, watch, subscriber } = setup();
  const first = subscriber();
  await settle();
  watch.stop();
  // The subscription itself ends when its signal aborts; stop only ends the reading.
  expect(clock.pending()).toBe(0);
  first.leave();
  await first.done;
});
