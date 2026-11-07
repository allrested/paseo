import type { MountUsage, RemoteProcess, RemoteSnapshot } from "../../shared/rpc.js";
import { parseLoadavg, parseMeminfo, ProcTextError } from "../proc-text.js";

// The only command the plugin ever sends. It takes no input, writes nothing, and has no
// redirection, pipe, separator or substitution, so ssh-mcp 2.x's policy never classes it as
// destructive. "&&" stops at the first failure, so a host without /proc answers with that
// error at once.
export const REMOTE_COMMAND =
  "echo @@meminfo && cat /proc/meminfo && echo @@loadavg && cat /proc/loadavg && " +
  "echo @@nproc && nproc && echo @@df && df -P && echo @@ps && ps -eo pid,rss,comm";

export class RemoteOutputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RemoteOutputError";
  }
}

export interface CommandOutput {
  stdout: string[];
  stderr: string[];
  /** null without an "[exit N]" line: always for 1.x, and for a 2.x run that succeeded. */
  exitCode: number | null;
  /** The signal from 2.x's "[killed by SIG<NAME>]" line, else null. */
  signal: string | null;
}

const TOP_PROCESSES = 10;
const KIB = 1024;
const SECTION_LINE = /^@@([a-z]+)$/;
const EXIT_LINE = /^\[exit (-?\d+)\]$/;
const KILLED_LINE = /^\[killed by (SIG[A-Z0-9]+)\]$/;
const STDERR_LINE = "[stderr]";
const BLOCKS_HEADER = /(?:^|\s)(\d+)-\S+/;
const PS_HEADER = /^PID\s+RSS\s+\S+$/;
const PSEUDO_FILESYSTEMS = new Set(["tmpfs", "devtmpfs", "shm", "udev", "none", "efivarfs"]);
const MESSAGE_CHARS = 300;

function nonEmpty(line: string): boolean {
  return line.trim() !== "";
}

// ssh-mcp 2.x's run-command joins stdout, "[stderr]" and its lines when there are any, and on
// failure only "[exit N]" or "[killed by SIG<NAME>]", with a blank line between the parts
// (commandOutput in ssh-mcp 2.23.1 build/tools/results.js). Markers match whole lines only.
export function splitTrailers(text: string): CommandOutput {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let target = stdout;
  let exitCode: number | null = null;
  let signal: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const exit = EXIT_LINE.exec(line);
    const killed = KILLED_LINE.exec(line);
    if (exit) exitCode = Number(exit[1]);
    if (killed) signal = killed[1];
    if (exit || killed) break;
    if (line === STDERR_LINE) target = stderr;
    else target.push(line);
  }
  return { stdout, stderr, exitCode, signal };
}

// Lines before the first marker, such as a login banner, belong to no section.
function splitSections(lines: readonly string[]): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of lines) {
    const marker = SECTION_LINE.exec(line.trim());
    if (marker) {
      current = [];
      sections.set(marker[1], current);
    } else current?.push(line);
  }
  return sections;
}

function section(sections: Map<string, string[]>, name: string): string[] {
  const lines = sections.get(name);
  if (lines === undefined) throw new RemoteOutputError(`The output has no ${name} section`);
  return lines;
}

export function parseNproc(lines: readonly string[]): number {
  const text = lines.filter(nonEmpty).join(" ").trim();
  const cores = Number(text);
  if (!Number.isSafeInteger(cores) || cores < 1) {
    throw new RemoteOutputError(`Unrecognised nproc output: ${text.slice(0, 80)}`);
  }
  return cores;
}

