import type { ServerStatus } from "../shared/rpc.js";
import type { ServerDefinition } from "../shared/settings.js";
import type { ProbeResult } from "./probe.js";
import { LogRing, type ExitInfo, type RunningProcess } from "./process-runner.js";

export interface SupervisorDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): () => void;
  spawn(def: ServerDefinition, onLine: (line: string) => void): RunningProcess;
  probe(def: ServerDefinition): Promise<ProbeResult>;
  pathExists(path: string): Promise<boolean>;
  readRss(pgid: number): Promise<number | null>;
}

export const TIMING = {
  probeIntervalMs: 30_000,
  probeTimeoutMs: 5_000,
  failedProbesBeforeRestart: 2,
  startupProbeMs: 1_000,
  startupTimeoutMs: 120_000,
  backoffStartMs: 2_000,
  backoffMaxMs: 60_000,
  backoffResetAfterHealthyMs: 600_000,
  crashWindowMs: 600_000,
  crashLimit: 5,
  failingRetryMs: 300_000,
  stopGraceMs: 5_000,
  // The daemon waits 2 s for an in-process plugin's cleanup (SOFT_SHUTDOWN_TIMEOUT_MS). stop(g) can
  // take g + 1 s when a setsid'd child whose parent exited holds the pipes: the process-runner
  // measurement was 1,858 ms for stop(800) and 2,565 ms for stop(1_500).
  shutdownGraceMs: 800,
} as const;

type ServerState = ServerStatus["state"];

export type RestartRefusal = "unknown" | "external" | "disabled";

const REFUSALS: Record<RestartRefusal, string> = {
  unknown: "is not defined",
  external: "is external: Paseo did not start it, so it cannot restart it",
  disabled: "is disabled: enable it to start it",
};

export class RestartRefusedError extends Error {
  readonly serverId: string;
  readonly reason: RestartRefusal;

  constructor(serverId: string, reason: RestartRefusal) {
    super(`Server "${serverId}" ${REFUSALS[reason]}`);
    this.name = "RestartRefusedError";
    this.serverId = serverId;
    this.reason = reason;
  }
}

interface ServerEntry {
  def: ServerDefinition;
  state: ServerState;
  child: RunningProcess | null;
  // Set when Paseo's own process is stopped or exits. The next pre-spawn probe can still reach
  // that process while it shuts down, so an answer then must not adopt the port as "external".
  stoppedOwnChild: boolean;
  startedAt: number | null;
  healthySince: number | null;
  nextRetryAt: number | null;
  lastError: string | null;
  spawns: number;
  failedProbes: number;
  crashes: number[];
  backoffMs: number;
  // Bumped when the entry is stopped, replaced or restarted. An async step that began under an
  // older epoch drops its result instead of acting on a server that has moved on.
  epoch: number;
  cancelTimer: (() => void) | null;
  // The guarded stop() of the process this entry let go of, until it settles. Never rejects.
  pendingStop: Promise<void> | null;
  log: LogRing;
}

