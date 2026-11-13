import type {
  OfficeAgent,
  OfficeEvent,
  OfficeSnapshot,
  OfficeWorkspace,
  Post,
  WakeState,
} from "../shared/contracts.js";
import { errorMessage } from "./errors.js";
import type { Timers } from "./timers.js";

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
    onChange: (activity: Readonly<Record<string, string>>) => void,
  ): () => void;
  timers: Timers;
  log(message: string): void;
  /** Whether the host can draw the 3D view for a device that cannot. Unset leaves it unsaid. */
  renderAvailable?(): boolean;
}

export interface Hub {
  /** Streams the office to one subscriber. Resolves when its signal aborts; rejects when the directory cannot start. */
  attach(subscriber: HubSubscriber): Promise<void>;
  setBoards(boards: Readonly<Record<string, readonly Post[]>>): void;
  setBoard(board: string, posts: readonly Post[]): void;
  removeBoard(board: string): void;
  setWake(wake: WakeState): void;
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
  let sentAgents = "";
  let sentWorkspaces = "";
  let activity: Readonly<Record<string, string>> = {};
  let boards: Record<string, readonly Post[]> = {};
  let wake: WakeState = { paused: false, queued: {} };
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
      boards: copy,
      wake: { paused: wake.paused, queued: { ...wake.queued } },
      ...(ports.renderAvailable ? { render: { available: ports.renderAvailable() } } : {}),
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

  function onDirectory(next: DirectoryView): void {
    view = next;
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

  function onActivity(next: Readonly<Record<string, string>>): void {
    activity = next;
    broadcast({ type: "activity", activity: { ...next } });
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
    const stop = stopDirectory;
    stopDirectory = null;
    view = EMPTY_VIEW;
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
    async stop() {
      subscribers.clear();
      cancelCooldown?.();
      cancelCooldown = null;
      restartQueued = null;
      await idle();
    },
  };
}