// df -P keeps one filesystem per line. The header's "<N>-blocks" gives the unit, with "blocks"
// translated under a non-English locale; the mount point is everything after the capacity,
// spaces included.
export function parseDf(lines: readonly string[]): MountUsage[] {
  const header = lines.find(nonEmpty) ?? "";
  const rows = lines.filter(nonEmpty).slice(1);
  const blocks = BLOCKS_HEADER.exec(header);
  if (blocks === null) {
    throw new RemoteOutputError(`Unrecognised df header: ${header.trim().slice(0, 80)}`);
  }
  const blockBytes = Number(blocks[1]);
  const mounts: MountUsage[] = [];
  for (const row of rows) {
    const fields = row.trim().split(/\s+/);
    const [filesystem, total, used, available] = fields;
    const totalBlocks = Number(total);
    const usedBlocks = Number(used);
    const availableBlocks = Number(available);
    if (fields.length < 6 || PSEUDO_FILESYSTEMS.has(filesystem)) continue;
    if (!Number.isFinite(totalBlocks) || totalBlocks <= 0) continue;
    // df prints "-" for a figure it cannot read. Such a row is skipped, never sent as NaN.
    if (!Number.isFinite(usedBlocks) || !Number.isFinite(availableBlocks)) continue;
    mounts.push({
      mount: fields.slice(5).join(" "),
      totalBytes: totalBlocks * blockBytes,
      usedBytes: usedBlocks * blockBytes,
      availableBytes: availableBlocks * blockBytes,
    });
  }
  return mounts;
}

export function parsePs(lines: readonly string[]): RemoteProcess[] {
  const header = lines.find(nonEmpty) ?? "";
  const rows = lines.filter(nonEmpty).slice(1);
  if (!PS_HEADER.test(header.trim())) {
    throw new RemoteOutputError(`Unrecognised ps header: ${header.trim().slice(0, 80)}`);
  }
  const processes: RemoteProcess[] = [];
  for (const row of rows) {
    const fields = row.trim().split(/\s+/);
    const pid = Number(fields[0]);
    const rssKb = Number(fields[1]);
    if (fields.length < 3 || !Number.isSafeInteger(pid) || !Number.isSafeInteger(rssKb)) continue;
    processes.push({ pid, rssBytes: rssKb * KIB, command: fields.slice(2).join(" ") });
  }
  processes.sort((a, b) => b.rssBytes - a.rssBytes || a.pid - b.pid);
  return processes.slice(0, TOP_PROCESSES);
}

function failureMessage(output: CommandOutput): string {
  const message = output.stderr.filter(nonEmpty).join("; ").slice(0, MESSAGE_CHARS) || "no message";
  if (output.signal !== null) return `The command was killed by ${output.signal}: ${message}`;
  return `The command exited with code ${output.exitCode}: ${message}`;
}

// ssh-mcp 2.x marks a failed run isError and sends its stdout too; show what failed, not the
// readings before it. Anything else (1.x's "Error (code N): ...", a connection or policy
// refusal) is ssh-mcp's own message.
export function toolErrorMessage(text: string): string {
  const output = splitTrailers(text);
  if (output.exitCode !== null || output.signal !== null) return failureMessage(output);
  return text.trim() || "ssh-mcp reported an error without a message";
}

export function parseRemoteOutput(text: string): RemoteSnapshot {
  const output = splitTrailers(text);
  if ((output.exitCode !== null && output.exitCode !== 0) || output.signal !== null) {
    throw new RemoteOutputError(failureMessage(output));
  }
  const sections = splitSections(output.stdout);
  try {
    const meminfo = parseMeminfo(section(sections, "meminfo").join("\n"));
    const load = parseLoadavg(section(sections, "loadavg").join("\n"));
    return {
      memTotalBytes: meminfo.totalBytes,
      memAvailableBytes: meminfo.availableBytes,
      swapTotalBytes: meminfo.swapTotalBytes,
      swapFreeBytes: meminfo.swapFreeBytes,
      load1: load.load1,
      load5: load.load5,
      load15: load.load15,
      cores: parseNproc(section(sections, "nproc")),
      mounts: parseDf(section(sections, "df")),
      processes: parsePs(section(sections, "ps")),
    };
  } catch (error) {
    if (error instanceof ProcTextError) {
      throw new RemoteOutputError(error.message, { cause: error });
    }
    throw error;
  }
}
