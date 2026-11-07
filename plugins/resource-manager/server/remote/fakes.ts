import type { SshServer } from "./discovery.js";
import { McpSessionError, type ToolCallResult } from "./mcp-stdio-client.js";
import { REMOTE_OUTPUT_SAMPLE } from "./remote-output-sample.js";
import type { SessionClient, StartClient, TimerHandle, TimerPort } from "./sessions.js";

// Typed stand-ins for the MCP client, its starter and the clock, for tests. Typechecked with the
// plugin, so a test that uses them is checked even though test files are not.

export const SAMPLE_ANSWER: ToolCallResult = { isError: false, text: REMOTE_OUTPUT_SAMPLE };

/** A tool answer: a result, an Error to reject with, or a promise that settles later. */
export type FakeAnswer = ToolCallResult | Error | Promise<ToolCallResult>;

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export class FakeSessionClient implements SessionClient {
  closed = false;
  closeCount = 0;
  readonly calls: ToolCall[] = [];
  private readonly tools: string[];
  private readonly answers: FakeAnswer[];

  /** Answers are used in order; the last one repeats. */
  constructor(tools: string[] = ["exec"], answers: FakeAnswer[] = [SAMPLE_ANSWER]) {
    this.tools = tools;
    this.answers = answers;
  }

  listTools(): Promise<string[]> {
    if (this.closed) return Promise.reject(new McpSessionError("The ssh-mcp session was closed"));
    return Promise.resolve([...this.tools]);
  }

  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    if (this.closed) return Promise.reject(new McpSessionError("The ssh-mcp session was closed"));
    this.calls.push({ name, args });
    const answer = this.answers.length > 1 ? this.answers.shift() : this.answers[0];
    if (answer === undefined) return Promise.reject(new Error("FakeSessionClient has no answer"));
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(answer);
  }

  close(): Promise<void> {
    this.closed = true;
    this.closeCount += 1;
    return Promise.resolve();
  }
}

export interface StartRecord {
  server: SshServer;
  signal: AbortSignal;
}

export class FakeStarter {
  /** What the next starts give, in order: a client, or an Error to reject with. */
  readonly queue: (FakeSessionClient | Error)[] = [];
  readonly started: StartRecord[] = [];
  readonly clients: FakeSessionClient[] = [];

  readonly start: StartClient = (server, signal) => {
    this.started.push({ server, signal });
    if (signal.aborted) {
      return Promise.reject(new McpSessionError("The ssh-mcp start was cancelled"));
    }
    const next = this.queue.shift() ?? new FakeSessionClient();
    if (next instanceof Error) return Promise.reject(next);
    this.clients.push(next);
    return Promise.resolve(next);
  };
}

interface FakeTimer {
  at: number;
  callback: () => void;
  cancelled: boolean;
}

export class FakeTimers implements TimerPort {
  private current: number;
  private readonly timers: FakeTimer[] = [];

  constructor(start = Date.parse("2026-11-06T09:00:00.000Z")) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  after(ms: number, callback: () => void): TimerHandle {
    const timer: FakeTimer = { at: this.current + ms, callback, cancelled: false };
    this.timers.push(timer);
    return {
      cancel: () => {
        timer.cancelled = true;
      },
    };
  }

  /** Moves the clock forward, running each timer that falls due in time order. */
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const due = this.timers
        .filter((timer) => !timer.cancelled && timer.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      due.cancelled = true;
      this.current = due.at;
      due.callback();
    }
    this.current = target;
  }

  get scheduled(): number {
    return this.timers.filter((timer) => !timer.cancelled).length;
  }
}
