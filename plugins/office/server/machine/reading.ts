import {
  FORGOTTEN_AFTER_MS,
  type AgentStatus,
  type Machine,
  type MachineAgent,
} from "../../shared/contracts.js";
import type { AgentProcess, MemoryReading } from "./proc.js";

/** An agent this daemon knows, in whatever state. */
export interface KnownAgent {
  id: string;
  title: string | null;
  status: AgentStatus;
  /** The agent record's last change: for an idle agent, about when its turn ended. */
  updatedAt: string | null;
}

export interface MachineInput {
  now: number;
  memory: MemoryReading | null;
  cpuPercent: number | null;
  processes: readonly AgentProcess[];
  /** The ports each process listens on, by pid. */
  listeners: ReadonlyMap<number, readonly number[]>;
  /** The agents the processes may belong to. A process of any other agent is not this host's. */
  agents: readonly KnownAgent[];
}

function forgotten(agent: KnownAgent, ports: readonly number[], now: number): boolean {
  if (agent.status === "closed") return true;
  if (agent.status !== "idle" || ports.length === 0 || agent.updatedAt === null) return false;
  const since = Date.parse(agent.updatedAt);
  return Number.isFinite(since) && now - since >= FORGOTTEN_AFTER_MS;
}

/**
 * The host as the office shows it. Only an agent with a process is listed: one whose provider
 * runs in a server shared with others holds no memory of its own that could be named.
 */
export function buildMachine(input: MachineInput): Machine {
  const agents: MachineAgent[] = [];
  for (const agent of input.agents) {
    const own = input.processes.filter((process) => process.agentId === agent.id);
    if (own.length === 0) continue;
    const ports = [...new Set(own.flatMap((process) => input.listeners.get(process.pid) ?? []))];
    ports.sort((a, b) => a - b);
    agents.push({
      agentId: agent.id,
      title: agent.title,
      status: agent.status,
      rssBytes: own.reduce((sum, process) => sum + process.rssBytes, 0),
      processCount: own.length,
      ports,
      idleSince: agent.status === "idle" ? agent.updatedAt : null,
      forgotten: forgotten(agent, ports, input.now),
    });
  }
  agents.sort(
    (a, b) =>
      Number(b.forgotten) - Number(a.forgotten) ||
      b.rssBytes - a.rssBytes ||
      a.agentId.localeCompare(b.agentId),
  );
  return {
    readAt: new Date(input.now).toISOString(),
    memory: input.memory,
    cpuPercent: input.cpuPercent,
    agents,
  };
}
