import { describe, expect, it } from "vitest";
import { createGate, type Gate, type GateConfig, type GateDeps } from "./gate.js";
import type { ServerNotice, ShimHello } from "./protocol.js";

const GIB = 1024 ** 3;
const START = 1_000_000;

interface TimerState {
  callback: (() => void) | null;
  ms: number | null;
  starts: number;
  stops: number;
}

interface Joined {
  id: string;
  pid: number;
  notices: ServerNotice[];
}

interface Harness {
  gate: Gate;
  clock: { now: number };
  /** While error is set, every memory reading throws it. */
  memory: { free: number | null; error: Error | null };
  rss: Map<number, number>;
  timer: TimerState;
  logs: string[];
  join(command: string, estimateGb: number, agentId?: string | null): Joined;
  advance(ms: number): void;
  /** Runs the gate's 2 s tick as its timer would. */
  tick(): void;
}

function hello(
  command: string,
  estimateGb: number,
  pid: number,
  agentId: string | null,
): ShimHello {
  return {
    type: "hello",
    version: 1,
    command,
    estimateBytes: estimateGb * GIB,
    agentId,
    process: {
      pid,
      startTime: 100 + pid,
      pidNamespace: "pid:[1]",
      bootId: "boot",
      initStartTime: 1,
    },
  };
}

// One slot and a 1 GB reserve, 16 GB free, unless a test changes them.
function createHarness(config: Partial<GateConfig> = {}): Harness {
  const clock = { now: START };
  const memory: { free: number | null; error: Error | null } = { free: 16 * GIB, error: null };
  const rss = new Map<number, number>();
  const timer: TimerState = { callback: null, ms: null, starts: 0, stops: 0 };
  const logs: string[] = [];
  let nextPid = 1000;
  const deps: GateDeps = {
    now: () => clock.now,
    readFreeMemory() {
      if (memory.error !== null) throw memory.error;
      return memory.free;
    },
    readRss: (shim) => rss.get(shim.pid) ?? null,
    startTimer(callback, ms) {
      timer.callback = callback;
      timer.ms = ms;
      timer.starts += 1;
      return () => {
        timer.callback = null;
        timer.stops += 1;
      };
    },
    log(message) {
      logs.push(message);
    },
  };
  const gate = createGate({
    config: { enabled: true, slots: 1, reserveBytes: GIB, ...config },
    deps,
  });
  return {
    gate,
    clock,
    memory,
    rss,
    timer,
    logs,
    join(command, estimateGb, agentId = "agent-1") {
      const notices: ServerNotice[] = [];
      nextPid += 1;
      const id = gate.join(hello(command, estimateGb, nextPid, agentId), {
        send(notice) {
          notices.push(notice);
        },
      });
      return { id, pid: nextPid, notices };
    },
    advance(ms) {
      clock.now += ms;
    },
    tick() {
      if (timer.callback === null) throw new Error("the gate's timer is not running");
      timer.callback();
    },
  };
}

