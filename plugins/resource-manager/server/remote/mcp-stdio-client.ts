import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { z } from "zod";
import { killGroup, removePidFile, writePidFile } from "../pid-files.js";

// A minimal MCP client over a child's stdio: initialize, tools/list, tools/call. It runs inside
// the daemon, so every child, stream and timer event is handled and every timer is unref'd. The
// child is a detached group leader with a pid file, so a daemon that dies leaves a file the next
// start reclaims (decision 16).

export const MCP_PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "paseo-resource-manager", version: "1.0.0" };
const MAX_STDERR_CHARS = 300;
const MAX_TOOL_PAGES = 20;
// After the leader exits, how long to wait for the rest of its stderr before reporting.
const EXIT_DRAIN_MS = 200;

// As in shared-mcp's STRIPPED_ENV_PREFIX and STRIPPED_ENV_KEYS (process-runner.ts): Paseo's own
// variables and the keys Paseo removes from every process it launches never reach ssh-mcp.
const STRIPPED_ENV_PREFIX = "PASEO_";
const STRIPPED_ENV_KEYS = new Set([
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_NO_ATTACH_CONSOLE",
  "ESBUILD_BINARY_PATH",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_AGENT_SDK_VERSION",
]);

export interface McpServerCommand {
  command: string;
  args: readonly string[];
  /** The entry's own env, laid over the base env. */
  env: Record<string, string>;
}

export interface McpStdioOptions {
  runDir: string;
  /** Pid files are <runDir>/<name>-<pid>.pid. Pass the server id, never the entry's name. */
  name: string;
  procRoot: string;
  /** The daemon's env. PASEO_* and the parent-session keys are removed from it. */
  baseEnv: NodeJS.ProcessEnv;
  startTimeoutMs: number;
  requestTimeoutMs: number;
}

export interface ToolCallResult {
  isError: boolean;
  /** The result's text parts, joined by newlines. */
  text: string;
}

export class McpSessionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpSessionError";
  }
}

export class JsonRpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
  }
}

const IdSchema = z.union([z.number(), z.string()]);
type JsonRpcId = z.output<typeof IdSchema>;

const IncomingSchema = z.object({
  id: IdSchema.nullish(),
  method: z.string().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

const InitializeResultSchema = z.object({ protocolVersion: z.string() });

const ToolsListResultSchema = z.object({
  tools: z.array(z.object({ name: z.string() })),
  nextCursor: z.string().optional(),
});

const CallToolResultSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  isError: z.boolean().optional(),
});

interface Pending {
  resolve(result: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function serverEnv(
  overrides: Record<string, string>,
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (key.startsWith(STRIPPED_ENV_PREFIX) || STRIPPED_ENV_KEYS.has(key)) continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) env[key] = value;
  return env;
}

// A stream error means the child went away; the exit handler reports that. readline re-emits an
// input stream's error on its interface, which needs its own listener (as forwardLines in
// shared-mcp's process-runner.ts has). A throwing handler must not escape a readline event either,
// or it would take the daemon down.
export function readLines(stream: Readable | null, onLine: (line: string) => void): void {
  if (stream === null) return;
  stream.on("error", () => {
    // Reported by the exit handler.
  });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  lines.on("error", () => {
    // The same stream error, re-emitted by readline.
  });
  lines.on("line", (line) => {
    try {
      onLine(line);
    } catch (error) {
      console.error("resource-manager: an ssh-mcp line handler failed", error);
    }
  });
}

export class McpStdioClient {
  readonly pid: number | null;
  private readonly child: ChildProcess;
  private readonly pidFile: string | null;
  private readonly requestTimeoutMs: number;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private lastStderr = "";
  private exited = false;
  private failure: McpSessionError | null = null;
  private closing: Promise<void> | null = null;
  // One stop per group, started by the leader's exit or by close(), whichever comes first.
  private stopping: Promise<void> | null = null;

