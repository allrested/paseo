// The tally the daemon keeps: how many turns ended, how many of them failed, and how long agents
// were in turns, per hour and workspace. Loaded once, added to as turns end, saved after.
import type { Hour, Stats, StatsWorkspace } from "../shared/contracts.js";
import { hourOf, oldestKept, spread } from "../shared/hours.js";
import { errorMessage } from "./errors.js";
import type { StatsStore, StoredStats } from "./stats-store.js";

export interface StatsSubscriber {
  push(event: { type: "changed" }): Promise<void>;
  signal: AbortSignal;
}

/** A turn that ended. */
export interface EndedTurn {
  agentId: string;
  /** Null for an agent outside every workspace. */
  workspaceId: string | null;
  /** The folder the agent works in. */
  folder: string;
  failed: boolean;
}

/** A workspace as the host lists it now. */
export interface KnownWorkspace {
  id: string;
  name: string;
}

export interface AgentStats {
  /** An agent's turn began. */
  started(agentId: string): void;
  /** An agent's turn ended: it is counted, with the time since it began when that is known. */
  ended(turn: EndedTurn): Promise<void>;
  /** An agent went in the middle of a turn: the turn is never counted. */
  gone(agentId: string): void;
  /** The hours from `since` on, with the names of the workspaces they belong to. */
  read(since: string, workspaces: () => Promise<KnownWorkspace[]>): Promise<Stats>;
  /** Tells the subscriber of each change. Resolves when its signal aborts. */
  attach(subscriber: StatsSubscriber): Promise<void>;
}

/** The name of a path's last folder. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? path;
}

const NO_WORKSPACE = "";
const keyOf = (hour: string, workspaceId: string | null) =>
  `${hour}|${workspaceId ?? NO_WORKSPACE}`;

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export function createAgentStats(ports: {
  store: StatsStore;
  /** Now, in milliseconds. */
  now(): number;
  log(message: string): void;
}): AgentStats {
  const hours = new Map<string, Hour>();
  let folders: Record<string, string> = {};
  let countingSince = new Date(ports.now()).toISOString();
  /** When each agent's turn began. In memory only: a turn does not outlive the daemon. */
  const running = new Map<string, number>();
  const subscribers = new Set<StatsSubscriber>();

  // Never rejects: the store answers a file it cannot read with nothing.
  async function load(): Promise<void> {
    const stored = await ports.store.load();
    if (stored === null) return;
    countingSince = stored.countingSince;
    folders = { ...stored.folders };
    const oldest = oldestKept(ports.now());
    for (const hour of stored.hours) {
      if (hour.hour >= oldest) hours.set(keyOf(hour.hour, hour.workspaceId), { ...hour });
    }
  }
  const loaded = load();

  function bucket(hour: string, workspaceId: string | null): Hour {
    const key = keyOf(hour, workspaceId);
    let found = hours.get(key);
    if (!found) {
      found = { hour, workspaceId, turns: 0, failed: 0, workMs: 0 };
      hours.set(key, found);
    }
    return found;
  }

  function prune(): void {
    const oldest = oldestKept(ports.now());
    for (const [key, hour] of hours) {
      if (hour.hour < oldest) hours.delete(key);
    }
    const named = new Set([...hours.values()].map((hour) => hour.workspaceId ?? NO_WORKSPACE));
    for (const id of Object.keys(folders)) {
      if (!named.has(id)) delete folders[id];
    }
  }

  // One write at a time, and one more for everything that came meanwhile: many agents ending
  // turns together make two writes, not one each.
  let saving = false;
  let unsaved = false;
  async function save(): Promise<void> {
    if (saving) {
      unsaved = true;
      return;
    }
    saving = true;
    try {
      do {
        unsaved = false;
        // A copy: the tally goes on changing while the file is written.
        const snapshot: StoredStats = structuredClone({
          countingSince,
          hours: [...hours.values()],
          folders,
        });
        try {
          await ports.store.save(snapshot);
        } catch (error) {
          // The tally in memory is still right, and the next turn saves it whole.
          ports.log(`[agent-stats] the counts could not be saved: ${errorMessage(error)}`);
        }
      } while (unsaved);
    } finally {
      saving = false;
    }
  }

  return {
    started(agentId) {
      running.set(agentId, ports.now());
    },
    async ended({ agentId, workspaceId, folder, failed }) {
      const end = ports.now();
      const start = running.get(agentId);
      running.delete(agentId);
      await loaded;
      // The turn belongs to the hour it ended in; its time to every hour it ran through.
      const last = bucket(hourOf(end), workspaceId);
      last.turns += 1;
      if (failed) last.failed += 1;
      // A turn that began before the daemon listened has no start: it counts without a length.
      if (start !== undefined) {
        for (const part of spread(start, end)) bucket(part.hour, workspaceId).workMs += part.ms;
      }
      folders[workspaceId ?? NO_WORKSPACE] = folder;
      prune();
      for (const subscriber of subscribers) {
        // A subscriber that left between the check and the push rejects it; nothing is owed.
        void subscriber.push({ type: "changed" }).catch(() => undefined);
      }
      await save();
    },
    gone(agentId) {
      running.delete(agentId);
    },
    async read(since, workspaces) {
      await loaded;
      const shown = [...hours.values()].filter((hour) => hour.hour >= since);
      const ids = [...new Set(shown.map((hour) => hour.workspaceId ?? NO_WORKSPACE))];
      // Names are a courtesy: a host that cannot list its workspaces still has its counts.
      const known = new Map<string, KnownWorkspace>();
      if (ids.some((id) => id !== NO_WORKSPACE)) {
        try {
          for (const workspace of await workspaces()) known.set(workspace.id, workspace);
        } catch (error) {
          ports.log(`[agent-stats] the workspaces could not be listed: ${errorMessage(error)}`);
        }
      }
      const named = ids.map((id): StatsWorkspace => {
        if (id === NO_WORKSPACE) return { id, name: "No workspace", open: false };
        const now = known.get(id);
        if (now) return { id, name: now.name, open: true };
        return { id, name: folderName(folders[id] ?? id), open: false };
      });
      // A copy: the tally goes on changing after the answer is handed over.
      return { hours: structuredClone(shown), workspaces: named, countingSince };
    },
    async attach(subscriber) {
      if (subscriber.signal.aborted) return;
      subscribers.add(subscriber);
      await waitForAbort(subscriber.signal);
      subscribers.delete(subscriber);
    },
  };
}
