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

/** An agent as the daemon lists it. */
const listed = (id: string) => ({ agent: { id, title: `Agent ${id}`, cwd: "/work/api" } });
const NO_AGENTS = async () => ({ entries: [], pageInfo: { hasMore: false, nextCursor: null } });

function setup(
  tail: () => Promise<TimelineEntry[]> = async () => [],
  /** The daemon's answer when the feed asks which agents run. */
  list: (request: object) => Promise<object> = NO_AGENTS,
) {
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
  /** A device opens the feed. */
  const open = (into: FeedEvent[]) =>
    void recorded.handlers.get("feed.state")?.(
      {},
      {
        push: async (event: FeedEvent) => void into.push(event),
        signal: new AbortController().signal,
        paseo: { agents: { list } },
      },
    );
  open(events);
  return { recorded, logs, hook, events, open, dispose };
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

  await hook("agent.turn.before", { agent: helper, turnId: "t1" });
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

test("marking an entry unread reaches the feed, and marking it read takes the mark back", async () => {
  const { recorded, hook, events } = setup();
  await settle();
  await hook("agent.turn.after", { agent: agent(), turnId: "t1", outcome: { kind: "completed" } });
  const mark = recorded.handlers.get("feed.unread.request");

  expect(await mark?.({ id: "id-1", unread: true }, {})).toEqual({});
  expect(await mark?.({ id: "id-1", unread: false }, {})).toEqual({});

  expect(events.slice(-2)).toEqual([
    { type: "marked", id: "id-1", unread: true },
    { type: "marked", id: "id-1", unread: false },
  ]);
});

test("an agent is listed as running from the start of its turn to its end", async () => {
  const { hook, events } = setup();
  await settle();

  await hook("agent.turn.before", { agent: agent(), turnId: "t1" });
  await hook("agent.turn.after", {
    agent: agent(),
    turnId: "t1",
    outcome: { kind: "canceled", reason: "interrupted" },
  });

  expect(events.slice(1)).toEqual([
    {
      type: "started",
      agent: {
        agentId: "a1",
        title: "Checkout total",
        folder: "/work/shop",
        since: "2026-11-15T09:00:00.000Z",
      },
    },
    { type: "stopped", agentId: "a1" },
  ]);
});

test.each(["agent.close.after", "agent.archive.after"])(
  "an agent that goes in a turn (%s) runs no more",
  async (name) => {
    const { hook, events } = setup();
    await settle();
    await hook("agent.turn.before", { agent: agent(), turnId: "t1" });

    await hook(name, { agent: agent() });

    expect(events.at(-1)).toEqual({ type: "stopped", agentId: "a1" });
  },
);

test("the turns that began before the plugin are found when the feed is first opened, once", async () => {
  const requests: object[] = [];
  const { events, open } = setup(undefined, async (request) => {
    requests.push(request);
    return { entries: [listed("early")], pageInfo: { hasMore: false, nextCursor: null } };
  });
  await settle();

  expect(events.slice(1)).toEqual([
    {
      type: "started",
      agent: { agentId: "early", title: "Agent early", folder: "/work/api", since: null },
    },
  ]);
  // A second device gets it in the feed, and the daemon is not asked again.
  const second: FeedEvent[] = [];
  open(second);
  await settle();
  expect(second).toHaveLength(1);
  expect(second[0]).toMatchObject({ state: { running: [{ agentId: "early" }] } });
  expect(requests).toHaveLength(1);
});

test("a daemon that cannot list its agents is logged, and the feed still opens", async () => {
  const { hook, events, logs } = setup(undefined, () => Promise.reject(new Error("no list")));
  await settle();

  expect(logs).toEqual(["[feed] the running agents could not be listed: no list"]);
  expect(events).toEqual([{ type: "state", state: EMPTY_FEED }]);
  await hook("agent.turn.before", { agent: agent(), turnId: "t1" });
  expect(events.at(-1)).toMatchObject({ type: "started" });
});