  constructor(child: ChildProcess, pidFile: string | null, requestTimeoutMs: number) {
    this.child = child;
    this.pid = child.pid ?? null;
    this.pidFile = pidFile;
    this.requestTimeoutMs = requestTimeoutMs;
    // An unlistened "error" on the child or a stream would crash the daemon.
    // No cause: Node's spawn error lists every argument in spawnargs, and one can be a password.
    child.on("error", (error) => {
      this.fail(new McpSessionError(`Could not start ssh-mcp: ${error.message}`));
    });
    child.once("exit", (code, signal) => this.onExit(code, signal));
    child.stdin?.on("error", () => {
      // A write after ssh-mcp closed its stdin fails with EPIPE; the exit handler reports why.
    });
    readLines(child.stdout, (line) => this.handleLine(line));
    readLines(child.stderr, (line) => this.noteStderr(line));
  }

  get closed(): boolean {
    return this.exited || this.failure !== null;
  }

  async initialize(timeoutMs: number): Promise<void> {
    const raw = await this.call(
      "initialize",
      { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      timeoutMs,
    );
    if (!InitializeResultSchema.safeParse(raw).success) {
      throw new McpSessionError("ssh-mcp answered initialize with an unexpected result");
    }
    this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async listTools(): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      const raw = await this.call(
        "tools/list",
        cursor === undefined ? {} : { cursor },
        this.requestTimeoutMs,
      );
      const result = ToolsListResultSchema.safeParse(raw);
      if (!result.success) {
        throw new McpSessionError("ssh-mcp answered tools/list with an unexpected result");
      }
      for (const tool of result.data.tools) names.push(tool.name);
      cursor = result.data.nextCursor;
      if (cursor === undefined) break;
    }
    return names;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    let raw: unknown;
    try {
      raw = await this.request("tools/call", { name, arguments: args }, this.requestTimeoutMs);
    } catch (error) {
      // Older MCP SDKs turn an exception in a tool into a JSON-RPC error.
      if (error instanceof JsonRpcError) return { isError: true, text: error.message };
      throw error;
    }
    const result = CallToolResultSchema.safeParse(raw);
    if (!result.success) {
      throw new McpSessionError(`ssh-mcp answered ${name} with an unexpected result`);
    }
    const text = (result.data.content ?? [])
      .flatMap((part) => (part.type === "text" && part.text !== undefined ? [part.text] : []))
      .join("\n");
    return { isError: result.data.isError === true, text };
  }

  close(): Promise<void> {
    this.closing ??= this.shutdown();
    return this.closing;
  }

  private async shutdown(): Promise<void> {
    this.fail(new McpSessionError("The ssh-mcp session was closed"));
    try {
      this.child.stdin?.end();
    } catch (error) {
      // close() must never reject: startMcpStdioClient's abort handler calls it with `void`.
      console.error("resource-manager: could not stop an ssh-mcp session", error);
    }
    await this.stopGroup();
  }

  // Members the leader started can outlive it, so the group stops as soon as the leader exits,
  // while its id still names them. An empty group's id can be reused: it is never signalled again,
  // as in shared-mcp's watchChild.
  private stopGroup(): Promise<void> {
    this.stopping ??= this.killAndForgetGroup();
    return this.stopping;
  }

  private async killAndForgetGroup(): Promise<void> {
    try {
      if (this.pid !== null) await killGroup(this.pid);
      if (this.pidFile !== null) removePidFile(this.pidFile);
    } catch (error) {
      console.error("resource-manager: could not stop an ssh-mcp session", error);
    }
  }

  // Waits for the rest of stderr ("close" comes once the streams end) or EXIT_DRAIN_MS, so the
  // message carries ssh-mcp's last line. fail() keeps the first failure, so reporting twice is
  // harmless.
  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exited = true;
    void this.stopGroup();
    const how = code === null ? String(signal) : `code ${code}`;
    const report = (): void => {
      const detail = this.lastStderr === "" ? "" : `: ${this.lastStderr}`;
      this.fail(new McpSessionError(`ssh-mcp exited (${how})${detail}`));
    };
    this.child.once("close", report);
    setTimeout(report, EXIT_DRAIN_MS).unref();
  }

