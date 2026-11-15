import type { Machine, MachineEvent } from "../../shared/contracts.js";
import { errorMessage } from "../errors.js";
import type { Timers } from "../timers.js";

/** Memory and ports change slowly, and a reading walks every process on the host. */
export const MACHINE_INTERVAL_MS = 10_000;

export interface MachineSubscriber {
  push(event: MachineEvent): Promise<void>;
  signal: AbortSignal;
}

export interface MachineWatchPorts {
  /** Null on a host that cannot be read. */
  read(): Promise<Machine | null>;
  timers: Timers;
  log(message: string): void;
}

export interface MachineWatch {
  /** Streams readings to one subscriber. Resolves when its signal aborts. */
  attach(subscriber: MachineSubscriber): Promise<void>;
  /** Reads now, ahead of the timer: something was just cleaned up. */
  refresh(): void;
  stop(): void;
}

/** Reads the host while someone listens: now, then every interval after the read before it. */
export function createMachineWatch(ports: MachineWatchPorts): MachineWatch {
  const subscribers = new Set<MachineSubscriber>();
  let latest: MachineEvent | null = null;
  let cancel: (() => void) | null = null;
  let reading = false;
  let again = false;
  // Moves on whenever the last subscriber leaves, so a read that was under way then is dropped.
  let generation = 0;

  function send(subscriber: MachineSubscriber, event: MachineEvent): void {
    if (subscriber.signal.aborted) return;
    subscriber
      .push(event)
      .catch((error: unknown) => ports.log(`[office] machine push failed: ${errorMessage(error)}`));
  }

  async function run(): Promise<void> {
    const mine = generation;
    cancel = null;
    reading = true;
    let event: MachineEvent | null = null;
    try {
      const machine = await ports.read();
      event = machine === null ? { type: "unavailable" } : { type: "reading", machine };
    } catch (error) {
      ports.log(`[office] machine reading failed: ${errorMessage(error)}`);
    }
    reading = false;
    if (mine !== generation) {
      // Everyone left during the read. Someone who came since waits for a read of their own.
      if (subscribers.size > 0) start();
      return;
    }
    if (event !== null) {
      latest = event;
      for (const subscriber of subscribers) send(subscriber, event);
    }
    // A host without /proc never gets one: the answer stands, and nothing is read again.
    if (event?.type === "unavailable") return;
    if (again) {
      again = false;
      start();
    } else {
      cancel = ports.timers.setTimeout(start, MACHINE_INTERVAL_MS);
    }
  }

  function start(): void {
    run().catch((error: unknown) => ports.log(`[office] machine failed: ${errorMessage(error)}`));
  }

  function leave(subscriber: MachineSubscriber): void {
    subscribers.delete(subscriber);
    if (subscribers.size > 0) return;
    generation += 1;
    cancel?.();
    cancel = null;
    latest = null;
    again = false;
  }

  return {
    attach(subscriber) {
      if (subscriber.signal.aborted) return Promise.resolve();
      subscribers.add(subscriber);
      if (latest !== null) send(subscriber, latest);
      else if (!reading && cancel === null) start();
      return new Promise((resolve) => {
        subscriber.signal.addEventListener(
          "abort",
          () => {
            leave(subscriber);
            resolve();
          },
          { once: true },
        );
      });
    },
    refresh() {
      if (subscribers.size === 0 || latest?.type === "unavailable") return;
      if (reading) {
        again = true;
        return;
      }
      cancel?.();
      start();
    },
    stop() {
      // Deleting the member a Set's iterator stands on is safe.
      for (const subscriber of subscribers) leave(subscriber);
    },
  };
}
