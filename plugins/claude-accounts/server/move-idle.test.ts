import { describe, expect, it } from "vitest";
import type { MoveJob } from "../shared/rpc.js";
import type { AgentInfo, MoveOutcome } from "./api.js";
import { MoveIdleRunner, isIdle, type MoveApi } from "./move-idle.js";

function agent(id: string, provider: string, overrides: Partial<AgentInfo> = {}): AgentInfo {
  return { id, provider, cwd: "/repo", status: "idle", inTurn: false, ...overrides };
}

interface MoveCall {
  agentId: string;
  provider: string;
  guardedHere: boolean;
  guardedElsewhere: boolean;
}

/** Agents as the daemon would list them; `now` overrides what a later read returns. */
class FakeMoveApi implements MoveApi {
  readonly calls: MoveCall[] = [];
  readonly now = new Map<string, AgentInfo | null>();
  readonly failures = new Map<string, Error>();
  readonly handoffs = new Set<string>();
  gate: Promise<void> | null = null;
  runner: MoveIdleRunner | null = null;
  listFailure: Error | null = null;

  constructor(readonly agents: AgentInfo[]) {}

  async listAgents(): Promise<AgentInfo[]> {
    if (this.listFailure) throw this.listFailure;
    return this.agents;
  }

  async getAgent(agentId: string): Promise<AgentInfo | null> {
    if (this.now.has(agentId)) return this.now.get(agentId) ?? null;
    return this.agents.find((candidate) => candidate.id === agentId) ?? null;
  }

  async moveAgent(agentId: string, provider: string): Promise<MoveOutcome> {
    this.calls.push({
      agentId,
      provider,
      guardedHere: this.runner?.movingToMain("/repo") ?? false,
      guardedElsewhere: this.runner?.movingToMain("/other") ?? false,
    });
    if (this.gate) await this.gate;
    const failure = this.failures.get(agentId);
    if (failure) throw failure;
    return {
      agentId: `${agentId}-next`,
      strategy: this.handoffs.has(agentId) ? "handoff" : "native",
    };
  }
}

interface Gate {
  promise: Promise<void>;
  open(): void;
}

function gate(): Gate {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open: () => open() };
}

function runnerFor(api: FakeMoveApi): MoveIdleRunner {
  const runner = new MoveIdleRunner((error) => {
    throw error;
  });
  api.runner = runner;
  return runner;
}

describe("isIdle", () => {
  it("counts idle, failed and closed agents without a turn", () => {
    expect(isIdle(agent("a", "claude"))).toBe(true);
    expect(isIdle(agent("a", "claude", { status: "error" }))).toBe(true);
    expect(isIdle(agent("a", "claude", { status: "closed" }))).toBe(true);
    expect(isIdle(agent("a", "claude", { status: "running" }))).toBe(false);
    expect(isIdle(agent("a", "claude", { status: "initializing" }))).toBe(false);
    expect(isIdle(agent("a", "claude", { inTurn: true }))).toBe(false);
  });
});

describe("MoveIdleRunner", () => {
  it("moves the idle agents of one account one at a time", async () => {
    const api = new FakeMoveApi([
      agent("a", "claude"),
      agent("b", "claude", { status: "error" }),
      agent("c", "claude", { status: "running" }),
      agent("d", "claude-work"),
      agent("e", "claude", { inTurn: true }),
    ]);
    api.handoffs.add("b");
    const runner = runnerFor(api);

    const started = await runner.start(api, "claude", "claude-work");
    await runner.settled();

    expect(started).toEqual({
      ok: true,
      job: {
        from: "claude",
        to: "claude-work",
        total: 2,
        busy: 2,
        moved: 0,
        handedOff: 0,
        skipped: 0,
        failed: [],
        done: false,
      },
    });
    const finished: MoveJob = {
      from: "claude",
      to: "claude-work",
      total: 2,
      busy: 2,
      moved: 2,
      handedOff: 1,
      skipped: 0,
      failed: [],
      done: true,
    };
    expect(runner.current()).toEqual(finished);
    expect(api.calls.map((call) => call.agentId)).toEqual(["a", "b"]);
  });

  it("skips an agent that started a turn before its move and records a failed move", async () => {
    const api = new FakeMoveApi([agent("a", "claude"), agent("b", "claude"), agent("c", "claude")]);
    api.now.set("b", agent("b", "claude", { inTurn: true }));
    api.failures.set("c", new Error("Provider unavailable"));
    const runner = runnerFor(api);

    await runner.start(api, "claude", "claude-work");
    await runner.settled();

    expect(runner.current()).toEqual({
      from: "claude",
      to: "claude-work",
      total: 3,
      busy: 0,
      moved: 1,
      handedOff: 0,
      skipped: 1,
      failed: [{ agentId: "c", error: "Provider unavailable" }],
      done: true,
    });
    expect(api.calls.map((call) => call.agentId)).toEqual(["a", "c"]);
  });

  it("refuses a second job while one runs, and accepts one after it finished", async () => {
    const api = new FakeMoveApi([agent("a", "claude")]);
    const blocked = gate();
    api.gate = blocked.promise;
    const runner = runnerFor(api);

    await runner.start(api, "claude", "claude-work");
    expect(await runner.start(api, "claude", "claude-team")).toEqual({
      ok: false,
      error: "Agents are still moving. Wait for that move to finish.",
    });
    blocked.open();
    await runner.settled();

    api.gate = null;
    expect((await runner.start(api, "claude-work", "claude")).ok).toBe(true);
    await runner.settled();
  });

  it("guards creations in the moving agent's directory only while it moves to claude", async () => {
    const toMain = new FakeMoveApi([agent("a", "claude-work")]);
    const mainRunner = runnerFor(toMain);
    await mainRunner.start(toMain, "claude-work", "claude");
    await mainRunner.settled();

    expect(toMain.calls).toEqual([
      { agentId: "a", provider: "claude", guardedHere: true, guardedElsewhere: false },
    ]);
    expect(mainRunner.movingToMain("/repo")).toBe(false);

    const toWork = new FakeMoveApi([agent("a", "claude")]);
    const workRunner = runnerFor(toWork);
    await workRunner.start(toWork, "claude", "claude-work");
    await workRunner.settled();

    expect(toWork.calls).toEqual([
      { agentId: "a", provider: "claude-work", guardedHere: false, guardedElsewhere: false },
    ]);
  });

  it("starts no further move once stopped", async () => {
    const api = new FakeMoveApi([agent("a", "claude"), agent("b", "claude")]);
    const blocked = gate();
    api.gate = blocked.promise;
    const runner = runnerFor(api);

    await runner.start(api, "claude", "claude-work");
    runner.stop();
    blocked.open();
    await runner.settled();

    expect(api.calls.map((call) => call.agentId)).toEqual(["a"]);
    expect(runner.current()?.done).toBe(true);
  });

  it("frees the runner when listing the agents fails", async () => {
    const api = new FakeMoveApi([agent("a", "claude")]);
    api.listFailure = new Error("daemon gone");
    const runner = runnerFor(api);

    await expect(runner.start(api, "claude", "claude-work")).rejects.toThrow("daemon gone");
    expect(runner.current()).toBeNull();

    api.listFailure = null;
    expect((await runner.start(api, "claude", "claude-work")).ok).toBe(true);
    await runner.settled();
  });
});