  private noteStderr(line: string): void {
    const trimmed = line.trim();
    if (trimmed !== "") this.lastStderr = trimmed.slice(0, MAX_STDERR_CHARS);
  }

  private fail(error: McpSessionError): void {
    this.failure ??= error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.failure);
    }
    this.pending.clear();
  }

  private send(message: Record<string, unknown>): void {
    const stdin = this.child.stdin;
    if (this.pid === null || this.exited || this.failure !== null) return;
    if (stdin === null || !stdin.writable) return;
    stdin.write(`${JSON.stringify(message)}\n`);
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    if (this.failure !== null) return Promise.reject(this.failure);
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new McpSessionError(`ssh-mcp did not answer ${method} within ${timeoutMs / 1000} s`),
        );
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  // A JSON-RPC error on a protocol method means the session cannot be used.
  private async call(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    try {
      return await this.request(method, params, timeoutMs);
    } catch (error) {
      if (error instanceof JsonRpcError) {
        throw new McpSessionError(`ssh-mcp refused ${method}: ${error.message}`, { cause: error });
      }
      throw error;
    }
  }

  private handleLine(line: string): void {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      return;
    }
    const message = IncomingSchema.safeParse(json);
    if (!message.success) return;
    const { id, method, error } = message.data;
    if (method !== undefined) {
      if (id !== undefined && id !== null) this.answerServerRequest(id, method);
      return;
    }
    if (typeof id !== "number") return;
    const pending = this.pending.get(id);
    if (pending === undefined) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (error !== undefined) pending.reject(new JsonRpcError(error.code, error.message));
    else pending.resolve(message.data.result);
  }

  private answerServerRequest(id: JsonRpcId, method: string): void {
    if (method === "ping") this.send({ jsonrpc: "2.0", id, result: {} });
    else this.send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  }
}

// Node refuses a NUL byte and quotes the whole value in its error, and the value can be a password.
function holdsNul(command: McpServerCommand): boolean {
  const entries = Object.entries(command.env).flat();
  return [command.command, ...command.args, ...entries].some((value) => value.includes("\0"));
}

function spawnServer(command: McpServerCommand, options: McpStdioOptions): ChildProcess {
  if (holdsNul(command)) {
    throw new McpSessionError(
      "Could not start ssh-mcp: the command, an argument or an env entry holds a NUL byte",
    );
  }
  try {
    mkdirSync(options.runDir, { recursive: true, mode: 0o700 });
    return spawn(command.command, [...command.args], {
      env: serverEnv(command.env, options.baseEnv),
      detached: true,
      // Without it, a detached child on Windows opens a console window of its own.
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    throw new McpSessionError(`Could not start ssh-mcp: ${errorMessage(error)}`, { cause: error });
  }
}

export async function startMcpStdioClient(
  command: McpServerCommand,
  options: McpStdioOptions,
  signal?: AbortSignal,
): Promise<McpStdioClient> {
  if (signal?.aborted) throw new McpSessionError("The ssh-mcp start was cancelled");
  const child = spawnServer(command, options);
  const pidFile =
    child.pid === undefined ? null : join(options.runDir, `${options.name}-${child.pid}.pid`);
  const client = new McpStdioClient(child, pidFile, options.requestTimeoutMs);
  const abort = (): void => {
    void client.close();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (pidFile !== null && client.pid !== null) {
      writePidFile(pidFile, client.pid, options.procRoot);
    }
    await client.initialize(options.startTimeoutMs);
    return client;
  } catch (error) {
    await client.close();
    if (error instanceof McpSessionError) throw error;
    throw new McpSessionError(`Could not start ssh-mcp: ${errorMessage(error)}`, { cause: error });
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
