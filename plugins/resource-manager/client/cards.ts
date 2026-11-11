import type {
  AgentUsage,
  GroupUsage,
  HostSummary,
  MountUsage,
  RemoteSnapshot,
} from "../shared/rpc.js";
import {
  formatBytes,
  formatClock,
  formatDuration,
  hostRows,
  mountRow,
  processRow,
  serverRows,
  type Row,
} from "./format.js";

// What a card on the Resources screen shows: its status, its meters, its trend, and whether it is
// open. Pure, so the views only draw.

export type Level = "ok" | "warning" | "critical";
export type CardStatus = Level | "error" | "waiting";

// Each threshold is a share from 0 to 1, except load, which is the 1-minute load per core.

/** Under 20% of memory available: the kernel is reclaiming page cache to keep up. */
export const MEMORY_WARNING = 0.8;
/** Under 10% available: one large allocation away from the OOM killer. */
export const MEMORY_CRITICAL = 0.9;
/** Load at the core count: every core is busy and the next task waits. */
export const LOAD_WARNING = 1;
/** Load at twice the core count: every running task has another queued behind it. */
export const LOAD_CRITICAL = 2;
/** A disk at 85% leaves little room for a log burst or an image pull. */
export const DISK_WARNING = 0.85;
/** ext4 keeps the last 5% for root, so above 95% other users' writes fail. */
export const DISK_CRITICAL = 0.95;

const NOT_AVAILABLE = "Not available";
const LEVEL_RANK: Record<Level, number> = { ok: 0, warning: 1, critical: 2 };
/** Worst first: a host that cannot be read ranks over one that is merely full. */
const STATUS_RANK: Record<CardStatus, number> = {
  error: 0,
  critical: 1,
  warning: 2,
  waiting: 3,
  ok: 4,
};
const STATUS_LABELS: Record<CardStatus, string> = {
  ok: "OK",
  warning: "Warning",
  critical: "Critical",
  error: "Error",
  waiting: "Waiting",
};

export function levelOf(value: number | null, warning: number, critical: number): Level {
  if (value === null) return "ok";
  if (value >= critical) return "critical";
  return value >= warning ? "warning" : "ok";
}

export interface Meter {
  key: string;
  label: string;
  value: string;
  /** How much of the bar is filled, 0 to 1. Null draws no bar. */
  fraction: number | null;
  level: Level;
}

interface JudgedMeter {
  meter: Meter;
  /** Names the meter in the card's note when its level is not ok. */
  reason: string;
}

