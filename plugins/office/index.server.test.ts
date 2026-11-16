import type {
  PluginHandlerContext,
  PluginHookAgent,
  PluginServerContext,
  PluginSessionOpenRequest,
  PluginSettingsState,
} from "@getpaseo/plugin/server";
import { tmpdir } from "node:os";
import { expect, test } from "vitest";
import { createOfficePlugin } from "./index.server.js";
import { EMPTY_BOARDS, type BoardStore } from "./server/board-store.js";
import { createFakeClock, settle } from "./server/fake-clock.js";
import type { NotesStore, StoredNotes } from "./server/notes-writer.js";
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
  /** When set, a schedule's save rejects with it. */
  scheduleFailure: Error | null;
  /** The handlers that answer due schedules, by handler name. */
  scheduleRuns: Map<string, Handler>;
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
        if (recorded.scheduleFailure) throw recorded.scheduleFailure;
        return { id: "s1", nextRunAt: null };
      },
      remove: async (name: string) => {
        recorded.schedules.push(`remove ${name}`);
        return false;
      },
      list: async () => [],
    },
    handleSchedule: (handler: string, run: Handler) => {
      recorded.scheduleRuns.set(handler, run);
      return () => {
        recorded.scheduleRuns.delete(handler);
      };
    },
  };
}

/** A subscribed list as the client gives it: the snapshot at once, then nothing. */
function emptyList() {
  return {
    entries: [],
    pageInfo: { hasMore: false, nextCursor: null },
    subscription: {
      subscribe: (observer: { snapshot(snapshot: { entries: never[] }): void }) => {
        observer.snapshot({ entries: [] });
        return () => undefined;
      },
      release: async () => undefined,
    },
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
        list: async () => emptyList(),
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
        list: async () => emptyList(),
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
    scheduleFailure: null,
    scheduleRuns: new Map(),
  };
  const logs: string[] = [];
  const sent: Sent[] = [];
  const statuses = new Map<string, string>();
  const stopped: number[] = [];
  const writers: Writers = { created: [], prompts: [], archived: [] };
  const notesStore = memoryNotesStore();
  const clock = createFakeClock(Date.parse("2026-11-11T09:00:00.000Z"));
  const context = fakeContext(statuses, sent, writers);
  const stop = createOfficePlugin(fakeServer(recorded, read), {
    store: memoryStore(),
    notesStore,
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
  return {
    recorded,
    logs,
    sent,
    statuses,
    stopped,
    writers,
    notesStore,
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
    "office.notes.write.request",
  ]);
  expect([...recorded.scheduleRuns.keys()]).toEqual(["standup-notes"]);
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
  expect(recorded.scheduleRuns.size).toBe(0);
  expect(clock.pending()).toBe(0);
});

/** Host settings with the notes folder set to a directory that exists. */
const NOTES: SettingsState = {
  status: "ready",
  revision: "notes",
  values: { agentTools: true, notesFolder: tmpdir(), notesTimeZone: "" },
};

test("the bell's request starts one writer in the notes folder, and its good end archives it", async () => {
  const { recorded, writers, notesStore, context, clock, stop } = setup(async () => NOTES);
  const write = recorded.handlers.get("office.notes.write.request");
  expect(await write?.({}, context)).toEqual({ started: true });
  expect(await write?.({}, context)).toEqual({ started: false });
  expect(writers.created).toEqual([`${tmpdir()} claude/opus Stand-up notes`]);
  expect(writers.prompts[0]).toContain("daily-standup-202611.md");
  expect(notesStore.kept?.writerId).toBe("writer-1");

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
  const { recorded, writers, context, stop } = setup(async () => NOTES);
  await settle();
  const run = recorded.scheduleRuns.get("standup-notes");
  // A schedule handler receives the run's context alone.
  await run?.({ paseo: context.paseo, scheduleId: "s1", runId: "r1" }, undefined as never);
  expect(writers.created).toHaveLength(1);
  await stop();
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

test("a writer closed by a graceful restart stays the office's: resumed it blocks the bell, and its end is recorded", async () => {
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
