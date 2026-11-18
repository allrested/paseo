import type {
  PluginHandlerContext,
  PluginHookAgent,
  PluginServerContext,
  PluginSessionOpenRequest,
  PluginSettingsState,
} from "@getpaseo/plugin/server";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, expect, test } from "vitest";
import { createOfficePlugin } from "./index.server.js";
import { EMPTY_BOARDS, type BoardStore } from "./server/board-store.js";
import { emptyChat, type ChatData, type ChatStore } from "./server/chat-store.js";
import { createFakeClock, settle } from "./server/fake-clock.js";
import type { LocalSchedules, OfficeCadence } from "./server/local-schedules.js";
import {
  EMPTY_INCIDENTS,
  type IncidentsData,
  type IncidentsStore,
} from "./server/incidents-store.js";
import type { NotesStore, StoredNotes } from "./server/notes-writer.js";
import { chatT } from "./shared/chat-words.js";
import { chatRpc, type ChatChange, type ChatMessage } from "./shared/contracts.js";
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
  /**
   * The office's calls on its schedules, as "upsert <name> <expression> <zone>",
   * "upsert <name> every <ms>" or "remove <name>".
   */
  schedules: string[];
  /** When set, a schedule's save rejects with it. */
  scheduleFailure: Error | null;
  /** The handlers that answer due schedules, by handler name. */
  scheduleRuns: Map<string, () => Promise<void>>;
}

interface Sent {
  agentId: string;
  text: string;
  options: unknown;
}

const NO_NOTES = { notesFolder: "", notesTimeZone: "" };
const NO_TRACKERS = {
  jiraProjects: "",
  sentryOrg: "",
  sentryProjects: "",
  sentryUrl: "https://sentry.io",
};
const ON: SettingsState = {
  status: "ready",
  revision: "1",
  values: { agentTools: true, ...NO_NOTES, ...NO_TRACKERS },
};
const OFF: SettingsState = {
  status: "ready",
  revision: "2",
  values: { agentTools: false, ...NO_NOTES, ...NO_TRACKERS },
};
const OWN_TOOL = { name: "other_tool", description: "Another plugin's tool", inputSchema: {} };

function cadenceText(cadence: OfficeCadence): string {
  if (cadence.type === "every") return `every ${cadence.everyMs}`;
  return `${cadence.expression} ${cadence.timezone}`;
}

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
  };
}

/** The office's own schedule engine, recording its calls and keeping the handlers it is given. */
function recordingSchedules(recorded: Recorded): LocalSchedules {
  return {
    upsert: async ({ name, cadence }) => {
      recorded.schedules.push(`upsert ${name} ${cadenceText(cadence)}`);
      if (recorded.scheduleFailure) throw recorded.scheduleFailure;
      return { id: "s1", nextRunAt: null };
    },
    remove: async (name) => {
      recorded.schedules.push(`remove ${name}`);
      return false;
    },
    list: async () => [],
    handle: (handler, run) => {
      recorded.scheduleRuns.set(handler, run);
      return () => {
        recorded.scheduleRuns.delete(handler);
      };
    },
    stop: () => undefined,
  };
}

/** A subscribed list as the client gives it: the snapshot at once, then nothing. */
function listOf(entries: object[]) {
  return {
    entries,
    pageInfo: { hasMore: false, nextCursor: null },
    subscription: {
      subscribe: (observer: { snapshot(snapshot: { entries: object[] }): void }) => {
        observer.snapshot({ entries });
        return () => undefined;
      },
      release: async () => undefined,
    },
  };
}

/** What the fake daemon lists and reads: the directory's agents, and each agent's timeline. */
interface FakeDirectory {
  agents: object[];
  timelines: Map<string, { turnId: string; item: object }[]>;
}

/** An idle agent as the daemon's agent list gives it. */
function listedAgent(id: string, title: string): object {
  return {
    id,
    title,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    createdAt: "2026-11-11T08:00:00.000Z",
    pendingPermissions: [],
  };
}

interface Writers {
  /** The agents created, as "<folder> <provider> <title>". */
  created: string[];
  prompts: string[];
  archived: string[];
}

