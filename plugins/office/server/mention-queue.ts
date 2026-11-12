import { READ_POST_MAX, USER_AUTHOR, WAKES_PER_HOUR, type WakeState } from "../shared/contracts.js";
import { errorMessage } from "./errors.js";
import { indented, oneLine } from "./prompt-text.js";
import type { Clock } from "./timers.js";

export const WAKE_WINDOW_MS = 60 * 60 * 1000;
export const BUSY_RETRY_MS = 2000;
export const BUSY_RETRIES = 3;

export type WakeTarget = "wakeable" | "busy" | "gone";

/** The part of an agent snapshot that decides whether it can be woken (AgentSnapshotPayload fits). */
export interface WakeSnapshotInput {
  status: string;
  archivedAt?: string | null;
  pendingPermissions: readonly unknown[];
}

export function wakeTargetOf(agent: WakeSnapshotInput | null): WakeTarget {
  if (agent === null || agent.archivedAt || agent.status === "closed") return "gone";
  if (agent.pendingPermissions.length > 0) return "busy";
  return agent.status === "idle" || agent.status === "error" ? "wakeable" : "busy";
}

export interface Delivery {
  postId: string;
  /** An agent id, or "user". */
  author: string;
  /** How the prompt names the author, e.g. "Review MR (agent 1a2b3c4d)". */
  authorLabel: string;
  text: string;
}

/**
 * Spec: `Office board: <n> post(s) for you.` then one line per post with its id, author and text.
 * A post's further lines are indented and an author's name is kept on one line, so neither can
 * start a line that reads as another post.
 */
export function wakePrompt(deliveries: readonly Delivery[]): string {
  const lines = deliveries.map(
    (delivery) =>
      `- ${delivery.postId} from ${oneLine(delivery.authorLabel)}: ${indented(delivery.text)}`,
  );
  return [`Office board: ${deliveries.length} post(s) for you.`, ...lines].join("\n");
}

/** The agent to name as a wake's source: the one author of every post in it, unless the user. */
function sourceOf(batch: readonly Delivery[]): string | null {
  const authors = new Set(batch.map((item) => item.author));
  const [only] = authors;
  return authors.size === 1 && only !== undefined && only !== USER_AUTHOR ? only : null;
}

export interface MentionQueuePorts {
  clock: Clock;
  status(agentId: string): Promise<WakeTarget>;
  /** `sourceAgentId` is the agent whose posts these are, or null for a prompt as from the user. */
  send(agentId: string, prompt: string, sourceAgentId: string | null): Promise<void>;
  log(message: string): void;
  onChange(state: WakeState): void;
}

export interface MentionQueue {
  enqueue(agentId: string, delivery: Delivery): void;
  /** From agent.turn.after: the agent may be idle now. */
  turnEnded(agentId: string): void;
  /** From agent.close.after and agent.archive.after. */
  agentGone(agentId: string): void;
  setPaused(paused: boolean): void;
  state(): WakeState;
  stop(): void;
}

export function createMentionQueue(ports: MentionQueuePorts, paused: boolean): MentionQueue {
  const queues = new Map<string, Delivery[]>();
  const wakes = new Map<string, number[]>();
  const retries = new Map<string, number>();
  const timers = new Map<string, () => void>();
  const inFlight = new Set<string>();
  let isPaused = paused;
  let stopped = false;

  function state(): WakeState {
    const queued: Record<string, number> = {};
    for (const [agentId, list] of queues) if (list.length > 0) queued[agentId] = list.length;
    return { paused: isPaused, queued };
  }

  function changed(): void {
    try {
      ports.onChange(state());
    } catch (error) {
      ports.log(`[office] wake listener failed: ${errorMessage(error)}`);
    }
  }

  function clearTimer(agentId: string): void {
    timers.get(agentId)?.();
    timers.delete(agentId);
  }

  function schedule(agentId: string, ms: number): void {
    clearTimer(agentId);
    const cancel = ports.clock.setTimeout(() => {
      timers.delete(agentId);
      attempt(agentId);
    }, ms);
    timers.set(agentId, cancel);
  }

  function recentWakes(agentId: string): number[] {
    const cutoff = ports.clock.now() - WAKE_WINDOW_MS;
    const recent = (wakes.get(agentId) ?? []).filter((at) => at > cutoff);
    wakes.set(agentId, recent);
    return recent;
  }

  function retryLater(agentId: string): void {
    const count = (retries.get(agentId) ?? 0) + 1;
    retries.set(agentId, count);
    if (count <= BUSY_RETRIES) schedule(agentId, BUSY_RETRY_MS);
  }

  async function targetOf(agentId: string): Promise<WakeTarget> {
    try {
      return await ports.status(agentId);
    } catch (error) {
      ports.log(`[office] unable to read the state of ${agentId}: ${errorMessage(error)}`);
      return "busy";
    }
  }

  async function wake(agentId: string): Promise<void> {
    const target = await targetOf(agentId);
    if (stopped || isPaused) return;
    if (target === "gone") {
      queues.delete(agentId);
      retries.delete(agentId);
      clearTimer(agentId);
      changed();
      return;
    }
    if (target === "busy") {
      retryLater(agentId);
      return;
    }
    const waiting = queues.get(agentId) ?? [];
    if (waiting.length === 0) return;
    // One prompt carries at most a read's worth of posts; the rest wait for the next wake.
    const batch = waiting.slice(0, READ_POST_MAX);
    const rest = waiting.slice(READ_POST_MAX);
    if (rest.length > 0) queues.set(agentId, rest);
    else queues.delete(agentId);
    try {
      await ports.send(agentId, wakePrompt(batch), sourceOf(batch));
    } catch (error) {
      ports.log(`[office] unable to wake ${agentId}: ${errorMessage(error)}`);
      queues.set(agentId, [...batch, ...(queues.get(agentId) ?? [])]);
      retryLater(agentId);
      return;
    }
    wakes.set(agentId, [...recentWakes(agentId), ports.clock.now()]);
    retries.delete(agentId);
    changed();
  }

  async function deliver(agentId: string): Promise<void> {
    if (stopped || isPaused || inFlight.has(agentId)) return;
    if ((queues.get(agentId) ?? []).length === 0) return;
    const recent = recentWakes(agentId);
    if (recent.length >= WAKES_PER_HOUR) {
      const oldest = recent[0] ?? ports.clock.now();
      schedule(agentId, oldest + WAKE_WINDOW_MS - ports.clock.now());
      return;
    }
    inFlight.add(agentId);
    try {
      await wake(agentId);
    } finally {
      inFlight.delete(agentId);
    }
  }

  function attempt(agentId: string): void {
    deliver(agentId).catch((error: unknown) => {
      ports.log(`[office] wake of ${agentId} failed: ${errorMessage(error)}`);
    });
  }

  return {
    enqueue(agentId, delivery) {
      if (stopped || delivery.author === agentId) return;
      queues.set(agentId, [...(queues.get(agentId) ?? []), delivery]);
      changed();
      attempt(agentId);
    },
    turnEnded(agentId) {
      retries.delete(agentId);
      attempt(agentId);
    },
    agentGone(agentId) {
      clearTimer(agentId);
      retries.delete(agentId);
      if (queues.delete(agentId)) changed();
    },
    setPaused(next) {
      isPaused = next;
      changed();
      if (!next) for (const agentId of queues.keys()) attempt(agentId);
    },
    state,
    stop() {
      stopped = true;
      for (const cancel of timers.values()) cancel();
      timers.clear();
    },
  };
}
