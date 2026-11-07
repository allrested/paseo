import { readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { parseStat, parseVmRssBytes, ProcStatParseError } from "./procfs.js";

export const AGENT_ID_ENV = "PASEO_AGENT_ID";
// Sub-project 2's contract: every process of a command the heavy-command gate runs carries this
// variable set to 1, including a command it ran after failing open; the gate's own shim does not.
export const HEAVY_GATE_ENV = "PASEO_HEAVY_GATE_HELD";

export interface ProcessInfo {
  pid: number;
  ppid: number;
  startTime: number;
  /** utime + stime in clock ticks. */
  cpuTicks: number;
  /** 0 when the process has no VmRSS line (a kernel thread or a zombie). */
  rssBytes: number;
  agentId: string | null;
  heavyGate: boolean;
  /** A heavy-command gate shim (isGateShim): the parent of a command the gate admitted. */
  gateShim: boolean;
}

export interface ProcessMarkers {
  agentId: string | null;
  heavyGate: boolean;
}

interface ParsedStat {
  ppid: number;
  startTime: number;
  cpuTicks: number;
}

const PID_ENTRY = /^\d+$/;
const NO_MARKERS: ProcessMarkers = { agentId: null, heavyGate: false };
const AGENT_PREFIX = `${AGENT_ID_ENV}=`;
const HEAVY_GATE_ENTRY = `${HEAVY_GATE_ENV}=1`;
// packages/server/scripts/supervisor-entrypoint.ts sets process.title to this. /proc/<pid>/
// cmdline then holds the title followed by NULs.
const SUPERVISOR_TITLE = "Paseo Supervisor";

// Fields 14 (utime) and 15 (stime), counted from the last ")" as parseStat does.
export function parseCpuTicks(stat: string): number {
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const ticks = Number(fields[11]) + Number(fields[12]);
  if (!Number.isSafeInteger(ticks)) throw new ProcStatParseError(stat);
  return ticks;
}

// environ is NUL-separated KEY=VALUE pairs and holds secrets. Only the two markers leave this
// function; no other name or value is kept.
export function parseMarkers(environ: string): ProcessMarkers {
  let agentId: string | null = null;
  let heavyGate = false;
  for (const entry of environ.split("\0")) {
    if (entry.startsWith(AGENT_PREFIX)) agentId = entry.slice(AGENT_PREFIX.length) || null;
    else if (entry === HEAVY_GATE_ENTRY) heavyGate = true;
  }
  return { agentId, heavyGate };
}

// A gate shim runs as `<node> <gate bin dir>/<command>` through its #! line, so its argv[1] lies
// in the gate's bin directory. A cmdline can hold secrets: only this yes or no leaves it.
export function isGateShim(cmdline: string, gateBinDir: string): boolean {
  const script = cmdline.split("\0")[1];
  return script !== undefined && isAbsolute(script) && dirname(normalize(script)) === gateBinDir;
}

// Any read error means the same here: the process is gone, or it is another user's and its
// environ is not readable.
function readOrNull(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function parseStatLine(stat: string): ParsedStat | null {
  try {
    const { ppid, startTime } = parseStat(stat);
    return { ppid, startTime, cpuTicks: parseCpuTicks(stat) };
  } catch {
    return null;
  }
}

function readProcess(procRoot: string, pid: number, gateBinDir: string): ProcessInfo | null {
  const dir = join(procRoot, String(pid));
  const stat = readOrNull(join(dir, "stat"));
  const parsed = stat === null ? null : parseStatLine(stat);
  if (parsed === null) return null;
  const status = readOrNull(join(dir, "status"));
  const environ = readOrNull(join(dir, "environ"));
  const cmdline = readOrNull(join(dir, "cmdline"));
  const markers = environ === null ? NO_MARKERS : parseMarkers(environ);
  return {
    pid,
    ppid: parsed.ppid,
    startTime: parsed.startTime,
    cpuTicks: parsed.cpuTicks,
    rssBytes: (status === null ? null : parseVmRssBytes(status)) ?? 0,
    agentId: markers.agentId,
    heavyGate: markers.heavyGate,
    gateShim: cmdline !== null && isGateShim(cmdline, gateBinDir),
  };
}

// Synchronous, like walkProcessTree: one /proc pass reads about 100 processes in a few ms, and a
// pass that yields between processes would see a tree that changed under it.
export function readProcessTable(procRoot: string, gateBinDir: string): ProcessInfo[] {
  let names: string[];
  try {
    names = readdirSync(procRoot);
  } catch {
    return [];
  }
  const table: ProcessInfo[] = [];
  for (const name of names) {
    if (!PID_ENTRY.test(name)) continue;
    const info = readProcess(procRoot, Number(name), gateBinDir);
    if (info !== null) table.push(info);
  }
  return table;
}

// The daemon worker's parent, when that parent is the supervisor. A daemon started without one has
// none, and then only the worker counts as the daemon.
export function findSupervisorPid(daemonPid: number, procRoot: string): number | null {
  const stat = readOrNull(join(procRoot, String(daemonPid), "stat"));
  const parsed = stat === null ? null : parseStatLine(stat);
  if (parsed === null) return null;
  const cmdline = readOrNull(join(procRoot, String(parsed.ppid), "cmdline"));
  return cmdline?.split("\0")[0] === SUPERVISOR_TITLE ? parsed.ppid : null;
}
