import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import type {
  PluginServerContext,
  PluginSettingsState,
  PluginTurnOutcome,
} from "@getpaseo/plugin/server";
import { embeddedWorldScript, type WorldScript } from "./server/world-script.js";
import { createBoardStore, type BoardStore } from "./server/board-store.js";
import { createChatService, type ChatService } from "./server/chat-service.js";
import { createChatStore, type ChatStore } from "./server/chat-store.js";
import { errorMessage } from "./server/errors.js";
import { createHub } from "./server/hub.js";
import { createIncidentsCheck, type IncidentsCheckState } from "./server/incidents-check.js";
import { jiraEnv } from "./server/incidents-jira.js";
import {
  createIncidentsSchedule,
  INCIDENTS_SCHEDULE,
  incidentsReaders,
} from "./server/incidents-schedule.js";
import { sentryToken } from "./server/incidents-sentry.js";
import { createIncidentsStore, type IncidentsStore } from "./server/incidents-store.js";
import { tidyAgent } from "./server/janitor.js";
import {
  liveAgentPorts,
  liveChatPorts,
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
  lateNotesRun,
  NOTES_SCHEDULE,
  notesTimeZone,
} from "./server/notes-schedule.js";
import { createNotesStore, createNotesWriter, type NotesStore } from "./server/notes-writer.js";
import { createLocalSchedules, type LocalSchedules } from "./server/local-schedules.js";
import { createOffice } from "./server/office.js";
import { createPaseoHolder } from "./server/paseo-holder.js";
import {
  boardsFile,
  chatFile,
  hostSkillFolders,
  incidentsFile,
  notesWriterFile,
  type SkillFolder,
} from "./server/paths.js";
import { readScriptLog } from "./server/script-log.js";
import { readSkills } from "./server/skills.js";
import { nodeClock, type Clock } from "./server/timers.js";
import {
  chatRpc,
  cleanupRpc,
  clearDoneRpc,
  deleteRpc,
  incidentsDismissRpc,
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
import { chatT } from "./shared/chat-words.js";
import { officeHostSettings } from "./shared/settings.js";

/** What the office needs from outside the daemon's plugin API. */
export interface OfficePluginDeps {
  store: BoardStore;
  /** Where the stand-up notes writer keeps its state. */
  notesStore: NotesStore;
  /** Where the incidents check keeps the open incidents and what each tracker has shown. */
  incidentsStore: IncidentsStore;
  /** Where the team chat keeps its conversation. */
  chatStore: ChatStore;
  /** The daemon's environment: the trackers' tokens are read from it. */
  env: NodeJS.ProcessEnv;
  clock: Clock;
  log(message: string): void;
  /** The 3D office's page script. */
  world: WorldScript;
  /** Where the host's processes are read, and how one is asked to end. */
  machine: MachineHost;
  /** The host's skills folders the library lists. */
  skillFolders: readonly SkillFolder[];
  /** The IANA zone of the stand-up notes' 8:00 run when the settings name none. */
  hostTimeZone: string;
  /** The office's own schedule engine; a test hands in a recording one. */
  schedules: LocalSchedules;
}

export interface MachineHost {
  procRoot: string;
  cgroupRoot: string;
  /** `process.platform`. */
  platform: string;
  /** The office's own process: it and its ancestors are never asked to end. */
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
  // COMPAT(officeForkSchedules): removes the fork daemon's stored schedules; delete once the host runs stock Paseo.
  if ("schedules" in server) {
    const forkSchedules = (server as { schedules: { remove(name: string): Promise<boolean> } })
      .schedules;
    void (async () => {
      for (const name of [NOTES_SCHEDULE, INCIDENTS_SCHEDULE]) {
        try {
          await forkSchedules.remove(name);
        } catch (error) {
          log(
            `[office] the fork's stored ${name} schedule was not removed: ${errorMessage(error)}`,
          );
        }
      }
    })();
  }
  // The office keeps its own schedules: nothing is stored, so they are set from the settings at
  // each load, which also picks up a change of the host's zone, and again at each save.
  const notesSchedule = createNotesSchedule({
    schedules: deps.schedules,
    hostTimeZone: deps.hostTimeZone,
    log,
  });
  async function readHostSettings() {
    const state = await settings.read();
    if (state.status !== "ready") {
      throw new Error(`The office's settings cannot be read: ${state.error}`);
    }
    return state.values;
  }
  // One writer of the day's stand-up entry at a time, started at 8:00 and by the bell.
  const writer = createNotesWriter({
    ...liveNotesPorts(holder, hub),
    settings: readHostSettings,
    hostTimeZone: deps.hostTimeZone,
    now: () => deps.clock.now(),
    load: () => deps.notesStore.load(),
    save: (state) => deps.notesStore.save(state),
    changed: (state) => hub.setNotes({ ...state, scheduleError: notesSchedule.error() }),
    log,
  });
  // Every 5 minutes while a tracker is on; it follows the settings as the 8:00 schedule does.
  const incidentsSchedule = createIncidentsSchedule({ schedules: deps.schedules, log });
  // The check's last state, kept so a save that changes the schedule's error pushes it again.
  // Null until the store was read: the snapshot has no incidents before then.
  let checked: IncidentsCheckState | null = null;
  function pushIncidents(): void {
    if (checked === null) return;
    hub.setIncidents({
      ...checked,
      jiraReady: jiraEnv(deps.env) !== null,
      sentryReady: sentryToken(deps.env) !== null,
      scheduleError: incidentsSchedule.error(),
    });
  }
  // The settings are read at each run, so a save holds from the next check.
  const incidents = createIncidentsCheck({
    readers: async () => incidentsReaders(await readHostSettings(), deps.env),
    store: deps.incidentsStore,
    now: () => deps.clock.now(),
    log,
    changed: (state) => {
      checked = state;
      pushIncidents();
    },
  });
  incidents
    .start()
    .catch((error: unknown) => log(`[office] incidents load failed: ${errorMessage(error)}`));
  // One service for the office's life, made as the server starts. Its file is read first; until
  // then the chat call waits, and a snapshot has no chat.
  let chat: ChatService | null = null;
  let stopWatching: (() => void) | null = null;
  async function startChat(): Promise<void> {
    const service = await createChatService({
      store: deps.chatStore,
      clock: deps.clock,
      tr: chatT,
      ...liveChatPorts(holder),
      emit: (change) => hub.chatChange(change),
      log,
    });
    chat = service;
    stopWatching = hub.watch((view) => service.view(view));
    hub.setChat(() => service.snapshot());
  }
  const chatReady = startChat().catch((error: unknown) =>
    log(`[office] chat unavailable: ${errorMessage(error)}`),
  );
  // Neither schedule can follow settings it cannot read: both cards say why until a save is read.
  function settingsUnreadable(reason: string): void {
    const message = `The office's settings cannot be read: ${reason}`;
    log(`[office] ${message}`);
    notesSchedule.fail(message);
    incidentsSchedule.fail(message);
    hub.setNotes({ ...writer.state(), scheduleError: notesSchedule.error() });
    pushIncidents();
  }
  async function followSettings(
    state: PluginSettingsState<typeof officeHostSettings.schema>,
  ): Promise<void> {
    if (state.status !== "ready") {
      settingsUnreadable(state.error);
      return;
    }
    await notesSchedule.sync(state.values);
    // The writer reads the folder again, and its push carries the schedule's error with it.
    await writer
      .settingsChanged()
      .catch((error: unknown) => log(`[office] notes state failed: ${errorMessage(error)}`));
    const trackersOn = Object.keys(incidentsReaders(state.values, deps.env)).length > 0;
    await incidentsSchedule.sync(trackersOn);
    // With every tracker off no run comes again. One run with no reader drops the problems and
    // closes what is a day old.
    if (!trackersOn) await incidents.check();
    pushIncidents();
  }
  const stopFollowingSettings = settings.subscribe(followSettings);
  settings.read().then(followSettings, (error: unknown) => settingsUnreadable(errorMessage(error)));

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
  server.handle(worldRpc, () => guarded("world", () => deps.world.read()));
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
  server.handle(clearDoneRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("clear", () => office.clearDone(input.board));
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
  // On stock Paseo the API reaches the plugin only on a handler's or hook's context, so after a
  // restart on a quiet host a run waits until the office is opened or an agent's turn moves.
  async function paseoForRun(name: string): Promise<void> {
    if (!holder.held()) {
      log(
        `[office] ${name} run is waiting for the Paseo API: open the office, or let an agent open or end a turn`,
      );
    }
    await holder.wait();
  }
  // The 8:00 run ends once the writer started; the writer's own end is its turn's hook.
  const stopNotesRuns = deps.schedules.handle(NOTES_SCHEDULE, async (dueAt) => {
    await paseoForRun(NOTES_SCHEDULE);
    // The writer writes the day it starts on: a run that waited past midnight would write the
    // wrong day. Settings that cannot be read are left to the writer, which shows why.
    const zone = await readHostSettings().then(
      (values) => notesTimeZone(values, deps.hostTimeZone),
      () => null,
    );
    const late = zone === null ? null : lateNotesRun(dueAt, deps.clock.now(), zone);
    if (late !== null) {
      log(
        `[office] ${NOTES_SCHEDULE} run dropped: it was due on ${late.dueDay} and could only start on ${late.startDay}`,
      );
      return;
    }
    await writer.start();
  });
  server.handle(incidentsDismissRpc, ({ ids }) =>
    guarded("incidents dismiss", async () => ({ dismissed: await incidents.dismiss(ids) })),
  );
  server.handle(chatRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("chat", async () => {
      await chatReady;
      if (chat === null) throw new Error("The team chat did not start");
      return chat.request(input);
    });
  });
  // A check never rejects: a tracker that fails shows its problem on the Incidents card. It is
  // about now, so a run that waited checks when it resumes.
  const stopIncidentsRuns = deps.schedules.handle(INCIDENTS_SCHEDULE, async () => {
    await paseoForRun(INCIDENTS_SCHEDULE);
    await incidents.check();
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
    server.addHook("agent.turn.after", async ({ agent, outcome, turnId }, context) => {
      try {
        holder.remember(context.paseo);
        office.noteAgent(agent);
        office.turnEnded(agent.id);
      } catch (error) {
        log(`[office] agent.turn.after failed: ${errorMessage(error)}`);
      }
      try {
        void chat
          ?.turnEnded(agent, outcome, turnId)
          .catch((error: unknown) => log(`[office] chat turn end failed: ${errorMessage(error)}`));
      } catch (error) {
        log(`[office] chat turn end failed: ${errorMessage(error)}`);
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
      try {
        chat?.closed(agent.id);
      } catch (error) {
        log(`[office] chat close failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.archive.after", async ({ agent }) => {
      try {
        office.agentGone(agent.id);
        await writer.agentArchived(agent.id);
      } catch (error) {
        log(`[office] agent.archive.after failed: ${errorMessage(error)}`);
      }
      try {
        chat?.archived(agent.id);
      } catch (error) {
        log(`[office] chat archive failed: ${errorMessage(error)}`);
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
    stopIncidentsRuns();
    deps.schedules.stop();
    for (const remove of removeHooks) remove();
    machine.stop();
    office.stop();
    // A chat still loading would start its clock after this stop.
    await chatReady;
    stopWatching?.();
    await chat?.stop();
    await hub.stop();
  };
}

export default function contribute(server: PluginServerContext): () => Promise<void> {
  const log = (message: string) => console.error(message);
  return createOfficePlugin(server, {
    // A built-in runs in the daemon process; an installed plugin inherits the daemon's whole
    // environment. Either way process.env holds the daemon's PASEO_HOME.
    store: createBoardStore({
      file: boardsFile(process.env, homedir()),
      now: () => Date.now(),
      log,
    }),
    notesStore: createNotesStore({ file: notesWriterFile(process.env, homedir()), log }),
    incidentsStore: createIncidentsStore({ file: incidentsFile(process.env, homedir()), log }),
    chatStore: createChatStore({
      file: chatFile(process.env, homedir()),
      now: () => Date.now(),
      log,
    }),
    env: process.env,
    clock: nodeClock,
    log,
    world: embeddedWorldScript(),
    machine: {
      procRoot: "/proc",
      cgroupRoot: "/sys/fs/cgroup",
      platform: process.platform,
      // readAncestors (server/machine/proc.ts) returns the pid it starts from and every ancestor.
      // As a built-in this is the daemon, so the daemon and what is above it are protected; as an
      // installed plugin it is the plugin, so the plugin, the daemon worker and the supervisor are.
      selfPid: process.pid,
      stop: (pid) => void process.kill(pid, "SIGTERM"),
      sleep: (ms) => delay(ms, undefined, { ref: false }),
    },
    skillFolders: hostSkillFolders(process.env, homedir()),
    hostTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    schedules: createLocalSchedules({ clock: nodeClock, log }),
  });
}
