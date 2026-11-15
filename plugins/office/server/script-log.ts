import type { ScriptLogResult, WorkspaceScript } from "../shared/contracts.js";

/** The lines of a log the office shows: the newest ones. */
export const LOG_LINES = 40;
/** A line longer than this is cut: a minified bundle on one line is not a log line. */
export const LOG_LINE_MAX = 400;
/**
 * The rows asked of the terminal. A terminal's last rows are the empty part of its screen, so
 * more than LOG_LINES are read to find that many with something on them.
 */
export const LOG_READ_ROWS = 400;

export interface ScriptLogPorts {
  /** The script as the office's directory has it now; null when it has none by that name. */
  script(workspaceId: string, name: string): WorkspaceScript | null;
  /** The last `rows` rows of a terminal, colour codes removed, and the rows it holds in all. */
  tail(terminalId: string, rows: number): Promise<{ lines: readonly string[]; total: number }>;
  now(): number;
}

export interface LogTail {
  lines: string[];
  /** The rows over the first of these lines. */
  above: number;
}

/** The newest lines with the screen's empty end dropped, each cut at the longest a line may be. */
export function logTail(rows: readonly string[]): LogTail {
  let end = rows.length;
  while (end > 0 && (rows[end - 1] ?? "").trim() === "") end -= 1;
  const above = Math.max(0, end - LOG_LINES);
  const lines = rows
    .slice(above, end)
    .map((line) => (line.length > LOG_LINE_MAX ? `${line.slice(0, LOG_LINE_MAX - 1)}…` : line));
  return { lines, above };
}

/**
 * The end of a workspace script's output, read from its terminal. The terminal is the one the
 * directory names for the script: a caller chooses a script, never a terminal.
 */
export async function readScriptLog(
  ports: ScriptLogPorts,
  workspaceId: string,
  name: string,
): Promise<ScriptLogResult> {
  const script = ports.script(workspaceId, name);
  if (script === null) return { ok: false, error: "This host does not know the script" };
  if (script.terminalId === null) {
    return { ok: false, error: "The script has not run on this host, so it has no output" };
  }
  const { lines: rows, total } = await ports.tail(script.terminalId, LOG_READ_ROWS);
  const tail = logTail(rows);
  return {
    ok: true,
    lines: tail.lines,
    // The rows the read did not ask for, and the ones it got that are over the lines shown.
    earlier: Math.max(0, total - rows.length) + tail.above,
    readAt: new Date(ports.now()).toISOString(),
  };
}