describe("createGate", () => {
  it("starts a command at once when a slot is free", () => {
    const h = createHarness();
    const a = h.join("tsc --noEmit", 3);
    expect(a.notices).toEqual([
      { type: "go", forced: false, freeBytes: 16 * GIB, neededBytes: 4 * GIB, waitedMs: 0 },
    ]);
  });

  it("queues a second command and tells it that it waits on the slot", () => {
    const h = createHarness();
    h.join("tsc --noEmit", 3);
    const b = h.join("vitest run", 2);
    // 16 GB read, less the 3 GB the running command was promised: it has no RSS reading.
    expect(b.notices).toEqual([
      { type: "wait", ahead: 0, freeBytes: 13 * GIB, neededBytes: 3 * GIB, waitingOn: "slot" },
    ]);
  });

  it("tells a third command how many wait ahead of it", () => {
    const h = createHarness();
    h.join("tsc --noEmit", 3);
    h.join("vitest run", 2);
    const c = h.join("jest", 2);
    expect(c.notices).toEqual([
      { type: "wait", ahead: 1, freeBytes: 13 * GIB, neededBytes: 3 * GIB, waitingOn: "slot" },
    ]);
  });

  it("starts the next waiter when the running command leaves", () => {
    const h = createHarness();
    const a = h.join("tsc --noEmit", 3);
    const b = h.join("vitest run", 2);
    h.advance(5_000);
    h.gate.leave(a.id);
    expect(b.notices[1]).toEqual({
      type: "go",
      forced: false,
      freeBytes: 16 * GIB,
      neededBytes: 3 * GIB,
      waitedMs: 5_000,
    });
  });

  it("waits on memory when the estimate and the reserve do not fit", () => {
    const h = createHarness();
    h.memory.free = 3.5 * GIB;
    const a = h.join("tsc --noEmit", 3);
    expect(a.notices).toEqual([
      { type: "wait", ahead: 0, freeBytes: 3.5 * GIB, neededBytes: 4 * GIB, waitingOn: "memory" },
    ]);
  });

  it("shows a waiter the free memory left after what running commands were promised", () => {
    const h = createHarness({ slots: 2 });
    h.memory.free = 6 * GIB;
    h.join("tsc --noEmit", 3);
    // The running command has no RSS reading, so its whole 3 GB estimate is still promised.
    const b = h.join("npm run typecheck", 3);
    expect(b.notices).toEqual([
      { type: "wait", ahead: 0, freeBytes: 3 * GIB, neededBytes: 4 * GIB, waitingOn: "memory" },
    ]);
  });

  it("counts a command started in the same pass in the free memory a waiter is shown", () => {
    const h = createHarness({ slots: 2 });
    h.memory.free = 3.5 * GIB;
    const a = h.join("tsc --noEmit", 3);
    // Memory frees up as the next command arrives: one pass starts the first and queues the next.
    h.memory.free = 6 * GIB;
    const b = h.join("npm run typecheck", 3);
    expect(a.notices[1]).toEqual({
      type: "go",
      forced: false,
      freeBytes: 6 * GIB,
      neededBytes: 4 * GIB,
      waitedMs: 0,
    });
    expect(b.notices).toEqual([
      { type: "wait", ahead: 0, freeBytes: 3 * GIB, neededBytes: 4 * GIB, waitingOn: "memory" },
    ]);
  });

  it("never reports free memory below zero", () => {
    const h = createHarness();
    h.join("tsc --noEmit", 3);
    // 1 GB read, less the 3 GB the running command was promised.
    h.memory.free = GIB;
    expect(h.gate.snapshot().freeBytes).toBe(0);
  });

  it("reads memory again on every tick and starts the command once it fits", () => {
    const h = createHarness();
    h.memory.free = 3.5 * GIB;
    const a = h.join("tsc --noEmit", 3);
    h.memory.free = 8 * GIB;
    h.advance(2_000);
    h.tick();
    expect(a.notices[1]).toEqual({
      type: "go",
      forced: false,
      freeBytes: 8 * GIB,
      neededBytes: 4 * GIB,
      waitedMs: 2_000,
    });
  });

  it("repeats the wait notice every 30 s, not on every tick", () => {
    const h = createHarness();
    h.memory.free = GIB;
    const a = h.join("tsc --noEmit", 3);
    for (let tick = 0; tick < 14; tick += 1) {
      h.advance(2_000);
      h.tick();
    }
    expect(a.notices).toHaveLength(1);
    h.advance(2_000);
    h.tick();
    expect(a.notices).toHaveLength(2);
    expect(a.notices[1]).toMatchObject({ type: "wait", waitingOn: "memory" });
  });

  it("runs its 2 s timer only while commands wait", () => {
    const h = createHarness();
    const a = h.join("tsc --noEmit", 3);
    expect(h.timer.starts).toBe(0);
    h.join("vitest run", 2);
    expect(h.timer).toMatchObject({ starts: 1, ms: 2_000, stops: 0 });
    h.gate.leave(a.id);
    expect(h.timer).toMatchObject({ starts: 1, stops: 1, callback: null });
  });

  it("starts the oldest waiter after 5 minutes with nothing running, and logs no command line", () => {
    const h = createHarness();
    h.memory.free = GIB;
    const a = h.join("tsc --project secret-name", 3);
    h.advance(300_000);
    h.tick();
    expect(a.notices[1]).toEqual({
      type: "go",
      forced: true,
      freeBytes: GIB,
      neededBytes: 4 * GIB,
      waitedMs: 300_000,
    });
    expect(h.logs).toEqual([
      "heavy-command-gate: started a command after 5 min without enough free memory",
    ]);
    expect(h.gate.snapshot().running[0]?.forced).toBe(true);
  });

  it("starts every waiter when switched off, and gates again when switched on", () => {
    const h = createHarness();
    h.join("tsc --noEmit", 3);
    const b = h.join("vitest run", 2);
    const c = h.join("jest", 2);
    h.gate.configure({ enabled: false, slots: 1, reserveBytes: GIB });
    expect(b.notices[1]).toMatchObject({ type: "go", forced: false });
    expect(c.notices[1]).toMatchObject({ type: "go", forced: false });
    h.gate.configure({ enabled: true, slots: 1, reserveBytes: GIB });
    const d = h.join("tsc --noEmit", 3);
    // All three run without an RSS reading: 16 GB less 3 + 2 + 2 GB promised.
    expect(d.notices).toEqual([
      { type: "wait", ahead: 0, freeBytes: 9 * GIB, neededBytes: 4 * GIB, waitingOn: "slot" },
    ]);
  });

  it("starts a waiter at once when the slot count goes up", () => {
    const h = createHarness();
    h.join("tsc --noEmit", 3);
    const b = h.join("vitest run", 2);
    h.gate.configure({ enabled: true, slots: 2, reserveBytes: GIB });
    expect(b.notices[1]).toMatchObject({ type: "go", forced: false });
  });

  it("drops a waiter that leaves and moves the ones behind it up", () => {
    const h = createHarness();
    h.join("tsc --noEmit", 3);
    const b = h.join("vitest run", 2);
    const c = h.join("jest", 2);
    h.gate.leave(b.id);
    const { waiting } = h.gate.snapshot();
    expect(waiting.map((command) => [command.id, command.position])).toEqual([[c.id, 1]]);
  });

  it("reports running and waiting commands with their agents, pids, times and memory", () => {
    const h = createHarness();
    const a = h.join("tsc --noEmit", 3);
    const b = h.join("vitest run", 2, null);
    h.rss.set(a.pid, 2.5 * GIB);
    h.advance(7_000);
    // 16 GB read, less the 0.5 GB of its 3 GB estimate the running command does not use yet.
    expect(h.gate.snapshot()).toEqual({
      freeBytes: 15.5 * GIB,
      running: [
        {
          id: a.id,
          agentId: "agent-1",
          agentTitle: null,
          command: "tsc --noEmit",
          pid: a.pid,
          elapsedMs: 7_000,
          rssBytes: 2.5 * GIB,
          estimateBytes: 3 * GIB,
          forced: false,
        },
      ],
      waiting: [
        {
          id: b.id,
          agentId: null,
          agentTitle: null,
          command: "vitest run",
          pid: b.pid,
          position: 1,
          waitedMs: 7_000,
          estimateBytes: 2 * GIB,
          waitingOn: "slot",
        },
      ],
    });
  });

  it("clears everything when stopped and refuses new commands", () => {
    const h = createHarness();
    h.join("tsc --noEmit", 3);
    h.join("vitest run", 2);
    h.gate.stop();
    expect(h.timer.stops).toBe(1);
    expect(h.gate.snapshot()).toMatchObject({ running: [], waiting: [] });
    expect(() => h.join("jest", 2)).toThrow("the heavy-command gate is stopped");
  });

  it("keeps the queue moving when a shim cannot be told, and logs the failure", () => {
    const h = createHarness();
    const a = h.join("tsc --noEmit", 3);
    // A shim whose socket broke: every notice to it throws.
    const b = h.gate.join(hello("vitest run", 2, 9_000, "agent-1"), {
      send() {
        throw new Error("socket gone");
      },
    });
    const c = h.join("jest", 2);
    h.gate.configure({ enabled: true, slots: 3, reserveBytes: GIB });
    expect(c.notices[1]).toEqual({
      type: "go",
      forced: false,
      freeBytes: 16 * GIB,
      neededBytes: 3 * GIB,
      waitedMs: 0,
    });
    expect(h.gate.snapshot().running.map((command) => command.id)).toEqual([a.id, b, c.id]);
    expect(h.logs).toEqual([
      "heavy-command-gate: sending a notice to a shim failed: socket gone",
      "heavy-command-gate: sending a notice to a shim failed: socket gone",
    ]);
  });

  it("logs a tick that fails instead of throwing it into the timer", () => {
    const h = createHarness();
    const a = h.join("tsc --noEmit", 3);
    const b = h.join("vitest run", 2);
    h.memory.error = new Error("meminfo unreadable");
    h.advance(2_000);
    h.tick();
    expect(h.logs).toEqual([
      "heavy-command-gate: re-evaluating the queue failed: meminfo unreadable",
    ]);
    // The queue is intact: the next release starts the waiter.
    h.memory.error = null;
    h.gate.leave(a.id);
    expect(b.notices[1]).toEqual({
      type: "go",
      forced: false,
      freeBytes: 16 * GIB,
      neededBytes: 3 * GIB,
      waitedMs: 2_000,
    });
  });
});
