import type {
  PluginHandlerContext,
  PluginHookAgent,
  PluginServerContext,
  PluginSessionOpenRequest,
  PluginSettingsState,
} from "@getpaseo/plugin/server";
import { expect, test } from "vitest";
import { createOfficePlugin } from "./index.server.js";
import { EMPTY_BOARDS, type BoardStore } from "./server/board-store.js";
import { createFakeClock, settle } from "./server/fake-clock.js";
import type { officeHostSettings } from "./shared/settings.js";

type SettingsState = PluginSettingsState<typeof officeHostSettings.schema>;
type Handler = (input: object, context: PluginHandlerContext) => unknown;

interface Recorded {
  hooks: Map<string, Handler>;
  handlers: Map<string, Handler>;
  reads: number;
}

interface Sent {
  agentId: string;
  text: string;
  options: unknown;
}

const ON: SettingsState = { status: "ready", revision: "1", values: { agentTools: true } };
const OFF: SettingsState = { status: "ready", revision: "2", values: { agentTools: false } };
const OWN_TOOL = { name: "other_tool", description: "Another plugin's tool", inputSchema: {} };

/** The parts of the daemon's plugin API that the office calls. */
function fakeServer(recorded: Recorded, read: () => Promise<SettingsState>): PluginServerContext {
  return {
    registerSettings: () => ({
      read: () => {
        recorded.reads += 1;
        return read();
      },
      subscribe: () => () => undefined,
    }),
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

/** The daemon's API as hooks and handlers receive it: every agent exists, with the status given. */
function fakeContext(statuses: Map<string, string>, sent: Sent[]): PluginHandlerContext {
  return {
    signal: new AbortController().signal,
    paseo: {
      agents: {
        ref: (agentId: string) => ({
          refresh: async () => ({
            agent: {
              id: agentId,
              status: statuses.get(agentId) ?? "idle",
              archivedAt: null,
              pendingPermissions: [],
            },
            project: null,
          }),
          send: async (text: string, options?: unknown) => {
            sent.push({ agentId, text, options });
          },
        }),
      },
    },
  };
}

function memoryStore(): BoardStore {
  let current = EMPTY_BOARDS;
  return {
    load: async () => current,
    save: async (data) => {
      current = data;
    },
  };
}

function openRequest(overrides: Partial<PluginSessionOpenRequest>): PluginSessionOpenRequest {
  return {
    agentId: "agent-1",
    workspaceId: "w1",
    provider: "claude",
    cwd: "/workspace",
    reason: "create",
    purpose: "interactive",
    title: "Planner",
    background: false,
    labels: {},
    metadata: {},
    tools: [OWN_TOOL],
    env: {},
    mcpServers: {},
    ...overrides,
  };
}

function hookAgent(id: string): PluginHookAgent {
  return {
    id,
    workspaceId: "w1",
    parentAgentId: null,
    provider: "claude",
    cwd: "/workspace",
    title: null,
    background: false,
    metadata: {},
  };
}

function setup(read: () => Promise<SettingsState>) {
  const recorded: Recorded = { hooks: new Map(), handlers: new Map(), reads: 0 };
  const logs: string[] = [];
  const sent: Sent[] = [];
  const statuses = new Map<string, string>();
  const clock = createFakeClock(Date.parse("2026-11-11T09:00:00.000Z"));
  const context = fakeContext(statuses, sent);
  const stop = createOfficePlugin(fakeServer(recorded, read), {
    store: memoryStore(),
    clock,
    log: (message) => logs.push(message),
    vendorDirectory: null,
  });
  async function open(
    overrides: Partial<PluginSessionOpenRequest> = {},
  ): Promise<PluginSessionOpenRequest | undefined> {
    return recorded.hooks.get("agent.open.before")?.({ request: openRequest(overrides) }, context);
  }
  return { recorded, logs, sent, statuses, clock, context, stop, open };
}

test("an interactive session keeps its own tools and gets the three office tools", async () => {
  const { open, stop } = setup(async () => ON);
  const result = await open();
  expect(result?.tools.map((tool) => tool.name)).toEqual([
    "other_tool",
    "office_read",
    "office_post",
    "office_update",
  ]);
  // Nothing else of the request changes.
  expect({ ...result, tools: [] }).toEqual(openRequest({ tools: [] }));
  await stop();
});

test("a session opened before the setting is known waits for it, and gets no tools when it is off", async () => {
  let answer: (state: SettingsState) => void = () => undefined;
  const pending = new Promise<SettingsState>((resolve) => {
    answer = resolve;
  });
  const { open, stop } = setup(() => pending);
  const opening = open();
  answer(OFF);
  expect(await opening).toBeUndefined();
  await stop();
});

test("the setting is read at each open, so a change holds from the next session on", async () => {
  const states = [ON, OFF, ON];
  const { open, stop, recorded } = setup(async () => states[recorded.reads - 1] ?? ON);
  const results = [await open(), await open(), await open()];
  expect(results.map((result) => result?.tools.length)).toEqual([4, undefined, 4]);
  await stop();
});

test("a session opened to read history gets no tools, and the setting is not read for it", async () => {
  const { open, stop, recorded } = setup(async () => ON);
  expect(await open({ purpose: "history" })).toBeUndefined();
  expect(recorded.reads).toBe(0);
  await stop();
});

test("a setting that cannot be read leaves the session as it is and is logged", async () => {
  const { open, stop, logs } = setup(async () => {
    throw new Error("settings store is down");
  });
  expect(await open()).toBeUndefined();
  expect(logs).toEqual(["[office] agent.open.before failed: settings store is down"]);
  await stop();
});

test("a post made through the board call wakes the agent it names over the daemon's API", async () => {
  const { recorded, sent, context, stop } = setup(async () => ON);
  const post = recorded.handlers.get("office.post.request");
  const result = await post?.({ board: "w1", kind: "note", text: "Your turn", to: "b" }, context);
  await settle();
  expect(result).toEqual({
    ok: true,
    post: {
      id: "p1",
      seq: 1,
      board: "w1",
      kind: "note",
      text: "Your turn",
      to: "b",
      author: "user",
      createdAt: "2026-11-11T09:00:00.000Z",
      updatedAt: "2026-11-11T09:00:00.000Z",
    },
  });
  expect(sent).toEqual([
    {
      agentId: "b",
      text: "Office board: 1 post(s) for you.\n- p1 from the user: Your turn",
      options: { activeTurnBehavior: "steer" },
    },
  ]);
  await stop();
});

test("a post for a running agent goes out when its turn ends", async () => {
  const { recorded, sent, statuses, context, stop } = setup(async () => ON);
  statuses.set("b", "running");
  const post = recorded.handlers.get("office.post.request");
  await post?.({ board: "w1", kind: "note", text: "Your turn", to: "b" }, context);
  await settle();
  expect(sent).toEqual([]);
  statuses.set("b", "idle");
  await recorded.hooks.get("agent.turn.after")?.({ agent: hookAgent("b") }, context);
  await settle();
  expect(sent.map((item) => item.agentId)).toEqual(["b"]);
  await stop();
});

test("the entry serves the office state, the asset and the four board calls, and stopping removes its hooks and timers", async () => {
  const { recorded, clock, stop } = setup(async () => ON);
  await settle();
  expect([...recorded.handlers.keys()]).toEqual([
    "office.state",
    "office.asset.request",
    "office.post.request",
    "office.update.request",
    "office.delete.request",
    "office.set_wakes_paused.request",
  ]);
  expect([...recorded.hooks.keys()]).toEqual([
    "agent.open.before",
    "agent.turn.after",
    "agent.close.after",
    "agent.archive.after",
    "workspace.archive.after",
  ]);
  // The hourly prune is waiting.
  expect(clock.pending()).toBe(1);
  await stop();
  expect(recorded.hooks.size).toBe(0);
  expect(clock.pending()).toBe(0);
});
