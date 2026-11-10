import { WebSocket } from "ws";

export class CdpTimeoutError extends Error {
  constructor(
    readonly method: string,
    timeoutMs: number,
  ) {
    super(`CDP ${method} timed out after ${timeoutMs}ms`);
    this.name = "CdpTimeoutError";
  }
}

export class CdpClosedError extends Error {
  constructor(message = "CDP connection is closed") {
    super(message);
    this.name = "CdpClosedError";
  }
}

export class CdpCommandError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "CdpCommandError";
  }
}

export interface CdpConnectionOptions {
  url: string;
  commandTimeoutMs?: number;
  connectTimeoutMs?: number;
  onError?: (error: unknown) => void;
}

type Listener = (params: Record<string, unknown>) => void;

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export class CdpConnection {
  private nextId = 1;
  private isClosed = false;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly closeListeners = new Set<() => void>();

  private constructor(
    private readonly socket: WebSocket,
    private readonly commandTimeoutMs: number,
    private readonly onError: (error: unknown) => void,
  ) {
    socket.on("message", (data) => this.receive(String(data)));
    socket.on("close", () => this.finish());
    // Without an error listener, ws raises an uncaught exception in the daemon.
    socket.on("error", (error) => {
      this.onError(error);
      this.finish();
    });
  }

  static open(options: CdpConnectionOptions): Promise<CdpConnection> {
    // A throwing caller callback must not escape into a socket handler or timer.
    const onError = (error: unknown) => {
      try {
        options.onError?.(error);
      } catch {
        // nothing left to report to
      }
    };
    return new Promise<CdpConnection>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(options.url, {
        handshakeTimeout: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
        perMessageDeflate: false,
        maxPayload: 256 * 1024 * 1024,
      });
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        socket.on("error", () => {});
        socket.terminate();
        reject(
          new CdpClosedError(
            `CDP connect failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      };
      socket.once("error", fail);
      socket.once("close", () => fail(new Error("closed before open")));
      socket.once("open", () => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        resolve(
          new CdpConnection(
            socket,
            options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
            onError,
          ),
        );
      });
    });
  }

  get closed(): boolean {
    return this.isClosed;
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    options?: { timeoutMs?: number },
  ): Promise<T> {
    if (this.isClosed) return Promise.reject(new CdpClosedError());
    const id = this.nextId++;
    const timeoutMs = options?.timeoutMs ?? this.commandTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new CdpTimeoutError(method, timeoutMs));
        // A reused socket would hand the late reply to the next caller's reader.
        this.close();
      }, timeoutMs);
      this.pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }), (error) => {
          if (!error || !this.pending.delete(id)) return;
          clearTimeout(timer);
          reject(new CdpClosedError(`CDP send failed: ${error.message}`));
        });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(
          new CdpClosedError(
            `CDP send failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
  }

  on(event: string, listener: Listener): () => void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    this.listeners.set(event, set);
    set.add(listener);
    return () => set.delete(listener);
  }

  onClose(listener: () => void): () => void {
    if (this.isClosed) {
      this.guard(listener);
      return () => {};
    }
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(): void {
    if (this.isClosed) return;
    try {
      this.socket.terminate();
    } catch (error) {
      this.onError(error);
    }
    this.finish();
  }

  private receive(raw: string): void {
    let message: {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: unknown;
      error?: { code?: number; message?: string };
    };
    try {
      message = JSON.parse(raw);
    } catch (error) {
      this.onError(error);
      return;
    }
    if (typeof message !== "object" || message === null) {
      this.onError(new Error("CDP frame is not an object"));
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(
          new CdpCommandError(
            pending.method,
            message.error.code ?? 0,
            message.error.message ?? "CDP error",
          ),
        );
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    if (typeof message.method !== "string") return;
    const params = message.params ?? {};
    for (const listener of this.listeners.get(message.method) ?? [])
      this.guard(() => listener(params));
  }

  private finish(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new CdpClosedError());
    }
    for (const listener of this.closeListeners) this.guard(listener);
    this.closeListeners.clear();
    this.listeners.clear();
  }

  private guard(run: () => void): void {
    try {
      run();
    } catch (error) {
      this.onError(error);
    }
  }
}
