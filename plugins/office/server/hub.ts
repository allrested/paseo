import type {
  Checklists,
  NotesState,
  OfficeAgent,
  OfficeEvent,
  OfficeSnapshot,
  OfficeWorkspace,
  Post,
  WakeState,
  WorkspaceScript,
} from "../shared/contracts.js";
import type { ActivityLines, ActivitySteps } from "./activity.js";
import { settleResets } from "./directory.js";
import { errorMessage } from "./errors.js";
import type { Timers } from "./timers.js";
import { NEXT_KEY, NUMBER_KEY, officeNames, planNumbers } from "./subagent-names.js";

/** Directory updates come in bursts while agents stream; one event per window is enough. */
export const DIRECTORY_FLUSH_MS = 300;
/** A directory that ends on its own is reopened at most once per window. */
export const DIRECTORY_RESTART_MS = 5000;

export interface DirectoryView {
  agents: readonly OfficeAgent[];
  workspaces: readonly OfficeWorkspace[];
}

export interface HubSubscriber {
  push(event: OfficeEvent): Promise<void>;
  signal: AbortSignal;
}

export interface HubPorts {
  /**
   * Starts the directory; calls onChange with the first view before it resolves. onEnd runs when
   * the directory stops on its own and will report no more changes.
   */
  openDirectory(
    onChange: (view: DirectoryView) => void,
    onEnd?: () => void,
  ): Promise<() => Promise<void>>;
  startActivity(
    running: () => readonly string[],
    onChange: (
      activity: ActivityLines,
      doing: ActivitySteps,
      checklists: Readonly<Checklists>,
    ) => void,
  ): () => void;
  timers: Timers;
  log(message: string): void;
  /** Stores data on an agent; the office keeps its sub-agent numbers there. */
  setAgentMetadata?(agentId: string, patch: Record<string, number>): Promise<void>;
}

export interface Hub {
  /** Streams the office to one subscriber. Resolves when its signal aborts; rejects when the directory cannot start. */
  attach(subscriber: HubSubscriber): Promise<void>;
  setBoards(boards: Readonly<Record<string, readonly Post[]>>): void;
  setBoard(board: string, posts: readonly Post[]): void;
  removeBoard(board: string): void;
  setWake(wake: WakeState): void;
  /** The stand-up notes writer's state; the same state again sends nothing. */
  setNotes(notes: NotesState): void;
  /**
   * The office now, for the stand-up report. While an office is open it is what its subscribers
   * see; while none is, a directory is opened for this read alone and closed again, so the read
   * has the agents and rooms but no "doing now" lines.
   */
  read(): Promise<OfficeSnapshot>;
  /**
   * The office reset this agent's conversation: its context reads empty from now until its
   * provider says another number than the one it says now.
   */
  contextReset(agentId: string): void;
  /**
   * A workspace's script as the directory last reported it; null when it has none by that name,
   * and while no office is open, when there is no directory.
   */
  script(workspaceId: string, name: string): WorkspaceScript | null;
  /** The ids of the workspaces the directory last reported; none while no office is open. */
  workspaceIds(): string[];
  stop(): Promise<void>;
}

