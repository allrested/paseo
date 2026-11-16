import { useCallback, useState } from "react";
import { useRpc, useSubscription } from "@getpaseo/plugin/client";
import {
  cleanupRpc,
  machineSubscription,
  type Machine,
  type MachineEvent,
} from "../shared/contracts.js";
import { cleanupFailure } from "../shared/machine-text.js";

const NO_INPUT = {};

export interface MachineState {
  /** The last reading; null before the first, and on a host that has none. */
  machine: Machine | null;
  /** Rejects with one sentence when something was left as it is. */
  cleanUp(agentIds: readonly string[]): Promise<void>;
}

/** The host's readings while the office is open, and the call that frees what agents hold. */
export function useMachine(): MachineState {
  const [machine, setMachine] = useState<Machine | null>(null);
  const onEvent = useCallback((event: MachineEvent) => {
    setMachine(event.type === "reading" ? event.machine : null);
  }, []);
  const subscription = useSubscription(machineSubscription, NO_INPUT, onEvent);
  const cleanup = useRpc(cleanupRpc);
  const cleanUp = useCallback(
    async (agentIds: readonly string[]) => {
      const { results } = await cleanup({ agentIds: [...agentIds] });
      const failure = cleanupFailure(results);
      if (failure !== null) throw new Error(failure);
    },
    [cleanup],
  );
  // A reading from a subscription that ended would never change again.
  const live = subscription.status !== "error" && subscription.status !== "closed";
  return { machine: live ? machine : null, cleanUp };
}
