// What the office reads from Linux /proc: the processes agents started, the TCP ports they listen
// on, and the host's memory and CPU. The resource-manager built-in reads more of the same for its
// own screen; a built-in cannot import another built-in's files, and the office needs this much.
import { readdir, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";

/** A process that carries an agent's id in its environment, as every child of an agent does. */
export interface AgentProcess {
  pid: number;
  /** Clock ticks after boot; with the pid it names one process, since a pid is used again. */
  startTime: number;
  ppid: number;
  agentId: string;
  /** The kernel's short name of the program ("node", "python3"), never its arguments. */
  name: string;
  rssBytes: number;
}

export interface MemoryReading {
  usedBytes: number;
  totalBytes: number;
}

/** Jiffies since boot, summed over every core. */
export interface CpuTimes {
  busy: number;
  total: number;
}

const AGENT_ID_KEY = "PASEO_AGENT_ID=";
const PID_ENTRY = /^\d+$/;
const VM_RSS_LINE = /^VmRSS:\s+(\d+) kB$/m;
const SOCKET_LINK = /^socket:\[(\d+)\]$/;
const LISTENING = "0A";
const HEX = /^[0-9A-Fa-f]+$/;

/** Any read error means the same here: the process ended, it is another user's, or no /proc. */
async function read(path: string): Promise<string | null> {
  return readFile(path, "utf8").catch(() => null);
}

/** The agent id in a /proc/<pid>/environ text; null when the process has none. */
export function parseAgentId(environ: string): string | null {
  for (const entry of environ.split("\0")) {
    if (entry.startsWith(AGENT_ID_KEY)) return entry.slice(AGENT_ID_KEY.length) || null;
  }
  return null;
}

/**
 * A /proc/<pid>/stat line. The name is in parentheses and may itself hold spaces and
 * parentheses, so the fields after it are counted from the last ")": state, ppid, and at
 * position 22 of the line the start time.
 */
export function parseStat(stat: string): { name: string; ppid: number; startTime: number } | null {
  const open = stat.indexOf("(");
  const close = stat.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  const fields = stat.slice(close + 2).split(" ");
  const ppid = Number(fields[1]);
  const startTime = Number(fields[19]);
  if (!Number.isSafeInteger(ppid) || !Number.isSafeInteger(startTime)) return null;
  return { name: stat.slice(open + 1, close), ppid, startTime };
}

/** Resident memory from a /proc/<pid>/status text. A zombie or a kernel thread has none. */
export function parseRssBytes(status: string): number {
  const match = VM_RSS_LINE.exec(status);
  return match ? Number(match[1]) * 1024 : 0;
}

async function readProcess(procRoot: string, pid: number): Promise<AgentProcess | null> {
  const dir = join(procRoot, String(pid));
  const environ = await read(join(dir, "environ"));
  const agentId = environ === null ? null : parseAgentId(environ);
  if (agentId === null) return null;
  const stat = await read(join(dir, "stat"));
  const parsed = stat === null ? null : parseStat(stat);
  if (parsed === null) return null;
  const status = await read(join(dir, "status"));
  return { pid, agentId, ...parsed, rssBytes: status === null ? 0 : parseRssBytes(status) };
}

/** Every readable process an agent started, lowest pid first. Empty without a /proc. */
export async function readAgentProcesses(procRoot: string): Promise<AgentProcess[]> {
  const names = await readdir(procRoot).catch((): string[] => []);
  const pids = names
    .filter((name) => PID_ENTRY.test(name))
    .map(Number)
    .toSorted((a, b) => a - b);
  const processes: AgentProcess[] = [];
  for (const pid of pids) {
    const process = await readProcess(procRoot, pid);
    if (process !== null) processes.push(process);
  }
  return processes;
}

/**
 * The listening sockets of a /proc/net/tcp or tcp6 text. A row is "sl local_address rem_address
 * st ... inode ...": the local address is field 2, the state field 4 and the inode field 10.
 */
export function parseListening(text: string): { port: number; inode: number }[] {
  const sockets: { port: number; inode: number }[] = [];
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/);
    const local = fields[1];
    if (fields.length < 10 || local === undefined || fields[3] !== LISTENING) continue;
    const portText = local.slice(local.lastIndexOf(":") + 1);
    const inode = Number(fields[9]);
    if (!HEX.test(portText) || !Number.isSafeInteger(inode)) continue;
    sockets.push({ port: Number.parseInt(portText, 16), inode });
  }
  return sockets;
}

