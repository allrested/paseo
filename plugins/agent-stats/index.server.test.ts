import type { PluginHookAgent, PluginServerContext } from "@getpaseo/plugin/server";
import { expect, test } from "vitest";
import { createAgentStatsPlugin } from "./index.server.js";
import type { StatsStore } from "./server/stats-store.js";

type Handler = (input: object, context: object) => unknown;

interface Recorded {
  hooks: Map<string, Handler>;
  handlers: Map<string, Handler>;
}

/** The parts of the daemon's plugin API that the plugin calls. */
function fakeServer(recorded: Recorded): PluginServerContext {
  return {
    handle: (contract: { name: string }, handler: Handler) => {
      recorded.handlers.set(contract.name, handler);
    },
    addHook: (name: string, hook: Handler) => {
      recorded.hooks.set(name, hook);
      return () => {
        recorded.hooks.delete(name);
      };
    },
  };
}

function agent(overrides: Partial<PluginHookAgent> = {}): PluginHookAgent {
  return {
    id: "a1",
    workspaceId: "w1",
    parentAgentId: null,
    provider: "claude",
    cwd: "/work/shop",
    title: "Checkout total",
    background: false,
    metadata: {},
    ...overrides,
  };
}

function setup() {
  const recorded: Recorded = { hooks: new Map(), handlers: new Map() };
  const logs: string[] = [];
  const store: StatsStore = { load: async () => null, save: async () => {} };
  const clock = { now: Date.parse("2026-11-15T10:00:00Z") };
  const dispose = createAgentStatsPlugin(fakeServer(recorded), {
    store,
    now: () => clock.now,
    log: (message) => logs.push(message),
  });
  const hook = (name: string, payload: object) => recorded.hooks.get(name)?.(payload, {});
  /** Reads everything, as a client would; the host has one workspace. */
  const read = (
    list = async () => ({
      entries: [{ id: "w1", name: "Checkout" }],
      pageInfo: { hasMore: false, nextCursor: null },
    }),
  ) =>
    recorded.handlers.get("stats.read.request")?.(
      { since: "2000-01-01T00" },
      { paseo: { workspaces: { list } } },
    );
  return {
    recorded,
    logs,
    hook,
    read,
    dispose,
    wait: (ms: number) => (clock.now += ms),
  };
}

test("a turn is counted from its start to its end, under its workspace's name", async () => {
  const { hook, read, wait } = setup();

  await hook("agent.turn.before", { agent: agent(), turnId: "t1" });
  wait(90_000);
  await hook("agent.turn.after", { agent: agent(), turnId: "t1", outcome: { kind: "completed" } });

  expect(await read()).toEqual({
    hours: [{ hour: "2026-11-15T10", workspaceId: "w1", turns: 1, failed: 0, workMs: 90_000 }],
    workspaces: [{ id: "w1", name: "Checkout", open: true }],
    countingSince: "2026-11-15T10:00:00.000Z",
  });
});

test("a failed turn is counted as failed; a stopped one is a turn like any other", async () => {
  const { hook, read } = setup();

  await hook("agent.turn.after", {
    agent: agent(),
    turnId: "t1",
    outcome: { kind: "failed", error: { message: "Rate limit" } },
  });
  await hook("agent.turn.after", {
    agent: agent(),
    turnId: "t2",
    outcome: { kind: "canceled", reason: "interrupted" },
  });

  expect(await read()).toMatchObject({ hours: [{ turns: 2, failed: 1 }] });
});

test("a helper's turns are not counted", async () => {
  const { hook, read } = setup();
  const helper = agent({ id: "h1", background: true });

  await hook("agent.turn.before", { agent: helper, turnId: "t1" });
  await hook("agent.turn.after", { agent: helper, turnId: "t1", outcome: { kind: "completed" } });

  expect(await read()).toMatchObject({ hours: [] });
});

test.each(["agent.close.after", "agent.archive.after"])(
  "an agent that goes in a turn (%s) leaves the turn's time out",
  async (name) => {
    const { hook, read, wait } = setup();
    await hook("agent.turn.before", { agent: agent(), turnId: "t1" });
    wait(60_000);

    await hook(name, { agent: agent() });
    await hook("agent.turn.after", {
      agent: agent(),
      turnId: "t1",
      outcome: { kind: "canceled", reason: "closed" },
    });

    expect(await read()).toMatchObject({ hours: [{ turns: 1, workMs: 0 }] });
  },
);

test("a screen is told when a turn ends", async () => {
  const { recorded, hook } = setup();
  const events: unknown[] = [];
  void recorded.handlers.get("stats.changes")?.(
    {},
    {
      push: async (event: unknown) => void events.push(event),
      signal: new AbortController().signal,
    },
  );

  await hook("agent.turn.after", { agent: agent(), turnId: "t1", outcome: { kind: "completed" } });

  expect(events).toEqual([{ type: "changed" }]);
});

test("a hook that fails is logged and does not throw into the daemon", async () => {
  const { hook, logs } = setup();

  // No agent in the payload: reading it throws inside the hook.
  for (const name of [
    "agent.turn.before",
    "agent.turn.after",
    "agent.close.after",
    "agent.archive.after",
  ]) {
    await expect(hook(name, {})).resolves.toBeUndefined();
  }

  expect(logs).toHaveLength(4);
  expect(logs[1]).toContain("[agent-stats] agent.turn.after failed");
});

test("disposing takes the hooks away", () => {
  const { recorded, dispose } = setup();

  dispose();

  expect(recorded.hooks.size).toBe(0);
});
