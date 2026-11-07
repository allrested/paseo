import { unlink } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { clearTimeout, setTimeout } from "node:timers";
import type { GateMembership } from "./gate.js";
import { MAX_LINE_LENGTH, ShimHelloSchema, type ServerNotice, type ShimHello } from "./protocol.js";

export interface GateSocketServer {
  close(): Promise<void>;
}

export interface GateSocketOptions {
  socketPath: string;
  gate: GateMembership;
  /** How long a connection may stay silent before its hello. */
  helloTimeoutMs?: number;
}

const HELLO_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 1_000;

function errorCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

function listenOnce(server: Server, socketPath: string): Promise<Error | null> {
  return new Promise((resolve) => {
    function onError(error: Error): void {
      server.off("listening", onListening);
      resolve(error);
    }
    function onListening(): void {
      server.off("error", onError);
      resolve(null);
    }
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
}

// False only when nobody can own the path: the probe is refused (a socket file nobody listens on)
// or finds no file. Every other outcome means a live owner, so the caller stands down: a connection
// that is accepted, one still pending after a second, and any other error. A daemon too busy to
// accept still owns its socket, and a full accept queue answers EAGAIN.
function answers(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect(socketPath);
    const timer = setTimeout(() => {
      probe.destroy();
      resolve(true);
    }, PROBE_TIMEOUT_MS);
    probe.once("connect", () => {
      clearTimeout(timer);
      probe.destroy();
      resolve(true);
    });
    probe.once("error", (error) => {
      clearTimeout(timer);
      const code = errorCode(error);
      resolve(code !== "ECONNREFUSED" && code !== "ENOENT");
    });
  });
}

// false: another live server owns the path. A file nobody answers on is what a killed daemon
// leaves behind, so it is removed and claimed.
async function claim(server: Server, socketPath: string): Promise<boolean> {
  const first = await listenOnce(server, socketPath);
  if (first === null) return true;
  if (errorCode(first) !== "EADDRINUSE") throw first;
  if (await answers(socketPath)) return false;
  await unlink(socketPath).catch((error: unknown) => {
    if (errorCode(error) !== "ENOENT") throw error;
  });
  const second = await listenOnce(server, socketPath);
  if (second === null) return true;
  if (errorCode(second) === "EADDRINUSE") return false;
  throw second;
}

function parseHello(line: string): ShimHello | null {
  try {
    const result = ShimHelloSchema.safeParse(JSON.parse(line));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// A shim killed mid-write leaves a destroyed socket; its notice has nowhere to go.
function writeNotice(socket: Socket, notice: ServerNotice): void {
  if (socket.destroyed || !socket.writable) return;
  socket.write(`${JSON.stringify(notice)}\n`);
}

// Every gate call runs in a socket callback inside the daemon, so a throw is caught and logged:
// an uncaught exception would end the daemon.
function acceptShim(socket: Socket, options: GateSocketOptions, connections: Set<Socket>): void {
  connections.add(socket);
  let buffer = "";
  let memberId: string | null = null;
  const helloTimer = setTimeout(() => socket.destroy(), options.helloTimeoutMs ?? HELLO_TIMEOUT_MS);
  socket.setEncoding("utf8");
  // ECONNRESET from a killed shim: the close below releases its slot.
  socket.on("error", () => socket.destroy());
  socket.on("close", () => {
    clearTimeout(helloTimer);
    connections.delete(socket);
    if (memberId === null) return;
    try {
      options.gate.leave(memberId);
    } catch (error) {
      console.error("heavy-command-gate: releasing a command failed", error);
    }
  });
  socket.on("data", (chunk: Buffer | string) => {
    // The shim sends nothing after its hello.
    if (memberId !== null) return;
    buffer += String(chunk);
    const end = buffer.indexOf("\n");
    if (end < 0 && buffer.length <= MAX_LINE_LENGTH) return;
    clearTimeout(helloTimer);
    const hello = end < 0 || end > MAX_LINE_LENGTH ? null : parseHello(buffer.slice(0, end));
    buffer = "";
    if (hello === null) {
      socket.destroy();
      return;
    }
    try {
      memberId = options.gate.join(hello, { send: (notice) => writeNotice(socket, notice) });
    } catch (error) {
      console.error("heavy-command-gate: queueing a command failed", error);
      socket.destroy();
    }
  });
}

export async function listenGateSocket(
  options: GateSocketOptions,
): Promise<GateSocketServer | null> {
  const connections = new Set<Socket>();
  const server = createServer((socket) => acceptShim(socket, options, connections));
  if (!(await claim(server, options.socketPath))) return null;
  // A listener error after the claim would otherwise be an uncaught exception in the daemon.
  server.on("error", (error) => console.error("heavy-command-gate: gate socket failed", error));
  return {
    async close() {
      // The listener's callback fires when the last connection is destroyed, before that
      // connection's close event releases its slot. Wait for both. Node removes the socket file
      // when the listener closes.
      const closed = [new Promise<void>((resolve) => server.close(() => resolve()))];
      for (const socket of connections) {
        closed.push(new Promise<void>((resolve) => socket.once("close", () => resolve())));
        socket.destroy();
      }
      await Promise.all(closed);
    },
  };
}
