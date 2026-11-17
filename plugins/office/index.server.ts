import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import type {
  PluginServerContext,
  PluginSettingsState,
  PluginTurnOutcome,
} from "@getpaseo/plugin/server";
import { createWorldScript, worldEntryPath, type WorldScript } from "./server/world-script.js";
import { createBoardStore, type BoardStore } from "./server/board-store.js";
import { errorMessage } from "./server/errors.js";
import { createHub } from "./server/hub.js";
import { tidyAgent } from "./server/janitor.js";
import {
  liveAgentPorts,
  liveHubPorts,
  liveJanitorPorts,
  liveNotesPorts,
  liveScriptLogPorts,
  liveSkillsPorts,
} from "./server/live-ports.js";
import { cleanUpAgent } from "./server/machine/cleanup.js";
import { liveCleanupPorts, liveMachinePorts } from "./server/machine/live-ports.js";
import { createMachineReader } from "./server/machine/machine.js";
import { createMachineWatch } from "./server/machine/watch.js";
import { nodeNotesFs, readMonthNotes } from "./server/notes-files.js";
import {
  createNotesSchedule,
  NOTES_SCHEDULE,
  type NotesSettings,
} from "./server/notes-schedule.js";
import { createNotesStore, createNotesWriter, type NotesStore } from "./server/notes-writer.js";
import { createOffice } from "./server/office.js";
import { createPaseoHolder } from "./server/paseo-holder.js";
import { boardsFile, hostSkillFolders, notesWriterFile, type SkillFolder } from "./server/paths.js";
import { readScriptLog } from "./server/script-log.js";
import { readSkills } from "./server/skills.js";
import { nodeClock, type Clock } from "./server/timers.js";
import {
  cleanupRpc,
  deleteRpc,
  janitorRpc,
  machineSubscription,
  notesReadRpc,
  notesWriteRpc,
  officeStateSubscription,
  postRpc,
  scriptLogRpc,
  setWakesPausedRpc,
  skillsRpc,
  updateRpc,
  worldRpc,
} from "./shared/contracts.js";
import { officeHostSettings } from "./shared/settings.js";

/** What the daemon passes a built-in beside the server context (as in plugins/default-skills). */
interface BuiltinPluginInfo {
  directory: string;
  /** Builds one self-contained browser script from an entry file. */
  bundleBrowserScript?: (entryPath: string) => Promise<string>;
}

/** What the office needs from outside the daemon's plugin API. */
export interface OfficePluginDeps {
  store: BoardStore;
  /** Where the stand-up notes writer keeps its state. */
  notesStore: NotesStore;
  clock: Clock;
  log(message: string): void;
  /** The 3D office's page script; null when the daemon cannot build one. */
  world: WorldScript | null;
  /** Where the host's processes are read, and how one is asked to end. */
  machine: MachineHost;
  /** The host's skills folders the library lists. */
  skillFolders: readonly SkillFolder[];
  /** The IANA zone of the stand-up notes' 8:00 run when the settings name none. */
  hostTimeZone: string;
}

export interface MachineHost {
  procRoot: string;
  cgroupRoot: string;
  /** `process.platform`. */
  platform: string;
  /** The daemon's pid: it and its ancestors are never asked to end. */
  selfPid: number;
  /** Sends SIGTERM. */
  stop(pid: number): void;
  sleep(ms: number): Promise<void>;
}

/** Why a turn did not complete, for the notes writer; null for one that did. */
function turnProblem(outcome: PluginTurnOutcome): string | null {
  switch (outcome.kind) {
    case "completed":
      return null;
    case "failed":
      return outcome.error.message;
    case "canceled":
      return outcome.reason;
  }
}