async function heldInodes(procRoot: string, pid: number): Promise<number[]> {
  const dir = join(procRoot, String(pid), "fd");
  const names = await readdir(dir).catch((): string[] => []);
  const inodes: number[] = [];
  for (const name of names) {
    const link = await readlink(join(dir, name)).catch((): null => null);
    const match = link === null ? null : SOCKET_LINK.exec(link);
    if (match) inodes.push(Number(match[1]));
  }
  return inodes;
}

/**
 * The TCP ports each of the given processes listens on, lowest first. The processes are asked in
 * the order given, so a socket a parent shares with its workers goes to the parent when the
 * parent comes first. A process that listens on nothing has no entry.
 */
export async function readListeners(
  procRoot: string,
  pids: readonly number[],
): Promise<Map<number, number[]>> {
  const texts = await Promise.all(["tcp", "tcp6"].map((name) => read(join(procRoot, "net", name))));
  const portOf = new Map<number, number>();
  for (const text of texts) {
    for (const socket of text === null ? [] : parseListening(text)) {
      portOf.set(socket.inode, socket.port);
    }
  }
  const listeners = new Map<number, number[]>();
  if (portOf.size === 0) return listeners;
  const taken = new Set<number>();
  for (const pid of pids) {
    const ports = new Set<number>();
    for (const inode of await heldInodes(procRoot, pid)) {
      const port = portOf.get(inode);
      if (port === undefined || taken.has(inode)) continue;
      taken.add(inode);
      ports.add(port);
    }
    if (ports.size > 0)
      listeners.set(
        pid,
        [...ports].toSorted((a, b) => a - b),
      );
  }
  return listeners;
}

function kilobytes(text: string, key: string): number | null {
  const match = new RegExp(`^${key}:\\s+(\\d+) kB$`, "m").exec(text);
  return match ? Number(match[1]) * 1024 : null;
}

/** Used and total memory from a /proc/meminfo text. */
export function parseMeminfo(meminfo: string): MemoryReading | null {
  const total = kilobytes(meminfo, "MemTotal");
  const available = kilobytes(meminfo, "MemAvailable");
  if (total === null || available === null || total <= 0) return null;
  return { usedBytes: Math.max(0, total - available), totalBytes: total };
}

/**
 * The memory this daemon can use: its cgroup's when cgroup v2 caps it (a container), else the
 * host's. Null where neither can be read.
 */
export async function readMemory(
  procRoot: string,
  cgroupRoot: string,
): Promise<MemoryReading | null> {
  const [limit, current] = await Promise.all([
    read(join(cgroupRoot, "memory.max")),
    read(join(cgroupRoot, "memory.current")),
  ]);
  const totalBytes = Number(limit?.trim());
  const usedBytes = Number(current?.trim());
  if (limit !== null && current !== null && totalBytes > 0 && Number.isFinite(usedBytes)) {
    return { usedBytes, totalBytes };
  }
  const meminfo = await read(join(procRoot, "meminfo"));
  return meminfo === null ? null : parseMeminfo(meminfo);
}

/** The first line of a /proc/stat text: "cpu user nice system idle iowait irq softirq steal". */
export function parseCpuTimes(stat: string): CpuTimes | null {
  const line = stat.split("\n", 1)[0] ?? "";
  if (!line.startsWith("cpu ")) return null;
  const times = line.trim().split(/\s+/).slice(1, 9).map(Number);
  if (times.length < 5 || times.some((time) => !Number.isFinite(time))) return null;
  const total = times.reduce((sum, time) => sum + time, 0);
  return { busy: total - (times[3] ?? 0) - (times[4] ?? 0), total };
}

export async function readCpuTimes(procRoot: string): Promise<CpuTimes | null> {
  const stat = await read(join(procRoot, "stat"));
  return stat === null ? null : parseCpuTimes(stat);
}

/** How busy the cores were between two readings, 0 to 100; null without both. */
export function cpuPercent(before: CpuTimes | null, now: CpuTimes | null): number | null {
  if (before === null || now === null || now.total <= before.total) return null;
  const share = (now.busy - before.busy) / (now.total - before.total);
  return Math.round(Math.min(1, Math.max(0, share)) * 100);
}

/** The pid and every ancestor of it, by the ppid links. */
export async function readAncestors(procRoot: string, pid: number): Promise<Set<number>> {
  const line = new Set<number>();
  let current = pid;
  while (current > 0 && !line.has(current)) {
    line.add(current);
    const stat = await read(join(procRoot, String(current), "stat"));
    const parsed = stat === null ? null : parseStat(stat);
    if (parsed === null) break;
    current = parsed.ppid;
  }
  return line;
}

/** The start time of a pid now; null when it is gone. */
export async function readStartTime(procRoot: string, pid: number): Promise<number | null> {
  const stat = await read(join(procRoot, String(pid), "stat"));
  return (stat === null ? null : parseStat(stat))?.startTime ?? null;
}
