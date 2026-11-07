import type { RunningCommand, WaitingCommand } from "../shared/rpc.js";
import {
  availableBytes,
  decideAdmission,
  type BlockReason,
  type HeldCommand,
} from "./admission.js";
import type { ServerNotice, ShimHello, ShimProcess } from "./protocol.js";

/** The spec re-evaluates every 2 s and on every release. */
export const TICK_MS = 2_000;
/** A waiting shim prints its wait line every 30 s. */
export const NOTICE_MS = 30_000;
/** With nothing local running, the oldest waiter starts after 5 minutes anyway. */
export const STARVATION_MS = 300_000;

export interface GateConfig {
  enabled: boolean;
  slots: number;
  reserveBytes: number;
}

export interface GatePeer {
  send(notice: ServerNotice): void;
}

/** What the socket server needs: one join per shim connection, one leave when it closes. */
export interface GateMembership {
  /** Queues the command and returns its id. Sends `go` or `wait` through the peer first. */
  join(hello: ShimHello, peer: GatePeer): string;
  leave(id: string): void;
}

export interface GateDeps {
  now(): number;
  readFreeMemory(): number | null;
  readRss(shim: ShimProcess): number | null;
  /** Calls back every `ms` until the returned function is called. */
  startTimer(callback: () => void, ms: number): () => void;
  log(message: string): void;
}

export interface GateSnapshot {
  freeBytes: number | null;
  running: RunningCommand[];
  waiting: WaitingCommand[];
}

export interface Gate extends GateMembership {
  configure(config: GateConfig): void;
  snapshot(): GateSnapshot;
  stop(): void;
}

export interface GateOptions {
  config: GateConfig;
  deps: GateDeps;
}

