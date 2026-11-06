import type { ServerStatus } from "../shared/rpc.js";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Binary units, as `free` and `ps` count RSS: "512 B", "1.5 KB", "120 MB". */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  const amount = value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${amount} ${BYTE_UNITS[unit]}`;
}

/** The two largest units of a duration: "45s", "3m 12s", "2h 5m", "3d 4h". */
export function formatUptime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function parseTime(value: string | null): number | null {
  if (value === null) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/**
 * One status line for a server row. `now` is when the status was fetched, so uptime and the
 * retry countdown agree with the rest of the row.
 */
export function describeServer(server: ServerStatus, now: number): string {
  const parts: string[] = [server.state, `port ${server.port}`];
  const running = server.pid !== null;
  const startedAt = parseTime(server.startedAt);
  if (running) parts.push(`pid ${server.pid}`);
  if (running && startedAt !== null) parts.push(`up ${formatUptime(now - startedAt)}`);
  parts.push(server.restarts === 1 ? "1 restart" : `${server.restarts} restarts`);
  if (server.rssBytes !== null) parts.push(formatBytes(server.rssBytes));
  const retryAt = parseTime(server.nextRetryAt);
  if (retryAt !== null) parts.push(`retry in ${formatUptime(retryAt - now)}`);
  return parts.join(" · ");
}

/** The last `limit` lines of a server's output, or a note that it has written none. */
export function formatLogTail(lines: readonly string[], limit: number): string {
  if (lines.length === 0) return "No output yet.";
  return lines.slice(-limit).join("\n");
}
