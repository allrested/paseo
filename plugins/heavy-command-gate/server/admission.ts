export type BlockReason = "slot" | "memory";

export interface QueuedCommand {
  id: string;
  estimateBytes: number;
  queuedAt: number;
}

export interface HeldCommand {
  estimateBytes: number;
  /** RSS of its process tree; null when the gate cannot read it. */
  rssBytes: number | null;
}

export interface AdmissionInput {
  /** Oldest first. */
  queue: readonly QueuedCommand[];
  held: readonly HeldCommand[];
  slots: number;
  reserveBytes: number;
  /** null when no reading exists: slots alone decide. */
  freeBytes: number | null;
  now: number;
  starvationMs: number;
}

export interface Admission {
  id: string;
  /** Started by the starvation guard without enough free memory. */
  forced: boolean;
}

export interface AdmissionDecision {
  /** A prefix of the queue, oldest first. */
  admitted: Admission[];
  /** Why the oldest command left waits; null when none is left. */
  blockedOn: BlockReason | null;
}

/**
 * Free memory less what running commands were promised and have not touched yet: each one's
 * estimate minus its RSS, never below zero, or its whole estimate when its RSS is unknown. Free
 * memory is a reading of what processes use now, and a command still growing into its estimate
 * will take the rest. Null when there is no reading.
 */
export function availableBytes(
  freeBytes: number | null,
  held: readonly HeldCommand[],
): number | null {
  if (freeBytes === null) return null;
  let promised = 0;
  for (const command of held) {
    promised += Math.max(0, command.estimateBytes - (command.rssBytes ?? 0));
  }
  return Math.max(0, freeBytes - promised);
}

/**
 * Admits waiters in queue order while a slot is free and the available memory (availableBytes)
 * covers the estimate plus the reserve. A command admitted in this pass has used nothing yet, so
 * its whole estimate is kept back from the ones behind it. A waiter that has waited at least the
 * starvation time starts when nothing holds a slot: the memory is then held by something the gate
 * cannot free.
 */
export function decideAdmission(input: AdmissionInput): AdmissionDecision {
  const admitted: Admission[] = [];
  let holders = input.held.length;
  const available = availableBytes(input.freeBytes, input.held);
  // Promised to the commands admitted in this pass.
  let promised = 0;
  for (const command of input.queue) {
    if (holders >= input.slots) return { admitted, blockedOn: "slot" };
    const needed = command.estimateBytes + input.reserveBytes;
    const fits = available === null || available - promised >= needed;
    const starved = holders === 0 && input.now - command.queuedAt >= input.starvationMs;
    if (!fits && !starved) return { admitted, blockedOn: "memory" };
    admitted.push({ id: command.id, forced: !fits });
    holders += 1;
    promised += command.estimateBytes;
  }
  return { admitted, blockedOn: null };
}
