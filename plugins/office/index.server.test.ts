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
type SettingsListener = (state: SettingsState) => void | Promise<void>;

interface Recorded {
  hooks: Map<string, Handler>;
  handlers: Map<string, Handler>;
  reads: number;
  /** Who follows the settings: the daemon calls each after a save. */
  listeners: Set<SettingsListener>;
  /** The office's calls on its schedules, as "upsert <name> <expression> <zone>" or "remove <name>". */
  schedules: string[];
}

interface Sent {
  agentId: string;
  text: string;
  options: unknown;
}

const NO_NOTES = { notesFolder: "", notesTimeZone: "" };
const ON: SettingsState = {
  status: "ready",
  revision: "1",
  values: { agentTools: true, ...NO_NOTES },
};
const OFF: SettingsState = {
  status: "ready",
  revision: "2",
  values: { agentTools: false, ...NO_NOTES },
};
const OWN_TOOL = { name: "other_tool", description: "Another plugin's tool", inputSchema: {} };

/** The parts of the daemon's plugin API that the office calls. */
function fakeServer(recorded: Recorded, read: () => Promise<SettingsState>): PluginServerContext {
  return {
    registerSettings: () => ({
      read: () => {
        recorded.reads += 1;
        return read();
      },
      subscribe: (listener: SettingsListener) => {
        recorded.listeners.add(listener);
        return () => {
          recorded.listeners.delete(listener);
        };
      },
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
    schedules: {
      upsert: async ({
        name,
        cadence,
      }: {
        name: string;
        cadence: { expression: string; timezone: string };
      }) => {
        recorded.schedules.push(`upsert ${name} ${cadence.expression} ${cadence.timezone}`);
        return { id: "s1", nextRunAt: null };
      },
      remove: async (name: string) => {
        recorded.schedules.push(`remove ${name}`);
        return false;
      },
      list: async () => [],
    },
  };
}

/** The daemon's API as hooks and handlers receive it: every agent exists, with the status given. */
function fakeContext(statuses: Map<string, string>, sent: Sent[]): PluginHandlerContext {
  return {
    signal: new AbortController().signal,
    paseo: {
      agents: {
        list: async () => ({ entries: [], pageInfo: { hasMore: false, nextCursor: null } }),
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
          commands: async () => ({
            agentId,
            commands: [
              { name: "compact", description: "", argumentHint: "" },
              { name: "clear", description: "", argumentHint: "" },
            ],
            error: null,
            requestId: "r",
          }),
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
  const recorded: Recorded = {
    hooks: new Map(),
    handlers: new Map(),
    reads: 0,
    listeners: new Set(),
    schedules: [],
  };
  const logs: string[] = [];
  const sent: Sent[] = [];
  const statuses = new Map<string, string>();
  const stopped: number[] = [];
  const clock = createFakeClock(Date.parse("2026-11-11T09:00:00.000Z"));
  const context = fakeContext(statuses, sent);
  const stop = createOfficePlugin(fakeServer(recorded, read), {
    store: memoryStore(),
    clock,
    log: (message) => logs.push(message),
    world: null,
    machine: {
      procRoot: "/nonexistent-proc",
      cgroupRoot: "/nonexistent-cgroup",
      platform: "linux",
      selfPid: 1,
      stop: (pid) => void stopped.push(pid),
      sleep: async () => undefined,
    },
    skillFolders: [{ label: ".claude", path: "/nonexistent-skills" }],
    hostTimeZone: "Asia/Riyadh",
  });
  async function open(
    overrides: Partial<PluginSessionOpenRequest> = {},
  ): Promise<PluginSessionOpenRequest | undefined> {
    return recorded.hooks.get("agent.open.before")?.({ request: openRequest(overrides) }, context);
  }
  return { recorded, logs, sent, statuses, stopped, clock, context, stop, open };
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
  // The first read is the office's own at load, for the notes schedule.
  const states = [ON, ON, OFF, ON];
  const { open, stop, recorded } = setup(async () => states[recorded.reads - 1] ?? ON);
  const results = [await open(), await open(), await open()];
  expect(results.map((result) => result?.tools.length)).toEqual([4, undefined, 4]);
  await stop();
});

test("a session opened to read history gets no tools, and the setting is not read for it", async () => {
  const { open, stop, recorded } = setup(async () => ON);
  const atLoad = recorded.reads;
  expect(await open({ purpose: "history" })).toBeUndefined();
  expect(recorded.reads).toBe(atLoad);
  await stop();
});

test("a setting that cannot be read leaves the session as it is and is logged", async () => {
  const { open, stop, logs } = setup(async () => {
    throw new Error("settings store is down");
  });
  expect(await open()).toBeUndefined();
  await settle();
  // The read at load, for the notes schedule, fails too.
  expect([...logs].sort()).toEqual([
    "[office] agent.open.before failed: settings store is down",
    "[office] notes schedule failed: settings store is down",
  ]);
  await stop();
});

test("the notes schedule follows the host settings from load and on each save, until the office stops", async () => {
  const notes = (notesFolder: string, notesTimeZone: string): SettingsState => ({
    status: "ready",
    revision: notesFolder + notesTimeZone,
    values: { agentTools: true, notesFolder, notesTimeZone },
  });
  const { recorded, stop } = setup(async () => notes("/notes", ""));
  await settle();
  expect(recorded.schedules).toEqual(["upsert standup-notes 0 8 * * 0-4 Asia/Riyadh"]);

  const follow = (state: SettingsState) =>
    Promise.all([...recorded.listeners].map((listener) => listener(state)));
  await follow(notes("/notes", "Europe/Berlin"));
  // A document that is not valid leaves the schedule as it is.
  await follow({ status: "invalid", revision: "x", error: "Expected string" });
  await follow(notes("", "Europe/Berlin"));
  await settle();
  expect(recorded.schedules).toEqual([
    "upsert standup-notes 0 8 * * 0-4 Asia/Riyadh",
    "upsert standup-notes 0 8 * * 0-4 Europe/Berlin",
    "remove standup-notes",
  ]);

  await stop();
  expect(recorded.listeners.size).toBe(0);
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

test("the machine is read for a subscriber and no longer once it left", async () => {
  const { recorded, clock, context, stop } = setup(async () => ON);
  const events: unknown[] = [];
  const leaving = new AbortController();
  const machine = recorded.handlers.get("office.machine");
  const done = machine?.({}, {
    ...context,
    signal: leaving.signal,
    push: async (event: unknown) => void events.push(event),
  } as never);
  // The reading asks the file system, which takes longer than a round of promises.
  for (let round = 0; round < 200 && events.length === 0; round += 1) await settle();

  // No /proc at the test's root: a reading with nothing in it, not a failure.
  expect(events).toEqual([
    {
      type: "reading",
      machine: {
        readAt: "2026-11-11T09:00:00.000Z",
        memory: null,
        cpuPercent: null,
        agents: [],
      },
    },
  ]);
  // The hourly prune and the next reading.
  expect(clock.pending()).toBe(2);
  leaving.abort();
  await done;
  expect(clock.pending()).toBe(1);
  await stop();
});

test("a cleanup answers for each agent once, and leaves one that could not resume", async () => {
  const { recorded, statuses, stopped, context, stop } = setup(async () => ON);
  statuses.set("busy", "running");
  const cleanup = recorded.handlers.get("office.machine.cleanup.request");

  expect(await cleanup?.({ agentIds: ["busy", "idle", "busy"] }, context)).toEqual({
    results: [
      {
        agentId: "busy",
        ok: false,
        error: "The agent is not idle; clean up once its turn has ended",
      },
      {
        agentId: "idle",
        ok: false,
        error: "This agent has no saved session to resume, so it stays open",
      },
    ],
  });
  expect(stopped).toEqual([]);
  await stop();
});

test("the janitor sends the provider's command to an idle agent and refuses one at work", async () => {
  const { recorded, sent, statuses, context, stop } = setup(async () => ON);
  statuses.set("busy", "running");
  const janitor = recorded.handlers.get("office.janitor.request");

  expect(await janitor?.({ agentId: "idle", action: "clean" }, context)).toEqual({
    ok: true,
    error: null,
  });
  expect(await janitor?.({ agentId: "idle", action: "reset" }, context)).toEqual({
    ok: true,
    error: null,
  });
  expect(await janitor?.({ agentId: "busy", action: "reset" }, context)).toEqual({
    ok: false,
    error: "The agent is at work; reset it once its turn has ended",
  });
  expect(sent).toEqual([
    { agentId: "idle", text: "/compact", options: undefined },
    { agentId: "idle", text: "/clear", options: undefined },
  ]);
  await stop();
});

test("a script's log is refused while no office is open, when the host has no directory", async () => {
  const { recorded, context, stop } = setup(async () => ON);
  const log = recorded.handlers.get("office.script.log.request");
  expect(await log?.({ workspaceId: "w1", script: "dev" }, context)).toEqual({
    ok: false,
    error: "This host does not know the script",
  });
  await stop();
});

test("the skills are read from the host's folders, and no workspace's while no office is open", async () => {
  const { recorded, context, stop } = setup(async () => ON);
  const skills = recorded.handlers.get("office.skills.request");
  expect(await skills?.({}, context)).toEqual({
    host: [],
    workspaces: {},
    readAt: "2026-11-11T09:00:00.000Z",
  });
  await stop();
});

test("the entry serves the office state, the 3D page script, the machine, the janitor, a script's log, the skills and the four board calls, and stopping removes its hooks and timers", async () => {
  const { recorded, clock, stop } = setup(async () => ON);
  await settle();
  expect([...recorded.handlers.keys()]).toEqual([
    "office.state",
    "office.world.request",
    "office.machine",
    "office.machine.cleanup.request",
    "office.janitor.request",
    "office.script.log.request",
    "office.skills.request",
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
