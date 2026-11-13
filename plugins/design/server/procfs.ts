// parseStat from resource-manager's local/procfs.ts, for the copied pid-files.ts.
export interface ProcStat {
  ppid: number;
  pgrp: number;
  startTime: number;
}

export class ProcStatParseError extends Error {
  readonly stat: string;

  constructor(stat: string) {
    super(`Unrecognised /proc/<pid>/stat line: ${stat.slice(0, 120)}`);
    this.name = "ProcStatParseError";
    this.stat = stat;
  }
}

// Field 2 (comm) is the raw process name and may hold spaces and parentheses, so fields are
// counted from the last ")". After ") " come 3 state, 4 ppid, 5 pgrp ... 22 starttime (ticks).
export function parseStat(stat: string): ProcStat {
  const commEnd = stat.lastIndexOf(")");
  const fields = stat.slice(commEnd + 2).split(" ");
  const ppid = Number(fields[1]);
  const pgrp = Number(fields[2]);
  const startTime = Number(fields[19]);
  if (commEnd < 0 || ![ppid, pgrp, startTime].every(Number.isSafeInteger)) {
    throw new ProcStatParseError(stat);
  }
  return { ppid, pgrp, startTime };
}