export class Supervisor {
  private entries = new Map<string, ServerEntry>();
  // Groups whose stop() has not settled, each with the entry that reports a failed stop. An entry
  // lets go of its process before stopping it, so this is the only place stopAll() can still find
  // them.
  private stopping = new Map<RunningProcess, ServerEntry>();
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly deps: SupervisorDeps) {}

  apply(defs: ServerDefinition[]): Promise<void> {
    return this.serialize(() => this.reconcile(defs));
  }

  restart(id: string): Promise<void> {
    return this.serialize(() => this.restartNow(id));
  }

  status(): Promise<ServerStatus[]> {
    const entries = [...this.entries.values()];
    return Promise.all(entries.map((entry) => this.toStatus(entry)));
  }

  // Every group gets stop(shutdownGraceMs) before the first await, because the daemon gives plugin
  // cleanup 2 s. A group that a restart, a kill or apply() is already stopping with stopGraceMs
  // gets a second call, which brings its SIGKILL forward. stopAll() skips the queue so a slow
  // apply() cannot hold shutdown back.
  async stopAll(): Promise<void> {
    this.stopped = true;
    const inFlight = [...this.stopping].map(([child, entry]) =>
      this.guardedStop(entry, child, TIMING.shutdownGraceMs),
    );
    const owned = [...this.entries.values()].map((entry) =>
      this.stopEntry(entry, TIMING.shutdownGraceMs),
    );
    await Promise.all([...inFlight, ...owned]);
  }

  // A failed call rejects for its own caller; later calls still run.
  private serialize(work: () => Promise<void>): Promise<void> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  // A new or changed server can reuse the port of one that is still stopping, so every stop
  // finishes before anything starts.
  private async reconcile(defs: ServerDefinition[]): Promise<void> {
    const previous = this.entries;
    this.entries = new Map();
    const stops: Promise<void>[] = [];
    const starts: ServerEntry[] = [];
    for (const def of defs) {
      const existing = previous.get(def.id);
      const entry = existing ?? createEntry(def);
      this.entries.set(def.id, entry);
      if (existing === undefined) {
        starts.push(entry);
      } else if (needsRestart(existing.def, def)) {
        resetFailures(entry);
        stops.push(this.stopEntry(entry, TIMING.stopGraceMs));
        starts.push(entry);
      }
      entry.def = def;
    }
    for (const [id, entry] of previous) {
      if (!this.entries.has(id)) stops.push(this.stopEntry(entry, TIMING.stopGraceMs));
    }
    await Promise.all(stops);
    await Promise.all(starts.map((entry) => this.start(entry)));
  }

  private async restartNow(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry === undefined) throw new RestartRefusedError(id, "unknown");
    if (entry.state === "external" || entry.state === "disabled") {
      throw new RestartRefusedError(id, entry.state);
    }
    resetFailures(entry);
    await this.stopEntry(entry, TIMING.stopGraceMs);
    await this.start(entry);
  }

  private async start(entry: ServerEntry): Promise<void> {
    entry.state = entry.def.enabled ? "starting" : "disabled";
    if (entry.def.enabled) await this.run(entry, () => this.launch(entry));
  }

  private async launch(entry: ServerEntry): Promise<void> {
    const epoch = entry.epoch;
    entry.nextRetryAt = null;
    const missing = await this.findMissingPath(entry.def.requires);
    if (!this.isCurrent(entry, epoch)) return;
    if (missing !== null) {
      this.block(entry, missing);
      return;
    }
    const probe = await this.deps.probe(entry.def);
    if (!this.isCurrent(entry, epoch)) return;
    const afterOwnStop = entry.stoppedOwnChild;
    entry.stoppedOwnChild = false;
    if (!probe.ok) this.spawn(entry);
    else if (afterOwnStop) this.portStillHeld(entry);
    else this.adopt(entry);
  }

  private async findMissingPath(paths: string[]): Promise<string | null> {
    for (const path of paths) {
      if (!(await this.deps.pathExists(path))) return path;
    }
    return null;
  }

  private block(entry: ServerEntry, path: string): void {
    entry.state = "blocked";
    entry.lastError = `Required path missing: ${path}`;
    this.schedule(entry, TIMING.probeIntervalMs, () => this.launch(entry));
  }

  // Adopting the answer would leave Paseo's own process running as "external", where restart()
  // and stopAll() never reach it. One backoff gives it time to finish shutting down.
  private portStillHeld(entry: ServerEntry): void {
    entry.lastError = `Port ${entry.def.port} still in use after stop`;
    this.retryLater(entry, "backoff", TIMING.backoffStartMs);
  }

  private adopt(entry: ServerEntry): void {
    entry.state = "external";
    this.schedule(entry, TIMING.probeIntervalMs, () => this.checkExternal(entry));
  }

  // launch() probes again before it spawns, so one missed probe does not start a second server.
  private async checkExternal(entry: ServerEntry): Promise<void> {
    const epoch = entry.epoch;
    const probe = await this.deps.probe(entry.def);
    if (!this.isCurrent(entry, epoch)) return;
    if (probe.ok) this.adopt(entry);
    else await this.launch(entry);
  }

  private spawn(entry: ServerEntry): void {
    let child: RunningProcess;
    try {
      child = this.deps.spawn(entry.def, (line) => entry.log.push(line));
    } catch (error) {
      // Opening the log file or the spawn itself can throw; retry it like any other crash.
      this.crash(entry, errorMessage(error));
      return;
    }
    const startedAt = this.deps.now();
    entry.child = child;
    entry.state = "starting";
    entry.startedAt = startedAt;
    entry.spawns += 1;
    void this.run(entry, () => this.watchExit(entry, child));
    const deadline = startedAt + TIMING.startupTimeoutMs;
    this.schedule(entry, TIMING.startupProbeMs, () => this.checkStartup(entry, deadline));
  }

  // exited resolves only after the runner has killed what the leader left running, so nothing is
  // left to stop, and the group id may already belong to another process. A stop the supervisor
  // started (restart, kill, apply, stopAll) has already let go of the child, so that exit is not a
  // crash.
  private async watchExit(entry: ServerEntry, child: RunningProcess): Promise<void> {
    const exit = await child.exited;
    if (entry.child !== child) return;
    this.invalidate(entry);
    entry.child = null;
    entry.stoppedOwnChild = true;
    this.crash(entry, describeExit(exit));
  }

  private async checkStartup(entry: ServerEntry, deadline: number): Promise<void> {
    const epoch = entry.epoch;
    const probe = await this.deps.probe(entry.def);
    if (!this.isCurrent(entry, epoch)) return;
    if (probe.ok) {
      this.markHealthy(entry);
      return;
    }
    if (this.deps.now() < deadline) {
      this.schedule(entry, TIMING.startupProbeMs, () => this.checkStartup(entry, deadline));
      return;
    }
    const seconds = TIMING.startupTimeoutMs / 1000;
    await this.kill(entry, `Not healthy within ${seconds} s: ${probe.error}`);
  }

  private markHealthy(entry: ServerEntry): void {
    entry.state = "healthy";
    entry.healthySince = this.deps.now();
    entry.failedProbes = 0;
    this.scheduleHealthCheck(entry);
  }

  private scheduleHealthCheck(entry: ServerEntry): void {
    this.schedule(entry, TIMING.probeIntervalMs, () => this.checkHealth(entry));
  }

  private async checkHealth(entry: ServerEntry): Promise<void> {
    const epoch = entry.epoch;
    const probe = await this.deps.probe(entry.def);
    if (!this.isCurrent(entry, epoch)) return;
    if (probe.ok) {
      entry.state = "healthy";
      entry.failedProbes = 0;
      this.scheduleHealthCheck(entry);
      return;
    }
    entry.failedProbes += 1;
    if (entry.failedProbes >= TIMING.failedProbesBeforeRestart) {
      const reason = `Health check failed ${entry.failedProbes} times in a row: ${probe.error}`;
      await this.kill(entry, reason);
      return;
    }
    entry.state = "unhealthy";
    entry.lastError = `Health check failed: ${probe.error}`;
    this.scheduleHealthCheck(entry);
  }

  // A forced restart counts as a crash, so a server that keeps hanging backs off and reaches
  // "failing" the same way as one that keeps exiting.
  private async kill(entry: ServerEntry, reason: string): Promise<void> {
    const epoch = entry.epoch;
    entry.state = "unhealthy";
    await this.stopProcess(entry, TIMING.stopGraceMs);
    if (this.isCurrent(entry, epoch)) this.crash(entry, reason);
  }

  private crash(entry: ServerEntry, reason: string): void {
    const now = this.deps.now();
    const healthyLongEnough =
      entry.healthySince !== null && now - entry.healthySince >= TIMING.backoffResetAfterHealthyMs;
    if (healthyLongEnough) entry.backoffMs = TIMING.backoffStartMs;
    entry.startedAt = null;
    entry.healthySince = null;
    entry.lastError = reason;
    entry.crashes = entry.crashes.filter((at) => now - at < TIMING.crashWindowMs);
    entry.crashes.push(now);
    if (entry.crashes.length >= TIMING.crashLimit) {
      this.retryLater(entry, "failing", TIMING.failingRetryMs);
      return;
    }
    const delayMs = entry.backoffMs;
    entry.backoffMs = Math.min(delayMs * 2, TIMING.backoffMaxMs);
    this.retryLater(entry, "backoff", delayMs);
  }

  private retryLater(entry: ServerEntry, state: "backoff" | "failing", delayMs: number): void {
    entry.state = state;
    entry.nextRetryAt = this.deps.now() + delayMs;
    this.schedule(entry, delayMs, () => this.launch(entry));
  }

  private async stopEntry(entry: ServerEntry, graceMs: number): Promise<void> {
    this.invalidate(entry);
    entry.startedAt = null;
    entry.healthySince = null;
    entry.nextRetryAt = null;
    await this.stopProcess(entry, graceMs);
  }

  // Lets go of the entry's process, then stops its whole group. With no process, it waits for the
  // stop a kill may still have pending, so a restart or a changed definition never starts a second
  // copy beside the old one. stopAll() waits on its own shortened call to that group instead.
  private async stopProcess(entry: ServerEntry, graceMs: number): Promise<void> {
    const child = entry.child;
    if (child === null) {
      if (entry.pendingStop !== null && !this.stopped) await entry.pendingStop;
      return;
    }
    entry.child = null;
    entry.stoppedOwnChild = true;
    this.stopping.set(child, entry);
    const pending = this.guardedStop(entry, child, graceMs);
    entry.pendingStop = pending;
    await pending;
    this.stopping.delete(child);
    if (entry.pendingStop === pending) entry.pendingStop = null;
  }

  // stop() is not expected to reject, but a rejection here would either exit the daemon or leave
  // the server with no process and no retry, so it becomes lastError instead.
  private async guardedStop(
    entry: ServerEntry,
    child: RunningProcess,
    graceMs: number,
  ): Promise<void> {
    try {
      await child.stop(graceMs);
    } catch (error) {
      entry.lastError = `Stopping process group ${child.pid} failed: ${errorMessage(error)}`;
    }
  }

  private invalidate(entry: ServerEntry): void {
    entry.epoch += 1;
    entry.cancelTimer?.();
    entry.cancelTimer = null;
  }

  private isCurrent(entry: ServerEntry, epoch: number): boolean {
    return !this.stopped && entry.epoch === epoch;
  }

  private schedule(entry: ServerEntry, delayMs: number, step: () => Promise<void>): void {
    entry.cancelTimer?.();
    entry.cancelTimer = this.deps.setTimer(() => {
      entry.cancelTimer = null;
      void this.run(entry, step);
    }, delayMs);
  }

  // This plugin runs inside the daemon, where an unhandled rejection exits the whole process. A
  // step that rejects counts as a crash, so the server backs off and retries instead of stalling
  // with no process and no timer. kill() never rejects, so neither does run().
  private async run(entry: ServerEntry, step: () => Promise<void>): Promise<void> {
    const epoch = entry.epoch;
    try {
      await step();
    } catch (error) {
      if (this.isCurrent(entry, epoch)) await this.kill(entry, errorMessage(error));
    }
  }

  private async toStatus(entry: ServerEntry): Promise<ServerStatus> {
    const pid = entry.child === null ? null : entry.child.pid;
    // A spawned server leads its own process group, so its pid is also the group id.
    const rssBytes = pid === null ? null : await this.deps.readRss(pid);
    const restarts = Math.max(entry.spawns - 1, 0);
    return {
      id: entry.def.id,
      label: entry.def.label,
      port: entry.def.port,
      state: entry.state,
      pid,
      startedAt: toIso(entry.startedAt),
      restarts,
      rssBytes,
      lastError: entry.lastError,
      nextRetryAt: toIso(entry.nextRetryAt),
      logTail: entry.log.lines(),
    };
  }
}

