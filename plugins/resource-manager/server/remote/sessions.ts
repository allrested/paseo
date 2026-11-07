import { join } from "node:path";
import type { ServerReading } from "../../shared/rpc.js";
import { listPidFiles, reclaimPidFile } from "../pid-files.js";
import type { SshServer } from "./discovery.js";
import type { ToolCallResult } from "./mcp-stdio-client.js";
import {
  parseRemoteOutput,
  REMOTE_COMMAND,
  RemoteOutputError,
  toolErrorMessage,
} from "./remote-output.js";

// One MCP client per ssh-mcp server, started on the first read and closed 2 minutes after the
// last (decision 15). A read waits at most 40 s; the work goes on, and a later read gets it.

export const SESSION_TIMING = { idleMs: 120_000, waitMs: 40_000 } as const;
export const WAITING_MESSAGE =
  "No answer from ssh-mcp after 40 s; the reading shows on a later refresh";
export const SHUTDOWN_MESSAGE = "Paseo is shutting down";
const MAX_ERROR_CHARS = 500;

export interface SessionClient {
  readonly closed: boolean;
  listTools(): Promise<string[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;
  close(): Promise<void>;
}

export type StartClient = (server: SshServer, signal: AbortSignal) => Promise<SessionClient>;

export interface TimerHandle {
  cancel(): void;
}

export interface TimerPort {
  now(): number;
  after(ms: number, callback: () => void): TimerHandle;
}

// Unref'd, so a pending idle close never holds the daemon open.
export const nodeTimers: TimerPort = {
  now: () => Date.now(),
  after: (ms, callback) => {
    const timer = setTimeout(callback, ms);
    timer.unref();
    return { cancel: () => clearTimeout(timer) };
  },
};

export class NoUsableToolError extends Error {
  constructor() {
    super("This ssh-mcp offers neither exec nor run-command");
    this.name = "NoUsableToolError";
  }
}

export interface RemoteSessionsOptions {
  runDir: string;
  procRoot: string;
  startClient: StartClient;
  timers: TimerPort;
  log(message: string): void;
}

interface Entry {
  server: SshServer;
  client: Promise<SessionClient> | null;
  /** The read in flight. Never rejects. */
  work: Promise<void> | null;
  reading: ServerReading;
  idle: TimerHandle | null;
  /** Aborted when the entry is replaced or the plugin stops; cancels a start in progress. */
  abort: AbortController;
  toolName: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyReading(id: string, error: string | null): ServerReading {
  return { id, snapshot: null, readAt: null, error };
}

// The last snapshot stays, with its time, so the tab keeps showing it under the error.
function failedReading(previous: ServerReading, message: string): ServerReading {
  return {
    id: previous.id,
    snapshot: previous.snapshot,
    readAt: previous.readAt,
    error: message.slice(0, MAX_ERROR_CHARS),
  };
}

// ssh-mcp 1.x has exec; 2.x has run-command, and its read-command refuses "&" (decision 13).
export function pickTool(names: readonly string[]): string {
  if (names.includes("exec")) return "exec";
  if (names.includes("run-command")) return "run-command";
  throw new NoUsableToolError();
}

export function missingVariablesMessage(names: readonly string[]): string {
  return `The config refers to ${names.join(", ")}, which the daemon's environment does not set`;
}

export class RemoteSessions {
  readonly ready: Promise<void>;
  private readonly options: RemoteSessionsOptions;
  private readonly entries = new Map<string, Entry>();
  private readonly closings = new Set<Promise<void>>();
  private stopped = false;

  constructor(options: RemoteSessionsOptions) {
    this.options = options;
    this.ready = this.reclaim();
  }

  async read(server: SshServer): Promise<ServerReading> {
    await this.ready;
    if (this.stopped) return emptyReading(server.id, SHUTDOWN_MESSAGE);
    if (server.missingVariables.length > 0) {
      return emptyReading(server.id, missingVariablesMessage(server.missingVariables));
    }
    const entry = this.entryFor(server);
    this.touch(entry);
    if (entry.work === null) {
      entry.work = this.refresh(entry).finally(() => {
        entry.work = null;
      });
    }
    const finished = await this.withDeadline(entry.work);
    if (finished) return entry.reading;
    return { ...entry.reading, error: WAITING_MESSAGE };
  }