const EMPTY_VIEW: DirectoryView = { agents: [], workspaces: [] };

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export function createHub(ports: HubPorts): Hub {
  const subscribers = new Set<HubSubscriber>();
  // Subscribers whose snapshot went out; changes reach only them, so a snapshot comes first.
  const ready = new WeakSet<HubSubscriber>();
  let view = EMPTY_VIEW;
  // The directory's own view, and the context each reset agent had; see settleResets.
  let reported = EMPTY_VIEW;
  let resets: ReadonlyMap<string, number> = new Map();
  let sentAgents = "";
  let sentWorkspaces = "";
  let activity: ActivityLines = {};
  let doing: ActivitySteps = {};
  // Kept after an agent stops, as the poller reads only running agents; dropped when it leaves.
  let checklists: Checklists = {};
  let boards: Record<string, readonly Post[]> = {};
  let wake: WakeState = { paused: false, queued: {} };
  let notes: NotesState | null = null;
  let sentNotes = "";
  let starting: Promise<void> | null = null;
  let stopDirectory: (() => Promise<void>) | null = null;
  let stopActivity: (() => void) | null = null;
  let cancelFlush: (() => void) | null = null;
  // Each start and each idle moves on, so an old directory's end or a stale start is ignored.
  let generation = 0;
  let cancelCooldown: (() => void) | null = null;
  let restartQueued: number | null = null;

  function snapshot(): OfficeSnapshot {
    const copy: Record<string, Post[]> = {};
    for (const [board, posts] of Object.entries(boards)) copy[board] = [...posts];
    return {
      agents: [...view.agents],
      workspaces: [...view.workspaces],
      activity: { ...activity },
      doing: { ...doing },
      checklists: { ...checklists },
      boards: copy,
      wake: { paused: wake.paused, queued: { ...wake.queued } },
      ...(notes === null ? {} : { notes: { ...notes } }),
    };
  }

  function broadcast(event: OfficeEvent): void {
    for (const subscriber of subscribers) {
      if (subscriber.signal.aborted || !ready.has(subscriber)) continue;
      subscriber
        .push(event)
        .catch((error: unknown) => ports.log(`[office] push failed: ${errorMessage(error)}`));
    }
  }

  function flushDirectory(): void {
    cancelFlush = null;
    const agents = JSON.stringify(view.agents);
    if (agents !== sentAgents) {
      sentAgents = agents;
      broadcast({ type: "agents", agents: [...view.agents] });
    }
    const workspaces = JSON.stringify(view.workspaces);
    if (workspaces !== sentWorkspaces) {
      sentWorkspaces = workspaces;
      broadcast({ type: "workspaces", workspaces: [...view.workspaces] });
    }
  }

  // Numbers sent and not yet reported back, by agent. They are planned as if stored, so a
  // number in flight is never handed out again, whatever order the echoes come back in.
  const pendingNumbers = new Map<string, Record<string, number>>();

  function withPending(agents: readonly OfficeAgent[]): OfficeAgent[] {
    return agents.map((agent) => {
      const patch = pendingNumbers.get(agent.id);
      if (patch === undefined) return agent;
      const number = patch[NUMBER_KEY];
      const next = patch[NEXT_KEY];
      if (
        (number === undefined || agent.number === number) &&
        (next === undefined || agent.next === next)
      ) {
        pendingNumbers.delete(agent.id);
        return agent;
      }
      return {
        ...agent,
        ...(number === undefined ? {} : { number }),
        ...(next === undefined ? {} : { next }),
      };
    });
  }

  function writeNumbers(agents: readonly OfficeAgent[]): void {
    const write = ports.setAgentMetadata;
    if (write === undefined) return;
    const send = (agentId: string, patch: Record<string, number>): Promise<boolean> =>
      write(agentId, patch).then(
        () => true,
        (error: unknown) => {
          pendingNumbers.delete(agentId);
          ports.log(`[office] subagent number failed: ${errorMessage(error)}`);
          return false;
        },
      );
    // A parent's next is stored before its sub-agents' numbers go out (see planNumbers).
    let parentStored: Promise<boolean> = Promise.resolve(true);
    for (const { agentId, patch } of planNumbers(withPending(agents))) {
      pendingNumbers.set(agentId, { ...pendingNumbers.get(agentId), ...patch });
      if (NEXT_KEY in patch) {
        parentStored = send(agentId, patch);
        continue;
      }
      void parentStored.then((stored) => {
        if (stored) return send(agentId, patch);
        pendingNumbers.delete(agentId);
        return false;
      });
    }
  }

  function named(agents: readonly OfficeAgent[]): OfficeAgent[] {
    const names = officeNames(agents);
    return agents.map((agent) => {
      const name = names.get(agent.id);
      return name === undefined ? agent : { ...agent, name };
    });
  }

  function activityEvent(): OfficeEvent {
    return {
      type: "activity",
      activity: { ...activity },
      doing: { ...doing },
      checklists: { ...checklists },
    };
  }

  function onDirectory(next: DirectoryView): void {
    reported = next;
    const listed = new Set(next.agents.map((agent) => agent.id));
    const kept = Object.entries(checklists).filter(([agentId]) => listed.has(agentId));
    if (kept.length < Object.keys(checklists).length) {
      checklists = Object.fromEntries(kept);
      // An agent that left the list takes its checklist with it now, not at the next poll round.
      if (stopDirectory !== null) broadcast(activityEvent());
    }
    writeNumbers(next.agents);
    const settled = settleResets(next.agents, resets);
    resets = settled.resets;
    view = {
      agents: named(resets.size === 0 ? next.agents : settled.agents),
      workspaces: next.workspaces,
    };
    // Until the start finished, the first snapshot carries the view.
    if (stopDirectory === null || cancelFlush !== null) return;
    cancelFlush = ports.timers.setTimeout(() => {
      try {
        flushDirectory();
      } catch (error) {
        ports.log(`[office] directory flush failed: ${errorMessage(error)}`);
      }
    }, DIRECTORY_FLUSH_MS);
  }

  /** Each report replaces the checklists of the agents it names; one reported empty goes. */
  function onActivity(
    next: ActivityLines,
    steps: ActivitySteps,
    report: Readonly<Checklists>,
  ): void {
    activity = next;
    doing = steps;
    const merged = Object.entries({ ...checklists, ...report });
    checklists = Object.fromEntries(merged.filter(([, list]) => list.length > 0));
    broadcast(activityEvent());
  }

  function running(): readonly string[] {
    return view.agents.filter((agent) => agent.status === "running").map((agent) => agent.id);
  }

  async function start(): Promise<void> {
    generation += 1;
    const mine = generation;
    const stop = await ports.openDirectory(onDirectory, () => onDirectoryEnd(mine));
    if (subscribers.size === 0 || mine !== generation) {
      view = EMPTY_VIEW;
      try {
        await stop();
      } catch (error) {
        // Whoever joined this start opens a fresh directory; a failed close is not theirs to see.
        ports.log(`[office] directory stop failed: ${errorMessage(error)}`);
      }
      return;
    }
    stopDirectory = stop;
    sentAgents = JSON.stringify(view.agents);
    sentWorkspaces = JSON.stringify(view.workspaces);
    stopActivity = ports.startActivity(running, onActivity);
    // Subscribers that already had a snapshot saw an older directory; attaches still waiting push their own.
    broadcast({ type: "snapshot", state: snapshot() });
  }

  async function ensureStarted(): Promise<void> {
    // A start that found nobody waiting closes its directory; whoever arrived meanwhile starts again.
    while (stopDirectory === null && subscribers.size > 0) {
      starting ??= start().finally(() => {
        starting = null;
      });
      await starting;
    }
  }

  async function restart(): Promise<void> {
    await idle();
    if (subscribers.size === 0) return;
    try {
      await ensureStarted();
    } catch (error) {
      queueRestart();
      throw error;
    }
  }

  /**
   * Keeps one rule: while anyone is attached and no directory runs, a start is in flight or a
   * restart timer is pending. Restarts stay at least one window apart.
   */
  function queueRestart(): void {
    if (subscribers.size === 0 || stopDirectory !== null || starting !== null) return;
    restartQueued = generation;
    cancelCooldown ??= ports.timers.setTimeout(onCooldownEnd, DIRECTORY_RESTART_MS);
  }

  function runRestart(): void {
    restartQueued = null;
    cancelCooldown = ports.timers.setTimeout(onCooldownEnd, DIRECTORY_RESTART_MS);
    restart().catch((error: unknown) =>
      ports.log(`[office] directory restart failed: ${errorMessage(error)}`),
    );
  }

  function onCooldownEnd(): void {
    cancelCooldown = null;
    try {
      if (restartQueued === generation && subscribers.size > 0) runRestart();
      else restartQueued = null;
    } catch (error) {
      ports.log(`[office] directory restart failed: ${errorMessage(error)}`);
    }
  }

  function onDirectoryEnd(of: number): void {
    if (of !== generation) return;
    ports.log("[office] directory ended; restarting it");
    if (cancelCooldown === null) runRestart();
    else restartQueued = of;
  }

  async function idle(): Promise<void> {
    generation += 1;
    cancelFlush?.();
    cancelFlush = null;
    stopActivity?.();
    stopActivity = null;
    activity = {};
    doing = {};
    checklists = {};
    const stop = stopDirectory;
    stopDirectory = null;
    view = EMPTY_VIEW;
    reported = EMPTY_VIEW;
    pendingNumbers.clear();
    if (stop === null) return;
    try {
      await stop();
    } catch (error) {
      ports.log(`[office] directory stop failed: ${errorMessage(error)}`);
    }
  }

  return {
    async attach(subscriber) {
      if (subscriber.signal.aborted) return;
      subscribers.add(subscriber);
      subscriber.signal.addEventListener(
        "abort",
        () => {
          subscribers.delete(subscriber);
          if (subscribers.size === 0) {
            idle().catch((error: unknown) =>
              ports.log(`[office] idle failed: ${errorMessage(error)}`),
            );
          }
        },
        { once: true },
      );
      try {
        await ensureStarted();
      } catch (error) {
        subscribers.delete(subscriber);
        ports.log(`[office] unable to start: ${errorMessage(error)}`);
        queueRestart();
        throw error;
      }
      if (subscriber.signal.aborted) return;
      ready.add(subscriber);
      await subscriber.push({ type: "snapshot", state: snapshot() });
      await waitForAbort(subscriber.signal);
    },
    setBoards(next) {
      boards = { ...next };
      broadcast({ type: "snapshot", state: snapshot() });
    },
    setBoard(board, posts) {
      boards = { ...boards, [board]: [...posts] };
      broadcast({ type: "board", board, posts: [...posts] });
    },
    removeBoard(board) {
      if (!Object.hasOwn(boards, board)) return;
      boards = Object.fromEntries(Object.entries(boards).filter(([key]) => key !== board));
      broadcast({ type: "board-removed", board });
    },
    setWake(next) {
      wake = { paused: next.paused, queued: { ...next.queued } };
      broadcast({ type: "wake", wake: { paused: wake.paused, queued: { ...wake.queued } } });
    },
    setNotes(next) {
      const text = JSON.stringify(next);
      if (text === sentNotes) return;
      sentNotes = text;
      notes = { ...next };
      broadcast({ type: "snapshot", state: snapshot() });
    },
    async read() {
      if (stopDirectory !== null) return snapshot();
      let latest = EMPTY_VIEW;
      const stop = await ports.openDirectory((next) => {
        latest = next;
      });
      try {
        await stop();
      } catch (error) {
        ports.log(`[office] directory stop failed: ${errorMessage(error)}`);
      }
      return { ...snapshot(), agents: named(latest.agents), workspaces: [...latest.workspaces] };
    },
    script(workspaceId, name) {
      const workspace = reported.workspaces.find((candidate) => candidate.id === workspaceId);
      return workspace?.scripts?.find((candidate) => candidate.name === name) ?? null;
    },
    workspaceIds() {
      return reported.workspaces.map((workspace) => workspace.id);
    },
    contextReset(agentId) {
      const before = reported.agents.find((agent) => agent.id === agentId)?.context?.usedTokens;
      if (before === undefined || before === 0) return;
      resets = new Map(resets).set(agentId, before);
      onDirectory(reported);
    },
    async stop() {
      resets = new Map();
      subscribers.clear();
      cancelCooldown?.();
      cancelCooldown = null;
      restartQueued = null;
      await idle();
    },
  };
}
