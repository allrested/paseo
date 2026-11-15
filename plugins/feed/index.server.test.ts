import type {
  PluginHandlerContext,
  PluginHookAgent,
  PluginServerContext,
} from "@getpaseo/plugin/server";
import { expect, test } from "vitest";
import { createFeedPlugin } from "./index.server.js";
import type { FeedStore } from "./server/feed-store.js";
import type { TimelineEntry } from "./server/summary.js";
import type { FeedEvent } from "./shared/contracts.js";
import { EMPTY_FEED } from "./shared/feed.js";

type Handler = (input: object, context: object) => unknown;

interface Recorded {
  hooks: Map<string, Handler>;
  handlers: Map<string, Handler>;
}

/** The parts of the daemon's plugin API that the feed calls. */
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

/** The daemon's API as a hook receives it: every agent's timeline ends with these entries. */
function hookContext(tail: () => Promise<TimelineEntry[]>): PluginHandlerContext {
  return {
    signal: new AbortController().signal,
    paseo: {
      agents: {
        ref: () => ({ timeline: { refetch: async () => ({ entries: await tail() }) } }),
      },
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

const settle = () => new Promise((done) => setTimeout(done, 0));

function setup(tail: () => Promise<TimelineEntry[]> = async () => []) {
  const recorded: Recorded = { hooks: new Map(), handlers: new Map() };
  const logs: string[] = [];
  const store: FeedStore = { load: async () => EMPTY_FEED, save: async () => {} };
  let ids = 0;
  const dispose = createFeedPlugin(fakeServer(recorded), {
    store,
    now: () => "2026-11-15T09:00:00.000Z",
    newId: () => `id-${(ids += 1)}`,
    log: (message) => logs.push(message),
  });
  const context = hookContext(tail);
  const hook = (name: string, payload: object) => recorded.hooks.get(name)?.(payload, context);
  const events: FeedEvent[] = [];
  void recorded.handlers.get("feed.state")?.(
    {},
    {
      push: async (event: FeedEvent) => void events.push(event),
      signal: new AbortController().signal,
    },
  );
  return { recorded, logs, hook, events, dispose };
}

const said = (text: string): TimelineEntry => ({
  turnId: "t1",
  item: { type: "assistant_message", text },
});

test("a finished turn reaches the feed with the agent's last line", async () => {
  const { hook, events } = setup(async () => [
    said("Tax is now added after rounding.\n\nTests pass."),
  ]);
  await settle();

  await hook("agent.turn.after", { agent: agent(), turnId: "t1", outcome: { kind: "completed" } });

  expect(events).toEqual([
    { type: "state", state: EMPTY_FEED },
    {
      type: "added",
      entry: {
        id: "id-1",
        at: "2026-11-15T09:00:00.000Z",
        kind: "finished",
        agentId: "a1",
        title: "Checkout total",
        folder: "/work/shop",
        text: "Tax is now added after rounding.",
      },
    },
  ]);
});

test("a permission is in the feed until it is answered", async () => {
  const { hook, events } = setup();
  await settle();
  const request = {
    id: "req-1",
    provider: "claude",
    name: "Bash",
    kind: "tool",
    title: "Run npm install",
  };

  await hook("agent.permission.before", { agent: agent(), request });
  await hook("agent.permission.after", {
    agent: agent(),
    requestId: "req-1",
    resolution: { behavior: "allow" },
  });

  expect(events.slice(1)).toEqual([
    {
      type: "added",
      entry: expect.objectContaining({ kind: "permission", text: "Run npm install" }),
    },
    { type: "removed", ids: ["id-1"] },
  ]);
});

test.each(["agent.close.after", "agent.archive.after"])(
  "a permission goes when its agent does (%s)",
  async (name) => {
    const { hook, events } = setup();
    await settle();
    const request = { id: "req-1", provider: "claude", name: "Bash", kind: "tool" };
    await hook("agent.permission.before", { agent: agent(), request });

    await hook(name, { agent: agent() });

    expect(events.at(-1)).toEqual({ type: "removed", ids: ["id-1"] });
  },
);

test("a stopped turn is no news, and takes the agent's open permission with it", async () => {
  const { hook, events } = setup();
  await settle();
  const request = { id: "req-1", provider: "claude", name: "Bash", kind: "tool" };
  await hook("agent.permission.before", { agent: agent(), request });

  await hook("agent.turn.after", {
    agent: agent(),
    turnId: "t1",
    outcome: { kind: "canceled", reason: "interrupted" },
  });

  expect(events.slice(1).map((event) => event.type)).toEqual(["added", "removed"]);
});

test("a helper's turns and permissions stay out", async () => {
  const { hook, events } = setup(async () => [said("Done.")]);
  await settle();
  const helper = agent({ id: "h1", background: true });

  await hook("agent.turn.after", { agent: helper, turnId: "t1", outcome: { kind: "completed" } });
  await hook("agent.permission.before", {
    agent: helper,
    request: { id: "req-1", provider: "claude", name: "Bash", kind: "tool" },
  });

  expect(events).toEqual([{ type: "state", state: EMPTY_FEED }]);
});

test("opening the feed marks it seen at the host's time", async () => {
  const { recorded, events } = setup();
  await settle();

  expect(await recorded.handlers.get("feed.seen.request")?.({}, {})).toEqual({
    seenAt: "2026-11-15T09:00:00.000Z",
  });
  expect(events.at(-1)).toEqual({ type: "seen", seenAt: "2026-11-15T09:00:00.000Z" });
});

test("a hook that fails is logged and does not throw into the daemon", async () => {
  const { hook, logs } = setup();
  await settle();

  // No agent in the payload: reading its id throws inside the hook.
  await expect(
    hook("agent.turn.after", { turnId: "t1", outcome: { kind: "completed" } }),
  ).resolves.toBeUndefined();
  await expect(hook("agent.permission.before", {})).resolves.toBeUndefined();
  await expect(hook("agent.close.after", {})).resolves.toBeUndefined();

  expect(logs).toHaveLength(3);
  expect(logs[0]).toContain("[feed] agent.turn.after failed");
});

test("disposing takes the hooks away", () => {
  const { recorded, dispose } = setup();

  dispose();

  expect(recorded.hooks.size).toBe(0);
});