  async closeAll(): Promise<void> {
    this.stopped = true;
    for (const entry of this.entries.values()) this.remove(entry);
    await Promise.all(this.closings);
  }

  // A daemon that died left its ssh-mcp groups running; their files name them.
  private async reclaim(): Promise<void> {
    for (const name of listPidFiles(this.options.runDir)) {
      try {
        const outcome = await reclaimPidFile(
          join(this.options.runDir, name),
          this.options.procRoot,
        );
        if (outcome === "killed") {
          this.options.log(`resource-manager: stopped an ssh-mcp group left running (${name})`);
        }
      } catch (error) {
        this.options.log(`resource-manager: could not reclaim ${name}: ${errorMessage(error)}`);
      }
    }
  }

  private entryFor(server: SshServer): Entry {
    const existing = this.entries.get(server.id);
    if (existing !== undefined && existing.server.fingerprint === server.fingerprint) {
      return existing;
    }
    if (existing !== undefined) this.remove(existing);
    const entry: Entry = {
      server,
      client: null,
      work: null,
      reading: emptyReading(server.id, null),
      idle: null,
      abort: new AbortController(),
      toolName: null,
    };
    this.entries.set(server.id, entry);
    return entry;
  }

  private async refresh(entry: Entry): Promise<void> {
    try {
      const client = await this.clientFor(entry);
      const tool = entry.toolName ?? pickTool(await client.listTools());
      entry.toolName = tool;
      const result = await client.callTool(tool, { command: REMOTE_COMMAND });
      if (result.isError) {
        entry.reading = failedReading(entry.reading, toolErrorMessage(result.text));
        return;
      }
      entry.reading = {
        id: entry.server.id,
        snapshot: parseRemoteOutput(result.text),
        readAt: new Date(this.options.timers.now()).toISOString(),
        error: null,
      };
    } catch (error) {
      entry.reading = failedReading(entry.reading, errorMessage(error));
      // Output that does not parse, or a server without a usable tool, will not improve with a
      // new session. Anything else (exit, timeout, protocol error) gets a fresh one next time.
      if (!(error instanceof RemoteOutputError || error instanceof NoUsableToolError)) {
        this.drop(entry);
      }
    }
  }

  private async clientFor(entry: Entry): Promise<SessionClient> {
    if (entry.client !== null) {
      const current = await entry.client;
      if (!current.closed) return current;
      this.drop(entry);
    }
    entry.client = this.options.startClient(entry.server, entry.abort.signal);
    return entry.client;
  }

  private async withDeadline(work: Promise<void>): Promise<boolean> {
    const deadline = new Promise<boolean>((resolve) => {
      const handle = this.options.timers.after(SESSION_TIMING.waitMs, () => resolve(false));
      void work.finally(() => handle.cancel());
    });
    return Promise.race([work.then(() => true), deadline]);
  }

  private touch(entry: Entry): void {
    entry.idle?.cancel();
    entry.idle = this.options.timers.after(SESSION_TIMING.idleMs, () => this.expire(entry));
  }

  // A read still running keeps the session until 2 minutes after it.
  private expire(entry: Entry): void {
    try {
      if (entry.work === null) this.remove(entry);
      else void entry.work.finally(() => this.touch(entry));
    } catch (error) {
      this.options.log(`resource-manager: idle close failed: ${errorMessage(error)}`);
    }
  }

  private remove(entry: Entry): void {
    if (this.entries.get(entry.server.id) === entry) this.entries.delete(entry.server.id);
    entry.idle?.cancel();
    entry.idle = null;
    entry.abort.abort();
    this.drop(entry);
  }

  private drop(entry: Entry): void {
    const client = entry.client;
    entry.client = null;
    entry.toolName = null;
    if (client === null) return;
    const closing = this.closeClient(client);
    this.closings.add(closing);
    void closing.finally(() => this.closings.delete(closing));
  }

  // Never rejects. A start that failed left nothing running.
  private async closeClient(client: Promise<SessionClient>): Promise<void> {
    let started: SessionClient;
    try {
      started = await client;
    } catch {
      return;
    }
    try {
      await started.close();
    } catch (error) {
      this.options.log(
        `resource-manager: could not close an ssh-mcp session: ${errorMessage(error)}`,
      );
    }
  }
}
