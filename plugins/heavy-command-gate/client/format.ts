import type { GateStatus, RunningCommand, WaitingCommand } from "../shared/rpc.js";
import { GIB } from "../shared/settings.js";

interface AgentRef {
  agentId: string | null;
  agentTitle: string | null;
}

/** GB as the settings count them (2^30 bytes), one decimal: "1.5 GB". */
export function formatGb(bytes: number): string {
  return `${(Math.max(0, bytes) / GIB).toFixed(1)} GB`;
}

/** The two largest units of a duration: "42 s", "2 min 5 s", "1 h 2 min". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${seconds % 60} s`;
  return `${seconds} s`;
}

export function agentLabel(command: AgentRef): string {
  if (command.agentTitle) return command.agentTitle;
  if (command.agentId) return `Agent ${command.agentId.slice(0, 8)}`;
  return "No agent";
}

export function describeRunning(command: RunningCommand): string {
  const memory =
    command.rssBytes === null ? "memory unknown" : `${formatGb(command.rssBytes)} in use`;
  const parts = [
    agentLabel(command),
    `running ${formatDuration(command.elapsedMs)}`,
    memory,
    `estimate ${formatGb(command.estimateBytes)}`,
  ];
  if (command.forced) parts.push("started without enough free memory");
  return parts.join(", ");
}

export function describeWaiting(command: WaitingCommand): string {
  const reason = command.waitingOn === "slot" ? "for a slot" : "for memory";
  return [
    `#${command.position}`,
    agentLabel(command),
    `waiting ${formatDuration(command.waitedMs)} ${reason}`,
    `estimate ${formatGb(command.estimateBytes)}`,
  ].join(", ");
}

/** The hint under the on/off switch. */
export function describeGate(status: GateStatus): string {
  if (status.state === "unavailable") return status.error ?? "The gate is not running";
  if (status.state === "off") return "Heavy commands run at once, without waiting";
  const free =
    status.freeBytes === null ? "Free memory unknown" : `${formatGb(status.freeBytes)} free`;
  const slots = status.slots === 1 ? "1 slot" : `${status.slots} slots`;
  return `${free}, ${formatGb(status.reserveBytes)} reserve, ${slots}`;
}