function createEntry(def: ServerDefinition): ServerEntry {
  return {
    def,
    state: def.enabled ? "starting" : "disabled",
    child: null,
    stoppedOwnChild: false,
    startedAt: null,
    healthySince: null,
    nextRetryAt: null,
    lastError: null,
    spawns: 0,
    failedProbes: 0,
    crashes: [],
    backoffMs: TIMING.backoffStartMs,
    epoch: 0,
    cancelTimer: null,
    pendingStop: null,
    log: new LogRing(),
  };
}

function resetFailures(entry: ServerEntry): void {
  entry.crashes = [];
  entry.backoffMs = TIMING.backoffStartMs;
  entry.lastError = null;
}

// Only fields that shape the process restart it. label and healthPath are read where they are
// used, and agentEnv only names the agents' variable, so editing those never drops the agents
// connected to the server.
function needsRestart(a: ServerDefinition, b: ServerDefinition): boolean {
  return (
    a.command !== b.command ||
    a.cwd !== b.cwd ||
    a.port !== b.port ||
    a.enabled !== b.enabled ||
    a.bearerToken?.serverEnv !== b.bearerToken?.serverEnv ||
    !sameEnv(a.env, b.env) ||
    !sameList(a.requires, b.requires)
  );
}

// Key order does not matter: the settings editor can reorder keys without changing the process.
function sameEnv(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => b[key] === a[key]);
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function describeExit(exit: ExitInfo): string {
  if (exit.signal !== null) return `Killed by ${exit.signal}`;
  return `Exited with code ${exit.code}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toIso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}