export interface CardSummary {
  status: CardStatus;
  /** The status in words, so colour is never the only signal. */
  label: string;
  /** The error, or the meters over a threshold. Null when there is nothing to say. */
  note: string | null;
  meters: Meter[];
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function cores(count: number): string {
  return `${count} ${count === 1 ? "core" : "cores"}`;
}

function plainMeter(key: string, label: string, value: string): JudgedMeter {
  return { meter: { key, label, value, fraction: null, level: "ok" }, reason: "" };
}

function memoryMeter(
  key: string,
  label: string,
  used: number | null,
  total: number | null,
): JudgedMeter {
  if (used === null) return plainMeter(key, label, NOT_AVAILABLE);
  if (total === null || total <= 0) return plainMeter(key, label, `${formatBytes(used)}, no cap`);
  const fraction = used / total;
  return {
    meter: {
      key,
      label,
      value: `${percent(fraction)} · ${formatBytes(used)}`,
      fraction: Math.min(1, fraction),
      level: levelOf(fraction, MEMORY_WARNING, MEMORY_CRITICAL),
    },
    reason: `${label} ${percent(fraction)}`,
  };
}

function loadMeter(load1: number | null, coreCount: number): JudgedMeter {
  if (load1 === null) return plainMeter("load", "Load", NOT_AVAILABLE);
  const perCore = load1 / coreCount;
  return {
    meter: {
      key: "load",
      label: "Load",
      // Load is a count of tasks that run or wait for a core, so it passes the core count on a
      // busy host. The percentage says so; "2.43 / 2 cores" read as a part of a whole.
      value: `${percent(perCore)} · ${load1.toFixed(2)} on ${cores(coreCount)}`,
      fraction: Math.min(1, perCore),
      level: levelOf(perCore, LOAD_WARNING, LOAD_CRITICAL),
    },
    reason: `Load ${percent(perCore)} of ${cores(coreCount)}`,
  };
}

/** The fullest disk stands for all of them; the others are in the details. */
function diskMeter(mounts: readonly MountUsage[]): JudgedMeter {
  let fullest: MountUsage | null = null;
  let fullestShare = -1;
  for (const mount of mounts) {
    if (mount.totalBytes <= 0) continue;
    const share = mount.usedBytes / mount.totalBytes;
    if (share > fullestShare) {
      fullest = mount;
      fullestShare = share;
    }
  }
  if (fullest === null) return plainMeter("disk", "Disk", "No disks");
  return {
    meter: {
      key: "disk",
      label: "Disk",
      value: `${percent(fullestShare)} · ${fullest.mount}`,
      fraction: Math.min(1, fullestShare),
      level: levelOf(fullestShare, DISK_WARNING, DISK_CRITICAL),
    },
    reason: `Disk ${fullest.mount} ${percent(fullestShare)}`,
  };
}

function sentence(reasons: string[]): string {
  return reasons
    .map((reason, index) =>
      index === 0 ? reason : `${reason.charAt(0).toLowerCase()}${reason.slice(1)}`,
    )
    .join(", ");
}

function summarize(judged: JudgedMeter[], error: string | null): CardSummary {
  const meters = judged.map((entry) => entry.meter);
  if (error !== null) return { status: "error", label: STATUS_LABELS.error, note: error, meters };
  if (judged.length === 0) {
    return { status: "waiting", label: STATUS_LABELS.waiting, note: null, meters };
  }
  let status: Level = "ok";
  for (const meter of meters) {
    if (LEVEL_RANK[meter.level] > LEVEL_RANK[status]) status = meter.level;
  }
  const over = judged.filter((entry) => entry.meter.level !== "ok").map((entry) => entry.reason);
  return {
    status,
    label: STATUS_LABELS[status],
    note: over.length === 0 ? null : sentence(over),
    meters,
  };
}

/** A host's card. An error stands over the last reading, whose meters stay. */
export function snapshotSummary(
  snapshot: RemoteSnapshot | null,
  error: string | null,
): CardSummary {
  if (snapshot === null) return summarize([], error);
  return summarize(
    [
      memoryMeter(
        "memory",
        "Memory",
        snapshot.memTotalBytes - snapshot.memAvailableBytes,
        snapshot.memTotalBytes,
      ),
      loadMeter(snapshot.load1, snapshot.cores),
      diskMeter(snapshot.mounts),
    ],
    error,
  );
}

function hostMemoryUsed(host: HostSummary): number | null {
  if (host.hostAvailableBytes === null || host.hostTotalBytes === null) return null;
  return host.hostTotalBytes - host.hostAvailableBytes;
}

/** This instance's card: the container against its cap, load, and the host's memory. */
export function instanceSummary(host: HostSummary, error: string | null): CardSummary {
  return summarize(
    [
      memoryMeter("memory", "Memory", host.memoryUsedBytes, host.memoryLimitBytes),
      loadMeter(host.load1, host.cores),
      memoryMeter("hostMemory", "Host memory", hostMemoryUsed(host), host.hostTotalBytes),
    ],
    error,
  );
}

/** A stable sort, so cards with the same status keep the order the server gave them. */
export function sortWorstFirst<Item>(
  items: readonly Item[],
  statusOf: (item: Item) => CardStatus,
): Item[] {
  return items
    .map((item, index) => ({ item, index, rank: STATUS_RANK[statusOf(item)] }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.item);
}

/** The line above the cards. */
export function overviewText(statuses: readonly CardStatus[]): string {
  const hosts = statuses.length === 1 ? "1 host" : `${statuses.length} hosts`;
  const attention = statuses.filter(
    (status) => status === "error" || status === "critical" || status === "warning",
  ).length;
  if (attention > 0)
    return `${hosts}, ${attention} ${attention === 1 ? "needs" : "need"} attention`;
  const waiting = statuses.filter((status) => status === "waiting").length;
  return waiting > 0 ? `${hosts}, ${waiting} waiting` : `${hosts}, all OK`;
}

// --- Trend: the readings this screen has received since it opened. Nothing is stored.

export interface TrendPoint {
  /** The reading's own time, which tells a new reading from a repeat. */
  at: string;
  /** Memory in use, 0 to 1. */
  memory: number | null;
  /** The 1-minute load. */
  load: number | null;
}

export interface TrendSample extends Omit<TrendPoint, "at"> {
  key: string;
  at: string | null;
}

export type TrendHistory = ReadonlyMap<string, readonly TrendPoint[]>;

/** 15 minutes of a server's 30 s readings; 2.5 minutes of this instance's 5 s ones. */
export const TREND_CAPACITY = 30;
export const EMPTY_TREND: TrendHistory = new Map();
const NO_POINTS: readonly TrendPoint[] = [];

/** Adds each reading the history does not have yet. Returns the same history when none is new. */
export function recordTrend(history: TrendHistory, samples: readonly TrendSample[]): TrendHistory {
  let next: Map<string, readonly TrendPoint[]> | null = null;
  for (const sample of samples) {
    if (sample.at === null) continue;
    const points = (next ?? history).get(sample.key) ?? NO_POINTS;
    if (points.length > 0 && points[points.length - 1].at === sample.at) continue;
    next ??= new Map(history);
    const point: TrendPoint = { at: sample.at, memory: sample.memory, load: sample.load };
    next.set(sample.key, [...points, point].slice(-TREND_CAPACITY));
  }
  return next ?? history;
}

export function snapshotSample(
  key: string,
  snapshot: RemoteSnapshot | null,
  readAt: string | null,
): TrendSample {
  if (snapshot === null || readAt === null) return { key, at: null, memory: null, load: null };
  const memory =
    snapshot.memTotalBytes > 0
      ? (snapshot.memTotalBytes - snapshot.memAvailableBytes) / snapshot.memTotalBytes
      : null;
  return { key, at: readAt, memory, load: snapshot.load1 };
}

function shareOf(used: number | null, total: number | null): number | null {
  return used === null || total === null || total <= 0 ? null : used / total;
}

/** The container's share of its cap; without a cap, the host's memory in use. */
export function instanceSample(key: string, host: HostSummary, readAt: string): TrendSample {
  const memory =
    shareOf(host.memoryUsedBytes, host.memoryLimitBytes) ??
    shareOf(hostMemoryUsed(host), host.hostTotalBytes);
  return { key, at: readAt, memory, load: host.load1 };
}

export interface TrendBar {
  /** The reading's time: the bar's identity. */
  at: string;
  /** 0 to 1 of the drawn height. */
  height: number;
}

export interface TrendLine {
  key: string;
  label: string;
  /** One bar per reading, oldest first. */
  bars: TrendBar[];
  /** The lowest and highest reading in words, so the bars are not the only signal. */
  range: string;
}

interface Measured {
  at: string;
  value: number;
}

function measured(
  points: readonly TrendPoint[],
  pick: (point: TrendPoint) => number | null,
): Measured[] {
  const out: Measured[] = [];
  for (const point of points) {
    const value = pick(point);
    if (value !== null) out.push({ at: point.at, value });
  }
  return out;
}

function trendLine(
  key: string,
  label: string,
  readings: Measured[],
  ceiling: number,
  format: (value: number) => string,
): TrendLine {
  const values = readings.map((reading) => reading.value);
  const low = format(Math.min(...values));
  const high = format(Math.max(...values));
  return {
    key,
    label,
    bars: readings.map(({ at, value }) => ({
      at,
      height: Math.min(1, Math.max(0, value / ceiling)),
    })),
    range: low === high ? `steady at ${low}` : `${low} to ${high}`,
  };
}

/** Nothing from fewer than two readings: one bar is not a trend. */
export function trendLines(points: readonly TrendPoint[], coreCount: number): TrendLine[] {
  const lines: TrendLine[] = [];
  const memory = measured(points, (point) => point.memory);
  if (memory.length >= 2) lines.push(trendLine("memory", "Memory", memory, 1, percent));
  const load = measured(points, (point) => point.load);
  if (load.length >= 2) {
    // Against the core count, so a quiet host draws low bars; a peak above it sets the scale.
    const ceiling = Math.max(coreCount, ...load.map((reading) => reading.value));
    lines.push(trendLine("load", "Load", load, ceiling, (value) => value.toFixed(2)));
  }
  return lines;
}

// --- Which cards are open. Every card starts closed.

export type OpenSet = ReadonlySet<string>;
export const EMPTY_OPEN: OpenSet = new Set();

export function toggleOpen(open: OpenSet, key: string): OpenSet {
  const next = new Set(open);
  if (!next.delete(key)) next.add(key);
  return next;
}

export function setAllOpen(open: OpenSet, keys: readonly string[], value: boolean): OpenSet {
  const next = new Set(open);
  for (const key of keys) {
    if (value) next.add(key);
    else next.delete(key);
  }
  return next;
}

export function areAllOpen(open: OpenSet, keys: readonly string[]): boolean {
  return keys.length > 0 && keys.every((key) => open.has(key));
}

// --- Card text.

const JUST_NOW_MS = 5_000;

/** `now` is this device's clock and `readAt` the daemon's, so a reading "from the future" is new. */
export function formatAge(readAt: string | null, now: number): string {
  if (readAt === null) return "No reading yet";
  const age = now - Date.parse(readAt);
  if (age < JUST_NOW_MS) return "Just now";
  if (age < 60_000) return `${Math.floor(age / 1000)} s ago`;
  return `${formatDuration(age)} ago`;
}

export interface DetailBlock {
  key: string;
  title: string;
  rows: Row[];
  /** Shown in place of the rows when there are none. */
  empty: string | null;
}

function block(key: string, title: string, rows: Row[], empty: string): DetailBlock {
  return { key, title, rows, empty: rows.length === 0 ? empty : null };
}

function readAtRow(readAt: string | null): Row {
  return {
    key: "readAt",
    label: "Last reading",
    value: readAt === null ? "None yet" : formatClock(readAt),
  };
}

/** Everything an open host card lists. */
export function snapshotDetails(snapshot: RemoteSnapshot, readAt: string | null): DetailBlock[] {
  return [
    block("usage", "Usage", [...serverRows(snapshot), readAtRow(readAt)], ""),
    block("disks", "Disks", snapshot.mounts.map(mountRow), "No disks reported"),
    block(
      "processes",
      "Top processes",
      snapshot.processes.map(processRow),
      "No processes reported",
    ),
  ];
}

export function instanceDetails(host: HostSummary, readAt: string): DetailBlock[] {
  return [block("usage", "Usage", [...hostRows(host), readAtRow(readAt)], "")];
}

function totalRss(items: readonly { rssBytes: number }[]): string {
  return formatBytes(items.reduce((sum, item) => sum + item.rssBytes, 0));
}

export function agentsSummary(agents: readonly AgentUsage[]): string {
  if (agents.length === 0) return "No agent processes";
  const idle = agents.filter((agent) => agent.status === "idle").length;
  const count = agents.length === 1 ? "1 agent" : `${agents.length} agents`;
  return `${count}, ${idle} idle, ${totalRss(agents)}`;
}

export function groupsSummary(groups: readonly GroupUsage[]): string {
  const processes = groups.reduce((sum, group) => sum + group.processCount, 0);
  return `${processes === 1 ? "1 process" : `${processes} processes`}, ${totalRss(groups)}`;
}
