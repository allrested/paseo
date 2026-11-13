import { describe, expect, it } from "vitest";
import type { Bridge } from "./bridge.js";
import { createBridges, TooManyDesigns } from "./bridges.js";

function fakeClock() {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let next = 1;
  return {
    setTimeout(fn: () => void, ms: number) {
      const id = next++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout(id: unknown) {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    advance(ms: number) {
      now += ms;
      for (const due of timers.filter((timer) => timer.at <= now)) {
        timers.splice(timers.indexOf(due), 1);
        due.fn();
      }
    },
  };
}

function fakeBridge() {
  let exit: ((reason: string) => void) | null = null;
  const bridge = {
    closed: 0,
    onExit(listener: (reason: string) => void) {
      exit = listener;
    },
    async close() {
      bridge.closed += 1;
    },
    crash(reason: string) {
      exit?.(reason);
    },
  };
  return bridge;
}

function setup(max = 2) {
  const clock = fakeClock();
  const made: ReturnType<typeof fakeBridge>[] = [];
  const statuses: string[] = [];
  const bridges = createBridges({
    max,
    idleMs: 300_000,
    openBridge: async () => {
      const b = fakeBridge();
      made.push(b);
      return b as unknown as Bridge;
    },
    clock,
    log: () => {},
    onStatus: (fileId, status) => statuses.push(`${fileId}:${status.status}`),
  });
  return { bridges, clock, made, statuses };
}

const viewer = (id: string) => ({ kind: "viewer" as const, id });
const agent = (id: string) => ({ kind: "agent" as const, id });

describe("bridges", () => {
  it("shares one bridge per file between holders", async () => {
    const { bridges, made } = setup();
    const a = await bridges.acquire("f1", viewer("v1"));
    const b = await bridges.acquire("f1", agent("a1"));
    expect(a).toBe(b);
    expect(made).toHaveLength(1);
  });
  it("stops a bridge 5 minutes after its last holder leaves, not before", async () => {
    const { bridges, clock, made } = setup();
    await bridges.acquire("f1", viewer("v1"));
    bridges.release("f1", viewer("v1"));
    clock.advance(299_000);
    expect(made[0].closed).toBe(0);
    await bridges.acquire("f1", viewer("v2"));
    bridges.release("f1", viewer("v2"));
    clock.advance(300_000);
    await new Promise((r) => setTimeout(r, 0));
    expect(made[0].closed).toBe(1);
    expect(bridges.running()).toEqual([]);
  });
  it("refuses a file over the cap", async () => {
    const { bridges } = setup(2);
    await bridges.acquire("f1", viewer("v"));
    await bridges.acquire("f2", viewer("v"));
    await expect(bridges.acquire("f3", viewer("v"))).rejects.toThrow(new TooManyDesigns(2));
  });
  it("restarts a crashed bridge once, then marks it failed", async () => {
    const { bridges, made, statuses } = setup();
    await bridges.acquire("f1", viewer("v1"));
    made[0].crash("exited with 3");
    await new Promise((r) => setTimeout(r, 0));
    expect(made).toHaveLength(2);
    made[1].crash("exited with 3");
    await new Promise((r) => setTimeout(r, 0));
    expect(made).toHaveLength(2);
    expect(bridges.status("f1")).toEqual({
      status: "failed",
      error: "Bridge stopped: exited with 3",
    });
    expect(statuses).toContain("f1:failed");
  });
  it("releases every file an agent held when the agent goes", async () => {
    const { bridges, clock, made } = setup();
    await bridges.acquire("f1", agent("a1"));
    await bridges.acquire("f2", agent("a1"));
    bridges.releaseAgent("a1");
    clock.advance(300_000);
    await new Promise((r) => setTimeout(r, 0));
    expect(made.map((b) => b.closed)).toEqual([1, 1]);
  });
  it("says starting until the bridge has joined, then running", async () => {
    const clock = fakeClock();
    let finish: (bridge: Bridge) => void = () => {};
    const bridges = createBridges({
      max: 2,
      idleMs: 300_000,
      openBridge: () => new Promise<Bridge>((resolve) => (finish = resolve)),
      clock,
      log: () => {},
      onStatus: () => {},
    });
    const opening = bridges.acquire("f1", viewer("v1"));
    expect(bridges.status("f1")).toEqual({ status: "starting" });
    finish(fakeBridge() as unknown as Bridge);
    await opening;
    expect(bridges.status("f1")).toEqual({ status: "running" });
  });
  it("forgets a file whose bridge could not open, so the next open tries again", async () => {
    let attempts = 0;
    const bridges = createBridges({
      max: 1,
      idleMs: 300_000,
      openBridge: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("server down");
        return fakeBridge() as unknown as Bridge;
      },
      clock: fakeClock(),
      log: () => {},
      onStatus: () => {},
    });
    await expect(bridges.acquire("f1", viewer("v1"))).rejects.toThrow("server down");
    expect(bridges.status("f1")).toEqual({ status: "failed", error: "server down" });
    await expect(bridges.acquire("f1", viewer("v1"))).resolves.toBeDefined();
    expect(bridges.running()).toEqual(["f1"]);
  });
});
