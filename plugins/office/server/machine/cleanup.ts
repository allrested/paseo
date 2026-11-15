import type { CleanupResult } from "../../shared/contracts.js";
import { errorMessage } from "../errors.js";
import { readAgentProcesses, readAncestors, readStartTime } from "./proc.js";

/** How long a closed runtime's processes get to end before what is left is stopped. */
export const RUNTIME_EXIT_WAIT_MS = 500;
export const RUNTIME_EXIT_CHECKS = 6;

export interface CleanupAgent {
  status: string;
  /** Whether a closed runtime can be resumed by the next prompt. */
  resumable: boolean;
}

export interface CleanupPorts {
  procRoot: string;
  /** The daemon's own pid: it and its ancestors are never signalled. */
  selfPid: number;
  /** Null when this daemon does not know the id. */
  agent(agentId: string): Promise<CleanupAgent | null>;
  closeRuntime(agentId: string): Promise<void>;
  /** Asks a process to end (SIGTERM). */
  stop(pid: number): void;
  sleep(ms: number): Promise<void>;
}

async function leftovers(ports: CleanupPorts, agentId: string) {
  const protectedPids = await readAncestors(ports.procRoot, ports.selfPid);
  const processes = await readAgentProcesses(ports.procRoot);
  return processes.filter(
    (process) => process.agentId === agentId && !protectedPids.has(process.pid),
  );
}

/** Asks each process the agent left to end, unless its pid now names another process. */
async function stopLeftovers(ports: CleanupPorts, agentId: string): Promise<void> {
  for (const process of await leftovers(ports, agentId)) {
    if ((await readStartTime(ports.procRoot, process.pid)) !== process.startTime) continue;
    try {
      ports.stop(process.pid);
    } catch {
      // It ended on its own, which is what was asked.
    }
  }
}

async function waitForExit(ports: CleanupPorts, agentId: string): Promise<void> {
  for (let check = 0; check < RUNTIME_EXIT_CHECKS; check += 1) {
    if ((await leftovers(ports, agentId)).length === 0) return;
    await ports.sleep(RUNTIME_EXIT_WAIT_MS);
  }
}

/**
 * Frees what one agent holds. An idle agent's runtime is closed through Paseo, so its provider
 * and its tools end together and the next prompt resumes them; whatever outlives that, and
 * whatever an already closed agent left, is asked to end. An agent at work is left alone, and so
 * is an id this daemon does not know: its processes may be another daemon's.
 */
export async function cleanUpAgent(ports: CleanupPorts, agentId: string): Promise<CleanupResult> {
  const fail = (error: string): CleanupResult => ({ agentId, ok: false, error });
  try {
    const agent = await ports.agent(agentId);
    if (agent === null) return fail("This host does not know the agent");
    if (agent.status === "idle") {
      if (!agent.resumable) {
        return fail("This agent has no saved session to resume, so it stays open");
      }
      await ports.closeRuntime(agentId);
      await waitForExit(ports, agentId);
    } else if (agent.status !== "closed") {
      return fail("The agent is not idle; clean up once its turn has ended");
    }
    await stopLeftovers(ports, agentId);
    return { agentId, ok: true, error: null };
  } catch (error) {
    return fail(errorMessage(error));
  }
}