interface Member {
  id: string;
  hello: ShimHello;
  peer: GatePeer;
  queuedAt: number;
  lastNoticeAt: number;
  startedAt: number;
  forced: boolean;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createGate(options: GateOptions): Gate {
  const { deps } = options;
  let config = options.config;
  const waiting: Member[] = [];
  const running = new Map<string, Member>();
  let nextId = 1;
  // Every waiter reports the reason the oldest one waits: FIFO means none starts before it.
  let blockedOn: BlockReason = "slot";
  // The last pass's memory reading. Go notices show it as read.
  let reading: number | null = null;
  // Free memory as the last pass counted it: the reading less what running commands were
  // promised and do not use yet. Wait notices show it, so the oldest command waiting on memory
  // shows less free memory than it needs.
  let freeBytes: number | null = null;
  let stopTimer: (() => void) | null = null;
  let stopped = false;

  function neededBytes(member: Member): number {
    return member.hello.estimateBytes + config.reserveBytes;
  }

  // A shim's socket can break at any time, and its throw must stay here: out of a pass it would
  // take the commands admitted after it off the queue without a go, and out of join it would
  // leave a queued command that the socket server holds no id to release.
  function send(member: Member, notice: ServerNotice): void {
    try {
      member.peer.send(notice);
    } catch (error) {
      deps.log(`heavy-command-gate: sending a notice to a shim failed: ${describeError(error)}`);
    }
  }

  function sendWait(member: Member, position: number): void {
    member.lastNoticeAt = deps.now();
    send(member, {
      type: "wait",
      ahead: position - 1,
      freeBytes,
      neededBytes: neededBytes(member),
      waitingOn: blockedOn,
    });
  }

  function admit(member: Member, forced: boolean): void {
    const now = deps.now();
    member.startedAt = now;
    member.forced = forced;
    running.set(member.id, member);
    const waitedMs = Math.max(0, now - member.queuedAt);
    if (forced) {
      // The command line can hold paths and arguments, so the daemon log never gets it.
      const minutes = Math.round(waitedMs / 60_000);
      deps.log(
        `heavy-command-gate: started a command after ${minutes} min without enough free memory`,
      );
    }
    send(member, {
      type: "go",
      forced,
      freeBytes: reading,
      neededBytes: neededBytes(member),
      waitedMs,
    });
  }

  function admitWaiters(): void {
    reading = deps.readFreeMemory();
    if (!config.enabled) {
      for (const member of waiting.splice(0)) admit(member, false);
      return;
    }
    const held: HeldCommand[] = [...running.values()].map((member) => ({
      estimateBytes: member.hello.estimateBytes,
      rssBytes: deps.readRss(member.hello.process),
    }));
    const decision = decideAdmission({
      queue: waiting.map((member) => ({
        id: member.id,
        estimateBytes: member.hello.estimateBytes,
        queuedAt: member.queuedAt,
      })),
      held,
      slots: config.slots,
      reserveBytes: config.reserveBytes,
      freeBytes: reading,
      now: deps.now(),
      starvationMs: STARVATION_MS,
    });
    // decideAdmission admits a prefix of the queue, in order.
    const admitted = waiting.splice(0, decision.admitted.length);
    for (const [index, member] of admitted.entries()) {
      admit(member, decision.admitted[index].forced);
      // It has used nothing yet, so it holds its whole estimate, as decideAdmission counted it.
      held.push({ estimateBytes: member.hello.estimateBytes, rssBytes: null });
    }
    freeBytes = availableBytes(reading, held);
    if (decision.blockedOn !== null) blockedOn = decision.blockedOn;
  }

  function syncTimer(): void {
    if (waiting.length > 0 && stopTimer === null && !stopped) {
      stopTimer = deps.startTimer(tick, TICK_MS);
    }
    if (waiting.length === 0 && stopTimer !== null) {
      stopTimer();
      stopTimer = null;
    }
  }

  function evaluate(): void {
    if (waiting.length > 0) admitWaiters();
    syncTimer();
  }

  // The timer fires inside the daemon, which an uncaught exception would end.
  function tick(): void {
    try {
      evaluate();
      const now = deps.now();
      for (const [index, member] of waiting.entries()) {
        if (now - member.lastNoticeAt >= NOTICE_MS) sendWait(member, index + 1);
      }
    } catch (error) {
      deps.log(`heavy-command-gate: re-evaluating the queue failed: ${describeError(error)}`);
    }
  }

  return {
    join(hello, peer) {
      if (stopped) throw new Error("the heavy-command gate is stopped");
      const now = deps.now();
      const member: Member = {
        id: String(nextId),
        hello,
        peer,
        queuedAt: now,
        lastNoticeAt: now,
        startedAt: now,
        forced: false,
      };
      nextId += 1;
      waiting.push(member);
      evaluate();
      const index = waiting.indexOf(member);
      if (index >= 0) sendWait(member, index + 1);
      return member.id;
    },
    leave(id) {
      if (running.delete(id)) {
        evaluate();
        return;
      }
      const index = waiting.findIndex((member) => member.id === id);
      if (index < 0) return;
      waiting.splice(index, 1);
      evaluate();
    },
    configure(next) {
      config = next;
      evaluate();
    },
    snapshot() {
      const now = deps.now();
      const runningCommands: RunningCommand[] = [...running.values()].map((member) => ({
        id: member.id,
        agentId: member.hello.agentId,
        agentTitle: null,
        command: member.hello.command,
        pid: member.hello.process.pid,
        elapsedMs: Math.max(0, now - member.startedAt),
        rssBytes: deps.readRss(member.hello.process),
        estimateBytes: member.hello.estimateBytes,
        forced: member.forced,
      }));
      return {
        // Each running command carries the estimate and the RSS that availableBytes counts.
        freeBytes: availableBytes(deps.readFreeMemory(), runningCommands),
        running: runningCommands,
        waiting: waiting.map((member, index) => ({
          id: member.id,
          agentId: member.hello.agentId,
          agentTitle: null,
          command: member.hello.command,
          pid: member.hello.process.pid,
          position: index + 1,
          waitedMs: Math.max(0, now - member.queuedAt),
          estimateBytes: member.hello.estimateBytes,
          waitingOn: blockedOn,
        })),
      };
    },
    stop() {
      stopped = true;
      waiting.length = 0;
      running.clear();
      syncTimer();
    },
  };
}