/** The daemon's API as hooks and handlers receive it: every agent exists, with the status given. */
function fakeContext(
  statuses: Map<string, string>,
  sent: Sent[],
  writers: Writers,
  directory: FakeDirectory,
): PluginHandlerContext {
  return {
    signal: new AbortController().signal,
    paseo: {
      providers: {
        waitForReady: async () => ({
          entries: [
            {
              provider: "claude",
              status: "ready",
              enabled: true,
              defaultModeId: "auto",
              models: [{ id: "opus", isDefault: true }],
            },
          ],
        }),
      },
      workspaces: {
        list: async () => listOf([]),
        open: async (cwd: string) => ({
          id: "wks_notes",
          directory: cwd,
          agents: {
            create: async (options: {
              config: { provider: string };
              title: string;
              prompt: string;
            }) => {
              writers.created.push(`${cwd} ${options.config.provider} ${options.title}`);
              writers.prompts.push(options.prompt);
              const id = `writer-${writers.created.length}`;
              statuses.set(id, "running");
              return { id };
            },
          },
        }),
      },
      agents: {
        list: async () => listOf(directory.agents.map((agent) => ({ agent }))),
        ref: (agentId: string) => ({
          timeline: {
            refetch: async () => ({ entries: directory.timelines.get(agentId) ?? [] }),
          },
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
          archive: async () => {
            writers.archived.push(agentId);
            return { archivedAt: "2026-11-11T09:05:00.000Z" };
          },
        }),
      },
    },
  };
}

function memoryNotesStore(): NotesStore & { kept: StoredNotes | null } {
  const store = {
    kept: null as StoredNotes | null,
    load: async () => store.kept,
    save: async (state: StoredNotes) => {
      store.kept = state;
    },
  };
  return store;
}

function memoryIncidentsStore(): IncidentsStore & { kept: IncidentsData } {
  // Copied on each load and save, as the file is.
  const store = {
    kept: structuredClone(EMPTY_INCIDENTS),
    load: async () => structuredClone(store.kept),
    save: async (data: IncidentsData) => {
      store.kept = structuredClone(data);
    },
  };
  return store;
}

function memoryChatStore(): ChatStore & { kept: ChatData } {
  // Copied on each load and save, as the file is.
  const store = {
    kept: emptyChat(),
    load: async () => structuredClone(store.kept),
    save: async (data: ChatData) => {
      store.kept = structuredClone(data);
    },
  };
  return store;
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

/**
 * `env` is the daemon's environment the trackers' variables are read from; empty by default.
 * `chatStore` replaces the chat's memory store.
 */
function setup(
  read: () => Promise<SettingsState>,
  options: {
    env?: NodeJS.ProcessEnv;
    chatStore?: ChatStore;
    /** Gives the fake server extras, as the fork daemon's has. */
    server?: (base: PluginServerContext) => PluginServerContext;
  } = {},
) {
  const recorded: Recorded = {
    hooks: new Map(),
    handlers: new Map(),
    reads: 0,
    listeners: new Set(),
    schedules: [],
    scheduleFailure: null,
    scheduleRuns: new Map(),
  };
  const logs: string[] = [];
  const sent: Sent[] = [];
  const statuses = new Map<string, string>();
  const stopped: number[] = [];
  const writers: Writers = { created: [], prompts: [], archived: [] };
  const directory: FakeDirectory = { agents: [], timelines: new Map() };
  const notesStore = memoryNotesStore();
  const incidentsStore = memoryIncidentsStore();
  const chatStore = options.chatStore ?? memoryChatStore();
  const clock = createFakeClock(Date.parse("2026-11-11T09:00:00.000Z"));
  const context = fakeContext(statuses, sent, writers, directory);
  const baseServer = fakeServer(recorded, read);
  const stop = createOfficePlugin(options.server?.(baseServer) ?? baseServer, {
    store: memoryStore(),
    notesStore,
    incidentsStore,
    chatStore,
    env: options.env ?? {},
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
    schedules: recordingSchedules(recorded),
  });
  async function open(
    overrides: Partial<PluginSessionOpenRequest> = {},
  ): Promise<PluginSessionOpenRequest | undefined> {
    return recorded.hooks.get("agent.open.before")?.({ request: openRequest(overrides) }, context);
  }
  return {
    recorded,
    logs,
    sent,
    statuses,
    stopped,
    writers,
    directory,
    notesStore,
    incidentsStore,
    clock,
    context,
    stop,
    open,
  };
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
  // The office reads the settings at load too, for the notes schedule and the writer.
  const states = [ON, OFF, ON];
  let atLoad: number | null = null;
  const { open, stop, recorded } = setup(async () =>
    atLoad === null ? ON : (states[recorded.reads - atLoad - 1] ?? ON),
  );
  await settle();
  atLoad = recorded.reads;
  const results = [await open(), await open(), await open()];
  expect(results.map((result) => result?.tools.length)).toEqual([4, undefined, 4]);
  await stop();
});

