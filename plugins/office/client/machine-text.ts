import type { Machine, MachineAgent, OfficeAgent } from "../shared/contracts.js";

// Written as the Resources screen writes them (plugins/resource-manager/client/format.ts), so a
// number reads the same in both places; a built-in cannot import another built-in's files.
const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  return `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ${UNITS[unit]}`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

export function machineTitle(agent: Pick<MachineAgent, "agentId" | "title">): string {
  const title = agent.title?.trim();
  return title ? title : `Agent ${agent.agentId.slice(0, 8)}`;
}

/**
 * The reading with each agent the office numbered under its office name (Mjd-1, not its task), so
 * the host's card and the server racks name it as the floor does. The same reading when none is.
 */
export function namedMachine(
  machine: Machine | null,
  agents: ReadonlyMap<string, Pick<OfficeAgent, "name">>,
): Machine | null {
  if (machine === null) return null;
  const named = (agentId: string) => agents.get(agentId)?.name;
  if (!machine.agents.some((agent) => named(agent.agentId) !== undefined)) return machine;
  return {
    ...machine,
    agents: machine.agents.map((agent) => {
      const name = named(agent.agentId);
      return name === undefined ? agent : { ...agent, title: name };
    }),
  };
}

/** Memory in use as a whole percent; null without a reading. */
export function memoryPercent(machine: Machine): number | null {
  const { memory } = machine;
  if (memory === null || memory.totalBytes <= 0) return null;
  return Math.round((memory.usedBytes / memory.totalBytes) * 100);
}

function count(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

function portsText(ports: readonly number[]): string | null {
  if (ports.length === 0) return null;
  return ports.length === 1 ? `port ${ports[0]}` : `ports ${ports.join(", ")}`;
}

function stateText(agent: MachineAgent, now: number): string {
  if (agent.status === "closed") return "Closed";
  if (agent.status === "initializing") return "Starting";
  if (agent.status === "error") return "Stopped with an error";
  if (agent.status === "running") return "Running";
  if (agent.idleSince === null) return "Idle";
  return `Idle for ${formatDuration(Math.max(0, now - Date.parse(agent.idleSince)))}`;
}

/**
 * What an agent holds, in one line under its name. `now` is the reading's own time, so the idle
 * time does not depend on this device's clock.
 */
export function agentLine(agent: MachineAgent, now: number): string {
  const parts = [stateText(agent, now), count(agent.processCount, "process", "processes")];
  const ports = portsText(agent.ports);
  if (ports !== null) parts.push(ports);
  return parts.join(" · ");
}

/** The row's name for a screen reader: everything the row shows, as one sentence. */
export function agentRowLabel(agent: MachineAgent, now: number): string {
  return `${machineTitle(agent)}: ${formatBytes(agent.rssBytes)}, ${agentLine(agent, now)}`;
}

export type HostTone = "muted" | "warning" | "danger";

export interface HostNote {
  text: string;
  tone: HostTone;
}

// As the Resources screen: a warning at 80% of memory, critical at 90%.
const MEMORY_WARNING = 80;
const MEMORY_CRITICAL = 90;

export function memoryTone(percent: number | null): HostTone {
  if (percent === null || percent < MEMORY_WARNING) return "muted";
  return percent >= MEMORY_CRITICAL ? "danger" : "warning";
}

/** The host in a few words, for the header: what was left running comes before the memory. */
export function hostNote(machine: Machine): HostNote {
  const left = machine.agents.filter((agent) => agent.forgotten).length;
  const percent = memoryPercent(machine);
  if (left > 0) {
    const tone = memoryTone(percent) === "danger" ? "danger" : "warning";
    return { text: `${count(left, "agent", "agents")} left something running`, tone };
  }
  if (percent === null) return { text: "Memory not read", tone: "muted" };
  return { text: `Memory ${percent}%`, tone: memoryTone(percent) };
}

export function memoryText(machine: Machine): string {
  const { memory } = machine;
  if (memory === null) return "Not read on this host";
  return `${formatBytes(memory.usedBytes)} of ${formatBytes(memory.totalBytes)}`;
}

/** Local wall-clock time, HH:MM:SS. */
export function readAtText(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export interface CleanupOutcome {
  agentId: string;
  ok: boolean;
  error: string | null;
}

/**
 * Null when everything was cleaned up; else what to say under the button. One agent's reason
 * goes under its own button, which names the action before it. For several the sentence is
 * whole, and starts as the button's failures do so that it is shown as it is.
 */
export function cleanupFailure(results: readonly CleanupOutcome[]): string | null {
  const failed = results.filter((result) => !result.ok);
  const first = failed[0];
  if (first === undefined) return null;
  const reason = first.error ?? "no reason given";
  if (results.length === 1) return reason;
  return `Unable to clean up ${failed.length} of ${results.length}. The first reason: ${reason}`;
}
