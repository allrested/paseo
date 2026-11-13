import type { Bridge } from "./bridge.js";

export type Holder = { kind: "viewer"; id: string } | { kind: "agent"; id: string };
export type BridgeStatus =
  | { status: "stopped" }
  | { status: "starting" }
  | { status: "running" }
  | { status: "failed"; error: string };

export class TooManyDesigns extends Error {
  constructor(max: number) {
    super(`Too many open designs (${max}). Close one first.`);
    this.name = "TooManyDesigns";
  }
}

export interface Bridges {
  acquire(fileId: string, holder: Holder): Promise<Bridge>;
  release(fileId: string, holder: Holder): void;
  releaseAgent(agentId: string): void;
  running(): string[];
  status(fileId: string): BridgeStatus;
  stopAll(): Promise<void>;
}

interface Entry {
  bridge: Promise<Bridge>;
  holders: Set<string>;
  idle: unknown | null;
  restarts: number;
  stopping: boolean;
  running: boolean;
}

const key = (holder: Holder) => `${holder.kind}:${holder.id}`;

export function createBridges(options: {
  max: number;
  idleMs: number;
  openBridge(fileId: string): Promise<Bridge>;
  clock: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
  log(line: string): void;
  onStatus(fileId: string, status: BridgeStatus): void;
}): Bridges {
  const entries = new Map<string, Entry>();
  const failed = new Map<string, string>();

  function setStatus(fileId: string, status: BridgeStatus): void {
    try {
      options.onStatus(fileId, status);
    } catch (error) {
      options.log(`[design] status listener failed: ${(error as Error).message}`);
    }
  }

  function start(fileId: string, entry: Entry): Promise<Bridge> {
    entry.running = false;
    setStatus(fileId, { status: "starting" });
    const opening = options.openBridge(fileId).then((bridge) => {
      entry.running = true;
      bridge.onExit((reason) => crashed(fileId, reason));
      setStatus(fileId, { status: "running" });
      return bridge;
    });
    opening.catch((error: Error) => {
      entries.delete(fileId);
      failed.set(fileId, error.message);
      setStatus(fileId, { status: "failed", error: error.message });
    });
    entry.bridge = opening;
    return opening;
  }

  function crashed(fileId: string, reason: string): void {
    const entry = entries.get(fileId);
    if (!entry || entry.stopping) return;
    if (entry.restarts >= 1) {
      entries.delete(fileId);
      const error = `Bridge stopped: ${reason}`;
      failed.set(fileId, error);
      options.log(`[design] ${fileId}: ${error}`);
      setStatus(fileId, { status: "failed", error });
      return;
    }
    entry.restarts += 1;
    options.log(`[design] ${fileId}: bridge ${reason}; restarting once`);
    void start(fileId, entry).catch(() => undefined);
  }

  async function stop(fileId: string): Promise<void> {
    const entry = entries.get(fileId);
    if (!entry) return;
    entry.stopping = true;
    entries.delete(fileId);
    try {
      await (await entry.bridge).close();
    } catch (error) {
      options.log(`[design] ${fileId}: close failed: ${(error as Error).message}`);
    }
    setStatus(fileId, { status: "stopped" });
  }

  function scheduleIdle(fileId: string, entry: Entry): void {
    if (entry.holders.size > 0 || entry.idle !== null) return;
    entry.idle = options.clock.setTimeout(() => void stop(fileId), options.idleMs);
  }

  return {
    async acquire(fileId, holder) {
      let entry = entries.get(fileId);
      if (!entry) {
        if (entries.size >= options.max) throw new TooManyDesigns(options.max);
        failed.delete(fileId);
        entry = {
          bridge: Promise.resolve(null as unknown as Bridge),
          holders: new Set(),
          idle: null,
          restarts: 0,
          stopping: false,
          running: false,
        };
        entries.set(fileId, entry);
        start(fileId, entry);
      }
      if (entry.idle !== null) {
        options.clock.clearTimeout(entry.idle);
        entry.idle = null;
      }
      entry.holders.add(key(holder));
      return entry.bridge;
    },
    release(fileId, holder) {
      const entry = entries.get(fileId);
      if (!entry) return;
      entry.holders.delete(key(holder));
      scheduleIdle(fileId, entry);
    },
    releaseAgent(agentId) {
      for (const [fileId, entry] of entries) {
        if (entry.holders.delete(`agent:${agentId}`)) scheduleIdle(fileId, entry);
      }
    },
    running: () => [...entries.keys()],
    status(fileId) {
      const entry = entries.get(fileId);
      if (entry) return { status: entry.running ? "running" : "starting" };
      const error = failed.get(fileId);
      return error ? { status: "failed", error } : { status: "stopped" };
    },
    async stopAll() {
      await Promise.all([...entries.keys()].map((fileId) => stop(fileId)));
    },
  };
}
