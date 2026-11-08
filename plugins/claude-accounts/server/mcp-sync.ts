import { basename } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import {
  canonicalJson,
  readClaudeConfig,
  withConfigLock,
  writeClaudeConfig,
  type ConfigObject,
  type ConfigRead,
} from "./claude-config.js";
import { errorMessage } from "./errors.js";

export type SyncResult =
  | { status: "copied" }
  | { status: "same" }
  | { status: "skipped"; problem: string | null };

const NEW_FILE_MODE = 0o600;

/**
 * Makes the account's top-level `mcpServers` a copy of the main profile's, removals included,
 * and leaves every other key alone.
 */
export async function syncMcpServers(mainFile: string, accountFile: string): Promise<SyncResult> {
  const main = await readClaudeConfig(mainFile, { followLinks: true });
  if (main.status === "missing") return { status: "skipped", problem: null };
  if (main.status === "unreadable") {
    return {
      status: "skipped",
      problem: `The main account's ${basename(mainFile)} ${main.reason}, so MCP servers are not copied`,
    };
  }
  const wanted = main.config.mcpServers;
  const current = await readClaudeConfig(accountFile, { followLinks: false });
  if (current.status === "unreadable") return notCopied(accountFile, current.reason);
  if (upToDate(current, wanted)) return { status: "same" };
  const locked = await withConfigLock(accountFile, () => copyUnderLock(accountFile, wanted));
  if (locked.status === "done") return locked.value;
  return { status: "skipped", problem: locked.stale ? staleLockProblem(accountFile) : null };
}

// Claude Code may have written the file since the first read, so it is read again under the lock.
async function copyUnderLock(accountFile: string, wanted: unknown): Promise<SyncResult> {
  const current = await readClaudeConfig(accountFile, { followLinks: false });
  if (current.status === "unreadable") return notCopied(accountFile, current.reason);
  if (upToDate(current, wanted)) return { status: "same" };
  if (current.status === "missing") {
    await writeClaudeConfig(accountFile, { mcpServers: wanted }, NEW_FILE_MODE);
  } else {
    await writeClaudeConfig(accountFile, withMcpServers(current.config, wanted), current.mode);
  }
  return { status: "copied" };
}

function upToDate(current: ConfigRead, wanted: unknown): boolean {
  if (current.status === "missing") return wanted === undefined;
  if (current.status !== "ok") return false;
  return canonicalJson(current.config.mcpServers) === canonicalJson(wanted);
}

// Spreading keeps an existing key where it was.
function withMcpServers(config: ConfigObject, servers: unknown): ConfigObject {
  if (servers !== undefined) return { ...config, mcpServers: servers };
  const rest: ConfigObject = {};
  for (const [key, value] of Object.entries(config)) {
    if (key !== "mcpServers") rest[key] = value;
  }
  return rest;
}

function notCopied(accountFile: string, reason: string): SyncResult {
  return {
    status: "skipped",
    problem: `${basename(accountFile)} ${reason}, so MCP servers are not copied into it`,
  };
}

function staleLockProblem(accountFile: string): string {
  return `${basename(accountFile)}.lock is older than a minute, so MCP servers are not copied. Remove it if no Claude Code process uses this account.`;
}

export interface SyncTarget {
  provider: string;
  mainFile: string;
  accountFile: string;
}

export interface McpWatcherOptions {
  /** The accounts to keep in sync, read again on every pass. */
  targets(): Promise<SyncTarget[]>;
  intervalMs: number;
  /** Must not throw: a throw makes `tick()` and `stop()` reject. */
  logError(message: string, error: unknown): void;
}

export interface McpWatcher {
  /** Runs a pass after the one in flight. Never rejects. */
  tick(): Promise<void>;
  /** What the last pass could not do for an account, or null. */
  problem(provider: string): string | null;
  stop(): Promise<void>;
}

export function watchMcpServers(options: McpWatcherOptions): McpWatcher {
  let problems = new Map<string, string>();
  const logged = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  // An uncaught failure ends the plugin's process, and the daemon drops its RPCs, hook and screen
  // until it restarts, so a failure is logged once per distinct message, never thrown.
  function logOnce(message: string, error: unknown): void {
    const key = `${message}\n${errorMessage(error)}`;
    if (logged.has(key)) return;
    logged.add(key);
    options.logError(message, error);
  }

  async function syncOne(target: SyncTarget, next: Map<string, string>): Promise<void> {
    try {
      const result = await syncMcpServers(target.mainFile, target.accountFile);
      if (result.status === "skipped" && result.problem !== null) {
        next.set(target.provider, result.problem);
      }
    } catch (error) {
      next.set(target.provider, `MCP servers were not copied: ${errorMessage(error)}`);
      logOnce(`claude-accounts: copying MCP servers into ${target.provider} failed`, error);
    }
  }

  async function pass(): Promise<void> {
    const next = new Map<string, string>();
    for (const target of await options.targets()) await syncOne(target, next);
    problems = next;
  }

  function tick(): Promise<void> {
    chain = chain
      .then(pass)
      .catch((error: unknown) => logOnce("claude-accounts: the MCP server sync failed", error));
    return chain;
  }

  async function loop(): Promise<void> {
    await tick();
    if (stopped) return;
    timer = setTimeout(() => void loop(), options.intervalMs);
    timer.unref();
  }

  void loop();
  return {
    tick,
    problem: (provider) => problems.get(provider) ?? null,
    async stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      await chain;
    },
  };
}
