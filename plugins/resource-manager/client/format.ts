import type {
  AgentUsage,
  GroupKind,
  GroupUsage,
  HostReading,
  HostSummary,
  LiveStatus,
  MountUsage,
  RemoteProcess,
  RemoteSnapshot,
  ServerReading,
} from "../shared/rpc.js";

// Row text for the Resources screen. docs/design.md section 10: sentence case, no trailing period.

export interface Row {
  key: string;
  label: string;
  value: string;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];
const NOT_AVAILABLE = "Not available";

const GROUP_LABELS: Record<GroupKind, string> = {
  daemon: "Paseo daemon",
  sharedMcp: "Shared MCP servers",
  heavyGate: "Heavy commands",
  other: "Everything else",
};

const STATE_LABELS: Record<LiveStatus, string> = {
  initializing: "starting",
  idle: "idle",
  running: "running",
  error: "stopped with an error",
};

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  const shown = value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${shown} ${UNITS[unit]}`;
}

export function formatShare(used: number, total: number): string {
  if (total <= 0) return formatBytes(used);
  return `${formatBytes(used)} of ${formatBytes(total)} (${Math.round((used / total) * 100)}%)`;
}

export function formatCpu(percent: number | null): string {
  return percent === null ? "CPU unknown" : `${percent.toFixed(1)}% CPU`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local wall-clock time, HH:MM:SS. */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatLoad(load1: number, load5: number, load15: number, cores: number): string {
  const loads = [load1, load5, load15].map((load) => load.toFixed(2)).join(", ");
  return `${loads} on ${cores} ${cores === 1 ? "core" : "cores"}`;
}

export function groupLabel(kind: GroupKind): string {
  return GROUP_LABELS[kind];
}

export function agentLabel(agent: AgentUsage): string {
  return agent.title ?? "Untitled agent";
}

function processCount(count: number): string {
  return count === 1 ? "1 process" : `${count} processes`;
}

function agentState(agent: AgentUsage, now: number): string {
  if (agent.status !== "idle" || agent.idleSince === null) return STATE_LABELS[agent.status];
  return `idle for ${formatDuration(Math.max(0, now - Date.parse(agent.idleSince)))}`;
}

/** `now` is the reading's own time, so the idle time does not depend on this device's clock. */
export function describeAgent(agent: AgentUsage, now: number): string {
  return [
    agent.provider,
    processCount(agent.processCount),
    formatBytes(agent.rssBytes),
    formatCpu(agent.cpuPercent),
    agentState(agent, now),
  ].join(", ");
}

export function describeGroup(group: GroupUsage): string {
  return [
    processCount(group.processCount),
    formatBytes(group.rssBytes),
    formatCpu(group.cpuPercent),
  ].join(", ");
}

function containerMemory(host: HostSummary): string {
  if (host.memoryUsedBytes === null) return NOT_AVAILABLE;
  if (host.memoryLimitBytes === null) return `${formatBytes(host.memoryUsedBytes)} used, no cap`;
  return formatShare(host.memoryUsedBytes, host.memoryLimitBytes);
}

function swap(used: number | null, total: number | null): string {
  if (total === 0) return "No swap";
  if (used === null || total === null) return NOT_AVAILABLE;
  return formatShare(used, total);
}

function hostAvailable(host: HostSummary): string {
  if (host.hostAvailableBytes === null || host.hostTotalBytes === null) return NOT_AVAILABLE;
  return `${formatBytes(host.hostAvailableBytes)} of ${formatBytes(host.hostTotalBytes)}`;
}

function hostLoad(host: HostSummary): string {
  if (host.load1 === null || host.load5 === null || host.load15 === null) return NOT_AVAILABLE;
  return formatLoad(host.load1, host.load5, host.load15, host.cores);
}

export function hostRows(host: HostSummary): Row[] {
  return [
    { key: "memory", label: "Container memory", value: containerMemory(host) },
    { key: "swap", label: "Swap", value: swap(host.swapUsedBytes, host.swapTotalBytes) },
    { key: "available", label: "Available host memory", value: hostAvailable(host) },
    { key: "load", label: "Load", value: hostLoad(host) },
  ];
}

export function serverRows(snapshot: RemoteSnapshot): Row[] {
  const memoryUsed = snapshot.memTotalBytes - snapshot.memAvailableBytes;
  const swapUsed = snapshot.swapTotalBytes - snapshot.swapFreeBytes;
  return [
    { key: "memory", label: "Memory", value: formatShare(memoryUsed, snapshot.memTotalBytes) },
    { key: "swap", label: "Swap", value: swap(swapUsed, snapshot.swapTotalBytes) },
    {
      key: "load",
      label: "Load",
      value: formatLoad(snapshot.load1, snapshot.load5, snapshot.load15, snapshot.cores),
    },
  ];
}

export function mountRow(mount: MountUsage): Row {
  return {
    key: mount.mount,
    label: mount.mount,
    value: formatShare(mount.usedBytes, mount.totalBytes),
  };
}

export function processRow(entry: RemoteProcess): Row {
  return {
    key: String(entry.pid),
    label: entry.command,
    value: `${formatBytes(entry.rssBytes)}, pid ${entry.pid}`,
  };
}

export interface HostCard {
  key: string;
  name: string;
  /** The profile's user@host:port. Null for an entry with one host, which reports none. */
  address: string | null;
  snapshot: RemoteSnapshot | null;
  readAt: string | null;
  error: string | null;
}

export interface ReadingView {
  /** Shown above the cards: an entry with several hosts' own error, or a failed first request. */
  error: string | null;
  cards: HostCard[];
}

/**
 * One card per host of an ssh-mcp entry. An entry with one host gets one card under the entry's
 * name, and that card carries the entry's error.
 */
export function readingView(
  reading: ServerReading | undefined,
  requestError: string | null,
  entryName: string,
): ReadingView {
  if (reading === undefined) return { error: requestError, cards: [] };
  const error = requestError ?? reading.error;
  if (reading.hosts === undefined || reading.hosts.length === 0) {
    const card: HostCard = {
      key: "server",
      name: entryName,
      address: null,
      snapshot: reading.snapshot,
      readAt: reading.readAt,
      error,
    };
    return { error: null, cards: [card] };
  }
  const cards = reading.hosts.map(
    (host: HostReading): HostCard => ({
      key: host.profile,
      name: host.profile,
      address: host.label,
      snapshot: host.snapshot,
      readAt: host.readAt,
      error: host.error,
    }),
  );
  return { error, cards };
}