test("a session opened to read history gets no tools, and the setting is not read for it", async () => {
  const { open, stop, recorded } = setup(async () => ON);
  await settle();
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
  // The reads at load, for the notes schedule and the writer, fail too.
  expect([...logs].sort()).toEqual([
    "[office] agent.open.before failed: settings store is down",
    "[office] notes schedule failed: settings store is down",
    "[office] notes writer load failed: settings store is down",
  ]);
  await stop();
});

test("the notes schedule follows the host settings from load and on each save, until the office stops", async () => {
  const notes = (notesFolder: string, notesTimeZone: string): SettingsState => ({
    status: "ready",
    revision: notesFolder + notesTimeZone,
    values: { agentTools: true, notesFolder, notesTimeZone, ...NO_TRACKERS },
  });
  const { recorded, stop } = setup(async () => notes("/notes", ""));
  const notesCalls = () => recorded.schedules.filter((call) => call.includes(" standup-notes"));
  await settle();
  expect(notesCalls()).toEqual(["upsert standup-notes 0 8 * * 0-4 Asia/Riyadh"]);

  const follow = (state: SettingsState) =>
    Promise.all([...recorded.listeners].map((listener) => listener(state)));
  await follow(notes("/notes", "Europe/Berlin"));
  // A document that is not valid leaves the schedule as it is.
  await follow({ status: "invalid", revision: "x", error: "Expected string" });
  await follow(notes("", "Europe/Berlin"));
  await settle();
  expect(notesCalls()).toEqual([
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
  await recorded.hooks.get("agent.turn.after")?.(
    { agent: hookAgent("b"), turnId: "t1", outcome: { kind: "completed" } },
    context,
  );
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
  // The hourly prune, the chat's clock and the next reading.
  expect(clock.pending()).toBe(3);
  leaving.abort();
  await done;
  expect(clock.pending()).toBe(2);
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

test("the entry serves the office state, the 3D page script, the machine, the janitor, a script's log, the skills and the five board calls, and stopping removes its hooks and timers", async () => {
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
    "office.notes.read.request",
    "office.post.request",
    "office.update.request",
    "office.delete.request",
    "office.board.clear_done.request",
    "office.set_wakes_paused.request",
    "office.notes.write.request",
    "office.incidents.dismiss.request",
    "office.chat.request",
  ]);
  expect([...recorded.scheduleRuns.keys()]).toEqual(["standup-notes", "incidents"]);
  expect([...recorded.hooks.keys()]).toEqual([
    "agent.open.before",
    "agent.turn.after",
    "agent.close.after",
    "agent.archive.after",
    "workspace.archive.after",
  ]);
  // The hourly prune and the chat's 30 s clock are waiting.
  expect(clock.pending()).toBe(2);
  await stop();
  expect(recorded.hooks.size).toBe(0);
  expect(recorded.scheduleRuns.size).toBe(0);
  expect(clock.pending()).toBe(0);
});

/** Subscribes to office.state as a page does; `events` records what it is pushed. */
function openOffice(recorded: Recorded, context: PluginHandlerContext) {
  const events: { type: string; state?: { chat?: unknown }; change?: ChatChange }[] = [];
  const leaving = new AbortController();
  const done = recorded.handlers.get("office.state")?.({}, {
    ...context,
    signal: leaving.signal,
    push: async (event: { type: string }) => void events.push(event),
  } as never);
  return {
    events,
    async leave() {
      leaving.abort();
      await done;
    },
  };
}

test("a chat send posts your message to an open office and the snapshot carries the chat", async () => {
  const { recorded, context, stop } = setup(async () => ON);
  await settle();
  const first = openOffice(recorded, context);
  await settle();
  // The engine's own welcome line opens a new conversation.
  expect(first.events.at(-1)?.state?.chat).toMatchObject({
    messages: [{ kind: "sys" }],
    typing: [],
  });

  const chat = recorded.handlers.get("office.chat.request");
  expect(await chat?.({ op: "send", text: "hello" }, context)).toEqual({ ok: true });
  expect(first.events.filter((event) => event.type === "chat")).toMatchObject([
    { type: "chat", change: { op: "add", message: { from: "me", text: "hello" } } },
  ]);

  const second = openOffice(recorded, context);
  await settle();
  expect(second.events.at(-1)?.state?.chat).toMatchObject({
    messages: [{ kind: "sys" }, { from: "me", text: "hello" }],
  });
  await first.leave();
  await second.leave();
  await stop();
});

test("a chat call with a bad op is refused by the contract", () => {
  expect(chatRpc.input.safeParse({ op: "shout", text: "hello" }).success).toBe(false);
  expect(chatRpc.input.safeParse({ op: "send", text: "hello" }).success).toBe(true);
});

/** The messages the chat events of `events` added. */
function chatAdds(events: { type: string; change?: ChatChange }[]): ChatMessage[] {
  return events.flatMap(({ change }) => (change?.op === "add" ? [change.message] : []));
}

test("a turn that ends answers the chat message that named its agent, as a reply", async () => {
  const { recorded, context, directory, sent, logs, stop } = setup(async () => ON);
  directory.agents.push(listedAgent("a1", "Mjd"));
  await settle();
  const office = openOffice(recorded, context);
  await settle();

  const chat = recorded.handlers.get("office.chat.request");
  expect(await chat?.({ op: "send", text: "@Mjd hi" }, context)).toEqual({ ok: true });
  await settle();
  expect(sent).toEqual([
    {
      agentId: "a1",
      text: "Team chat message from you: @Mjd hi",
      options: { activeTurnBehavior: "steer" },
    },
  ]);
  const mine = chatAdds(office.events).find((message) => message.from === "me");

  directory.timelines.set("a1", [
    { turnId: "t1", item: { type: "user_message", text: "Team chat message from you: @Mjd hi" } },
    { turnId: "t1", item: { type: "assistant_message", text: "Hi, on it." } },
  ]);
  await recorded.hooks.get("agent.turn.after")?.(
    { agent: hookAgent("a1"), turnId: "t1", outcome: { kind: "completed" } },
    context,
  );
  await settle();
  expect(chatAdds(office.events)).toContainEqual(
    expect.objectContaining({
      from: "a1",
      name: "Mjd",
      text: "Hi, on it.",
      reply: { id: mine?.id, name: "Boss", text: "@Mjd hi" },
    }),
  );
  expect(logs).toEqual([]);
  await office.leave();
  await stop();
});

test("an archived agent of the office leaves the chat", async () => {
  const { recorded, context, directory, logs, stop } = setup(async () => ON);
  directory.agents.push(listedAgent("a1", "Mjd"));
  await settle();
  const office = openOffice(recorded, context);
  await settle();

  await recorded.hooks.get("agent.archive.after")?.(
    { agent: hookAgent("a1"), archivedAt: "2026-11-11T09:01:00.000Z" },
    context,
  );
  expect(chatAdds(office.events)).toEqual([
    expect.objectContaining({ kind: "sys", text: chatT("chat.sys.left", { name: "Mjd" }) }),
  ]);
  expect(logs).toEqual([]);
  await office.leave();
  await stop();
});

test("an agent closed while the chat waits for it stops typing", async () => {
  const { recorded, context, directory, logs, stop } = setup(async () => ON);
  directory.agents.push(listedAgent("a1", "Mjd"));
  await settle();
  const office = openOffice(recorded, context);
  await settle();

  const chat = recorded.handlers.get("office.chat.request");
  expect(await chat?.({ op: "send", text: "@Mjd hi" }, context)).toEqual({ ok: true });
  await settle();
  const typingNames = () =>
    office.events.flatMap(({ change }) => (change?.op === "typing" ? [change.names] : []));
  expect(typingNames().at(-1)).toEqual(["Mjd"]);

  await recorded.hooks.get("agent.close.after")?.({ agent: hookAgent("a1") }, context);
  expect(typingNames().at(-1)).toEqual([]);
  expect(logs).toEqual([]);
  await office.leave();
  await stop();
});

test("a chat that cannot start answers its call with an error and the rest of the office goes on", async () => {
  const broken: ChatStore = {
    load: async () => {
      throw new Error("chat.json is locked");
    },
    save: async () => undefined,
  };
  const { recorded, context, logs, stop } = setup(async () => ON, { chatStore: broken });
  await settle();
  const chat = recorded.handlers.get("office.chat.request");
  await expect(chat?.({ op: "send", text: "hello" }, context)).rejects.toThrow(
    "The team chat did not start",
  );
  const post = recorded.handlers.get("office.post.request");
  expect(await post?.({ board: "w1", kind: "note", text: "Still here" }, context)).toMatchObject({
    ok: true,
  });
  expect(logs).toContain("[office] chat unavailable: chat.json is locked");
  await stop();
});

test("the chat's clock beats every 30 s until the office stops", async () => {
  const { clock, stop } = setup(async () => ON);
  await settle();
  // The hourly prune and the chat's clock.
  expect(clock.pending()).toBe(2);
  clock.advance(30_000);
  expect(clock.pending()).toBe(2);
  clock.advance(30_000);
  expect(clock.pending()).toBe(2);
  await stop();
  expect(clock.pending()).toBe(0);
});

test("an office stopped before its chat has loaded stops the chat's clock too", async () => {
  let load: (data: ChatData) => void = () => undefined;
  const slow: ChatStore = {
    load: () =>
      new Promise<ChatData>((resolve) => {
        load = resolve;
      }),
    save: async () => undefined,
  };
  const { clock, stop } = setup(async () => ON, { chatStore: slow });
  await settle();
  const stopping = stop();
  load(emptyChat());
  await stopping;
  await settle();
  expect(clock.pending()).toBe(0);
});

const NOTES_FOLDER = await mkdtemp(join(tmpdir(), "office-notes-"));
afterAll(() => rm(NOTES_FOLDER, { recursive: true, force: true }));

/** Host settings with the notes folder set to a directory that exists. */
const NOTES: SettingsState = {
  status: "ready",
  revision: "notes",
  values: { agentTools: true, notesFolder: NOTES_FOLDER, notesTimeZone: "", ...NO_TRACKERS },
};

/** The writer leaves the day's entry in the notes: the fake clock's day in Asia/Riyadh. */
function writeEntry(): Promise<void> {
  const text = "# Notes\n\n---\n\n## 11 November 2026\n\nB\n";
  return writeFile(join(NOTES_FOLDER, "daily-standup-202611.md"), text, "utf8");
}

test("the bell's request starts one writer in the notes folder, and its good end with the entry archives it", async () => {
  const { recorded, writers, notesStore, context, clock, stop } = setup(async () => NOTES);
  const write = recorded.handlers.get("office.notes.write.request");
  expect(await write?.({}, context)).toEqual({ started: true });
  expect(await write?.({}, context)).toEqual({ started: false });
  expect(writers.created).toEqual([`${NOTES_FOLDER} claude/opus Stand-up notes`]);
  expect(writers.prompts[0]).toContain("daily-standup-202611.md");
  expect(notesStore.kept?.writerId).toBe("writer-1");

  await writeEntry();
  await recorded.hooks.get("agent.turn.after")?.(
    { agent: hookAgent("writer-1"), turnId: "t1", outcome: { kind: "completed" } },
    context,
  );
  expect(writers.archived).toEqual(["writer-1"]);
  expect(notesStore.kept).toEqual({
    writerId: null,
    writtenAt: clock.now(),
    failedAgentId: null,
    problem: null,
  });
  await stop();
});

test("the 8:00 run starts the writer with the run's Paseo API", async () => {
  const { recorded, writers, open, stop } = setup(async () => NOTES);
  await settle();
  // A run has no Paseo API of its own: a handler or hook brought it before.
  await open();
  await recorded.scheduleRuns.get("standup-notes")?.();
  expect(writers.created).toHaveLength(1);
  await stop();
});

test("a run due before any handler brought the Paseo API waits for it", async () => {
  const { recorded, writers, open, stop } = setup(async () => NOTES);
  await settle();
  const run = recorded.scheduleRuns.get("standup-notes")?.();
  await settle();
  expect(writers.created).toHaveLength(0);
  await open();
  await run;
  expect(writers.created).toHaveLength(1);
  await stop();
});

test("on the fork daemon the office removes its two stored schedules; on stock it touches none", async () => {
  const removed: string[] = [];
  const fork = setup(async () => ON, {
    server: (base) =>
      ({
        ...base,
        schedules: {
          remove: async (name: string) => {
            removed.push(name);
            return true;
          },
        },
      }) as unknown as PluginServerContext,
  });
  await settle();
  expect(removed).toEqual(["standup-notes", "incidents"]);
  await fork.stop();

  const stock = setup(async () => ON);
  await settle();
  expect(stock.logs).toEqual([]);
  await stock.stop();
});

test("a writer whose turn fails or is stopped is left, and its reason kept", async () => {
  const { recorded, writers, notesStore, statuses, context, stop } = setup(async () => NOTES);
  const write = recorded.handlers.get("office.notes.write.request");
  const turnEnded = recorded.hooks.get("agent.turn.after");
  await write?.({}, context);
  await turnEnded?.(
    {
      agent: hookAgent("writer-1"),
      turnId: "t1",
      outcome: { kind: "failed", error: { message: "Rate limited" } },
    },
    context,
  );
  expect(notesStore.kept).toMatchObject({ failedAgentId: "writer-1", problem: "Rate limited" });

  // A failed turn leaves the agent idle, so a new writer may start.
  statuses.set("writer-1", "idle");
  await write?.({}, context);
  await turnEnded?.(
    {
      agent: hookAgent("writer-2"),
      turnId: "t2",
      outcome: { kind: "canceled", reason: "interrupted" },
    },
    context,
  );
  expect(notesStore.kept).toMatchObject({ failedAgentId: "writer-2", problem: "interrupted" });
  expect(writers.archived).toEqual([]);
  await stop();
});

test("a writer closed by a graceful restart stays the office's: resumed it blocks the bell, and its end with the entry is recorded", async () => {
  const { recorded, writers, notesStore, statuses, context, clock, stop } = setup(
    async () => NOTES,
  );
  const write = recorded.handlers.get("office.notes.write.request");
  await write?.({}, context);
  // The daemon closes every agent as it shuts down.
  statuses.set("writer-1", "closed");
  await recorded.hooks.get("agent.close.after")?.({ agent: hookAgent("writer-1") }, context);
  expect(notesStore.kept).toMatchObject({
    writerId: null,
    failedAgentId: "writer-1",
    problem: "it was closed before it finished",
  });

  // Started again, the daemon resumes the writer's turn.
  statuses.set("writer-1", "running");
  expect(await write?.({}, context)).toEqual({ started: false });
  expect(writers.created).toHaveLength(1);
  await writeEntry();
  await recorded.hooks.get("agent.turn.after")?.(
    { agent: hookAgent("writer-1"), turnId: "t2", outcome: { kind: "completed" } },
    context,
  );
  expect(writers.archived).toEqual(["writer-1"]);
  expect(notesStore.kept).toEqual({
    writerId: null,
    writtenAt: clock.now(),
    failedAgentId: null,
    problem: null,
  });
  await stop();
});

test("a writer archived by someone else frees the bell", async () => {
  const { recorded, writers, context, stop } = setup(async () => NOTES);
  const write = recorded.handlers.get("office.notes.write.request");
  await write?.({}, context);
  await recorded.hooks.get("agent.archive.after")?.(
    { agent: hookAgent("writer-1"), archivedAt: "2026-11-11T09:01:00.000Z" },
    context,
  );
  expect(await write?.({}, context)).toEqual({ started: true });
  expect(writers.created).toHaveLength(2);
  await stop();
});

test("an open office gets the notes state in its snapshot, and a schedule that fails after a save", async () => {
  const { recorded, context, stop } = setup(async () => NOTES);
  await settle();
  const events: { type: string; state?: { notes?: unknown } }[] = [];
  const leaving = new AbortController();
  const done = recorded.handlers.get("office.state")?.({}, {
    ...context,
    signal: leaving.signal,
    push: async (event: { type: string }) => void events.push(event),
  } as never);
  await settle();
  expect(events.at(-1)?.state?.notes).toEqual({
    folderSet: true,
    writing: false,
    writtenAt: null,
    failedAgentId: null,
    problem: null,
    scheduleError: null,
  });

  recorded.scheduleFailure = new Error("Invalid cron time zone: Mars/Base");
  const zone = {
    ...NOTES,
    revision: "zone",
    values: { ...NOTES.values, notesTimeZone: "Mars/Base" },
  } as SettingsState;
  await Promise.all([...recorded.listeners].map((listener) => listener(zone)));
  await settle();
  expect(events.at(-1)?.state?.notes).toMatchObject({
    scheduleError: "Invalid cron time zone: Mars/Base",
  });

  leaving.abort();
  await done;
  await stop();
});

const servers: Server[] = [];

afterEach(async () => {
  const closing = servers.splice(0).map(
    (server) =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  await Promise.all(closing);
});

interface JiraStandIn {
  base: string;
  /** The JQL of each search. */
  searches: string[];
  /** While set, every request is refused with HTTP 401. */
  refusing: boolean;
}

/** A local server standing in for Jira, with one bug made at 08:58 UTC on the fake clock's day. */
async function jiraStandIn(): Promise<JiraStandIn> {
  const searches: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (standIn.refusing) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ errorMessages: ["Unauthorized"] }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    if (url.pathname === "/rest/api/3/myself") {
      res.end(JSON.stringify({ timeZone: "UTC" }));
      return;
    }
    searches.push(url.searchParams.get("jql") ?? "");
    const created = "2026-11-11T08:58:00.000+0000";
    const bug = { key: "OPS-7", fields: { summary: "Checkout fails on a split bill", created } };
    res.end(JSON.stringify({ issues: [bug] }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  const standIn = { base: `http://127.0.0.1:${address.port}`, searches, refusing: false };
  return standIn;
}

/** The three Jira variables, with placeholder values: no test holds a real token. */
function jiraVariables(base: string): NodeJS.ProcessEnv {
  return {
    ATLASSIAN_BASE_URL: base,
    ATLASSIAN_EMAIL: "office@example.test",
    ATLASSIAN_API_TOKEN: "placeholder-jira-token",
  };
}

/** Host settings that check Jira's OPS project for new bugs. */
const JIRA_ON: SettingsState = {
  status: "ready",
  revision: "jira",
  values: { agentTools: true, ...NO_NOTES, ...NO_TRACKERS, jiraProjects: "OPS" },
};

test("a due incidents run calls the check; dismiss answers its count", async () => {
  const jira = await jiraStandIn();
  const { recorded, incidentsStore, context, open, clock, stop } = setup(async () => JIRA_ON, {
    env: jiraVariables(jira.base),
  });
  await settle();
  // Checked 5 minutes ago, so the bug made since is news.
  incidentsStore.kept = {
    version: 1,
    trackers: { jira: { checkedAt: clock.now() - 300_000, seen: {} } },
    open: [],
  };
  // A run has no Paseo API of its own: a handler or hook brought it before.
  await open();
  await recorded.scheduleRuns.get("incidents")?.();
  expect(jira.searches).toEqual([
    'project in ("OPS") AND issuetype = Bug AND created >= "2026-11-11 08:45" ORDER BY created ASC',
  ]);
  expect(incidentsStore.kept.open).toEqual([
    {
      id: "jira:OPS-7",
      source: "jira",
      key: "OPS-7",
      title: "Checkout fails on a split bill",
      url: `${jira.base}/browse/OPS-7`,
      createdAt: Date.parse("2026-11-11T08:58:00.000Z"),
      foundAt: clock.now(),
    },
  ]);

  const dismiss = recorded.handlers.get("office.incidents.dismiss.request");
  expect(await dismiss?.({}, context)).toEqual({ dismissed: 1 });
  expect(await dismiss?.({ ids: ["jira:OPS-7"] }, context)).toEqual({ dismissed: 0 });
  expect(incidentsStore.kept.open).toEqual([]);
  await stop();
});

test("an open office gets the incidents state with which trackers' variables are set, and a schedule that fails after a save", async () => {
  const { recorded, context, stop } = setup(async () => JIRA_ON, {
    env: jiraVariables("https://jira.example.test"),
  });
  const incidentsCalls = () => recorded.schedules.filter((call) => call.includes(" incidents"));
  const follow = (state: SettingsState) =>
    Promise.all([...recorded.listeners].map((listener) => listener(state)));
  await settle();
  const events: { type: string; state?: { incidents?: unknown } }[] = [];
  const leaving = new AbortController();
  const done = recorded.handlers.get("office.state")?.({}, {
    ...context,
    signal: leaving.signal,
    push: async (event: { type: string }) => void events.push(event),
  } as never);
  await settle();
  expect(events.at(-1)?.state?.incidents).toEqual({
    open: [],
    problems: {},
    jiraReady: true,
    sentryReady: false,
    scheduleError: null,
  });
  expect(incidentsCalls()).toEqual(["upsert incidents every 300000"]);

  recorded.scheduleFailure = new Error("Plugin schedules are unavailable");
  await follow({ ...JIRA_ON, revision: "again" });
  await settle();
  expect(events.at(-1)?.state?.incidents).toMatchObject({
    scheduleError: "Plugin schedules are unavailable",
  });

  // No project left: the schedule goes, and the error with it.
  recorded.scheduleFailure = null;
  await follow(ON);
  await settle();
  expect(events.at(-1)?.state?.incidents).toMatchObject({ scheduleError: null });
  expect(incidentsCalls()).toEqual([
    "upsert incidents every 300000",
    "upsert incidents every 300000",
    "remove incidents",
  ]);

  leaving.abort();
  await done;
  await stop();
});

test("a tracker's problem goes once no tracker is on", async () => {
  const jira = await jiraStandIn();
  jira.refusing = true;
  // What the daemon reads back is what was saved last.
  let saved = JIRA_ON;
  const { recorded, context, open, stop } = setup(async () => saved, {
    env: jiraVariables(jira.base),
  });
  await settle();
  const events: { type: string; state?: { incidents?: unknown } }[] = [];
  const leaving = new AbortController();
  const done = recorded.handlers.get("office.state")?.({}, {
    ...context,
    signal: leaving.signal,
    push: async (event: { type: string }) => void events.push(event),
  } as never);
  await settle();
  await open();
  await recorded.scheduleRuns.get("incidents")?.();
  await settle();
  expect(events.at(-1)?.state?.incidents).toMatchObject({
    problems: { jira: "Jira refused the token: check ATLASSIAN_API_TOKEN" },
  });

  // The last project removed: no run comes again to clear the problem.
  saved = ON;
  await Promise.all([...recorded.listeners].map((listener) => listener(saved)));
  await settle();
  expect(events.at(-1)?.state?.incidents).toEqual({
    open: [],
    problems: {},
    jiraReady: true,
    sentryReady: false,
    scheduleError: null,
  });

  leaving.abort();
  await done;
  await stop();
});