// Runs inside the daemon process: every handler, hook and timer catches its own errors.
export function createOfficePlugin(
  server: PluginServerContext,
  deps: OfficePluginDeps,
): () => Promise<void> {
  const { log } = deps;
  const holder = createPaseoHolder();
  const hub = createHub(liveHubPorts(holder, deps.clock, log));
  const office = createOffice({
    store: deps.store,
    clock: deps.clock,
    hub,
    agents: liveAgentPorts(holder),
    log,
  });

  const machine = createMachineWatch({
    read: createMachineReader({
      procRoot: deps.machine.procRoot,
      cgroupRoot: deps.machine.cgroupRoot,
      platform: deps.machine.platform,
      ...liveMachinePorts(holder, () => deps.clock.now()),
    }).read,
    timers: deps.clock,
    log,
  });
  const cleanupPorts = {
    procRoot: deps.machine.procRoot,
    selfPid: deps.machine.selfPid,
    stop: deps.machine.stop,
    sleep: deps.machine.sleep,
    ...liveCleanupPorts(holder),
  };

  const janitorPorts = liveJanitorPorts(holder);
  const logPorts = liveScriptLogPorts(holder, hub, () => deps.clock.now());
  const skillsPorts = liveSkillsPorts(holder, hub, deps.skillFolders, () => deps.clock.now(), log);

  const settings = server.registerSettings(officeHostSettings);
  // The daemon keeps the 8:00 schedule across restarts. It follows the settings from each load,
  // which also picks up a change of the host's zone, and from each save.
  const notesSchedule = createNotesSchedule({
    schedules: server.schedules,
    hostTimeZone: deps.hostTimeZone,
    log,
  });
  async function readNotesSettings(): Promise<NotesSettings> {
    const state = await settings.read();
    if (state.status !== "ready") {
      throw new Error(`The office's settings cannot be read: ${state.error}`);
    }
    return state.values;
  }
  // One writer of the day's stand-up entry at a time, started at 8:00 and by the bell.
  const writer = createNotesWriter({
    ...liveNotesPorts(holder, hub),
    settings: readNotesSettings,
    hostTimeZone: deps.hostTimeZone,
    now: () => deps.clock.now(),
    load: () => deps.notesStore.load(),
    save: (state) => deps.notesStore.save(state),
    changed: (state) => hub.setNotes({ ...state, scheduleError: notesSchedule.error() }),
    log,
  });
  async function followSettings(
    state: PluginSettingsState<typeof officeHostSettings.schema>,
  ): Promise<void> {
    if (state.status !== "ready") return;
    await notesSchedule.sync(state.values);
    // The writer reads the folder again, and its push carries the schedule's error with it.
    await writer
      .settingsChanged()
      .catch((error: unknown) => log(`[office] notes state failed: ${errorMessage(error)}`));
  }
  const stopFollowingSettings = settings.subscribe(followSettings);
  settings
    .read()
    .then(followSettings)
    .catch((error: unknown) => log(`[office] notes schedule failed: ${errorMessage(error)}`));

  async function guarded<T>(name: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      log(`[office] ${name} failed: ${errorMessage(error)}`);
      throw error;
    }
  }

  // The handler's promise settles when the subscriber leaves (or the directory cannot start),
  // and settling closes the subscription; see Hub.attach.
  server.handle(officeStateSubscription, (_input, context) => {
    holder.remember(context.paseo);
    return hub.attach(context);
  });
  server.handle(worldRpc, () =>
    guarded("world", () => {
      if (deps.world === null) throw new Error("This host cannot build the 3D office");
      return deps.world.read();
    }),
  );
  // The readings stop with the last subscriber: nothing walks /proc while no office is open.
  server.handle(machineSubscription, (_input, context) => {
    holder.remember(context.paseo);
    return machine.attach(context);
  });
  server.handle(cleanupRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("cleanup", async () => {
      // One at a time: each close waits for its runtime's processes.
      const results = [];
      for (const agentId of new Set(input.agentIds)) {
        results.push(await cleanUpAgent(cleanupPorts, agentId));
      }
      machine.refresh();
      return { results };
    });
  });
  server.handle(janitorRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("janitor", async () => {
      const result = await tidyAgent(janitorPorts, input.agentId, input.action);
      if (result.ok && input.action === "reset") hub.contextReset(input.agentId);
      return result;
    });
  });
  server.handle(scriptLogRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("script log", () => readScriptLog(logPorts, input.workspaceId, input.script));
  });
  server.handle(skillsRpc, (_input, context) => {
    holder.remember(context.paseo);
    return guarded("skills", () => readSkills(skillsPorts));
  });
  server.handle(notesReadRpc, (input) =>
    guarded("notes read", () =>
      readMonthNotes(
        { settings, hostTimeZone: deps.hostTimeZone, now: () => deps.clock.now(), fs: nodeNotesFs },
        input.month,
      ),
    ),
  );
  server.handle(postRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("post", () => office.post(input));
  });
  server.handle(updateRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("update", () => office.update(input));
  });
  server.handle(deleteRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("delete", () => office.remove(input.id));
  });
  server.handle(setWakesPausedRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("pause", () => office.setWakesPaused(input.paused));
  });
  // The bell. A start never rejects: why none started is in the snapshot's notes.
  server.handle(notesWriteRpc, (_input, context) => {
    holder.remember(context.paseo);
    return writer.start();
  });
  // The 8:00 run ends once the writer started; the writer's own end is its turn's hook.
  const stopNotesRuns = server.handleSchedule(NOTES_SCHEDULE, async ({ paseo }) => {
    holder.remember(paseo);
    await writer.start();
  });

  const removeHooks = [
    server.addHook("agent.open.before", async ({ request }, context) => {
      try {
        holder.remember(context.paseo);
        office.noteAgent({
          id: request.agentId,
          workspaceId: request.workspaceId,
          title: request.title,
        });
        if (request.purpose !== "interactive") return undefined;
        // Read here and not kept: a session opened while a first read was still on its way would
        // get the tools after the owner turned them off. A read that fails gives no tools.
        const state = await settings.read();
        if (state.status === "ready" && !state.values.agentTools) return undefined;
        return { ...request, tools: [...request.tools, ...office.tools] };
      } catch (error) {
        log(`[office] agent.open.before failed: ${errorMessage(error)}`);
        return undefined;
      }
    }),
    server.addHook("agent.turn.after", async ({ agent, outcome }, context) => {
      try {
        holder.remember(context.paseo);
        office.noteAgent(agent);
        office.turnEnded(agent.id);
      } catch (error) {
        log(`[office] agent.turn.after failed: ${errorMessage(error)}`);
      }
      // A stopped turn counts as failed: the entry is not written, and the writer is left.
      try {
        await writer.turnEnded(agent.id, outcome.kind !== "completed", turnProblem(outcome));
      } catch (error) {
        log(`[office] notes writer turn end failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.close.after", async ({ agent }) => {
      try {
        office.agentGone(agent.id);
        await writer.agentClosed(agent.id);
      } catch (error) {
        log(`[office] agent.close.after failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.archive.after", async ({ agent }) => {
      try {
        office.agentGone(agent.id);
        await writer.agentArchived(agent.id);
      } catch (error) {
        log(`[office] agent.archive.after failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("workspace.archive.after", async ({ workspace }) => {
      try {
        await office.workspaceArchived(workspace.id);
      } catch (error) {
        log(`[office] workspace.archive.after failed: ${errorMessage(error)}`);
      }
    }),
  ];

  return async () => {
    stopFollowingSettings();
    stopNotesRuns();
    for (const remove of removeHooks) remove();
    machine.stop();
    office.stop();
    await hub.stop();
  };
}

export default function contribute(
  server: PluginServerContext,
  builtin?: BuiltinPluginInfo,
): () => Promise<void> {
  const log = (message: string) => console.error(message);
  return createOfficePlugin(server, {
    // Built-ins run in the daemon process, so process.env is the daemon's env.
    store: createBoardStore({
      file: boardsFile(process.env, homedir()),
      now: () => Date.now(),
      log,
    }),
    notesStore: createNotesStore({ file: notesWriterFile(process.env, homedir()), log }),
    clock: nodeClock,
    log,
    world: builtin?.bundleBrowserScript
      ? createWorldScript({
          bundle: builtin.bundleBrowserScript,
          entryPath: worldEntryPath(builtin.directory),
        })
      : null,
    // Built-ins run in the daemon process: process.pid is the daemon's.
    machine: {
      procRoot: "/proc",
      cgroupRoot: "/sys/fs/cgroup",
      platform: process.platform,
      selfPid: process.pid,
      stop: (pid) => void process.kill(pid, "SIGTERM"),
      sleep: (ms) => delay(ms, undefined, { ref: false }),
    },
    skillFolders: hostSkillFolders(process.env, homedir()),
    hostTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}
