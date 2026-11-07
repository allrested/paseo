// Parsers for /proc text, shared by the local reader and the remote output parser.

export class ProcTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcTextError";
  }
}

export interface Meminfo {
  totalBytes: number;
  availableBytes: number;
  swapTotalBytes: number;
  swapFreeBytes: number;
}

export interface Loadavg {
  load1: number;
  load5: number;
  load15: number;
}

const KIB = 1024;
// "MemTotal:       16042308 kB". Names with parentheses and unitless counts are not needed.
const MEMINFO_LINE = /^(\w+):\s+(\d+) kB$/;

export function parseMeminfoFields(text: string): Map<string, number> {
  const fields = new Map<string, number>();
  for (const line of text.split("\n")) {
    const match = MEMINFO_LINE.exec(line.trim());
    if (match) fields.set(match[1], Number(match[2]) * KIB);
  }
  return fields;
}

function requireField(fields: Map<string, number>, name: string): number {
  const value = fields.get(name);
  if (value === undefined) throw new ProcTextError(`meminfo has no ${name} line`);
  return value;
}

// MemAvailable arrived in Linux 3.14. Before it, free + buffers + page cache is the usual estimate.
export function availableMemory(fields: Map<string, number>): number {
  const available = fields.get("MemAvailable");
  if (available !== undefined) return available;
  return (
    requireField(fields, "MemFree") +
    requireField(fields, "Buffers") +
    requireField(fields, "Cached")
  );
}

export function parseMeminfo(text: string): Meminfo {
  const fields = parseMeminfoFields(text);
  return {
    totalBytes: requireField(fields, "MemTotal"),
    availableBytes: availableMemory(fields),
    swapTotalBytes: requireField(fields, "SwapTotal"),
    swapFreeBytes: requireField(fields, "SwapFree"),
  };
}

// "1.54 1.88 2.22 1/10058 224556": the 1, 5 and 15 minute averages come first.
export function parseLoadavg(text: string): Loadavg {
  const [load1, load5, load15] = text.trim().split(/\s+/).map(Number);
  if (text.trim() === "" || ![load1, load5, load15].every(Number.isFinite)) {
    throw new ProcTextError(`Unrecognised loadavg: ${text.slice(0, 80)}`);
  }
  return { load1, load5, load15 };
}
