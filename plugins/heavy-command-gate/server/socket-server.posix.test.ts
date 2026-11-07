import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import type { GateMembership, GatePeer } from "./gate.js";
import { MAX_LINE_LENGTH, type ShimHello } from "./protocol.js";
import { listenGateSocket, type GateSocketServer } from "./socket-server.js";

// A connect to a full accept queue fails with EAGAIN on Linux; the busy-owner test needs that.
const itOnLinux = test.runIf(process.platform === "linux");

interface FakeMembership extends GateMembership {
  joins: ShimHello[];
  leaves: string[];
  peers: GatePeer[];
  failNextJoin: boolean;
}

interface Client {
  socket: Socket;
  lines: string[];
  closed: Promise<void>;
}

const HELLO: ShimHello = {
  type: "hello",
  version: 1,
  command: "tsc --noEmit",
  estimateBytes: 3 * 1024 ** 3,
  agentId: "agent-1",
  process: { pid: 4242, startTime: 99, pidNamespace: "pid:[1]", bootId: "boot", initStartTime: 1 },
};

let root = "";
let socketPath = "";
const servers: GateSocketServer[] = [];
const clients: Socket[] = [];
const children: ChildProcess[] = [];

// Answers every join with one wait notice, as the real gate does for a queued command.
function createMembership(): FakeMembership {
  const membership: FakeMembership = {
    joins: [],
    leaves: [],
    peers: [],
    failNextJoin: false,
    join(hello, peer) {
      if (membership.failNextJoin) {
        membership.failNextJoin = false;
        throw new Error("join failed on purpose");
      }
      membership.joins.push(hello);
      membership.peers.push(peer);
      peer.send({ type: "wait", ahead: 0, freeBytes: null, neededBytes: 1, waitingOn: "slot" });
      return `m${membership.joins.length}`;
    },
    leave(id) {
      membership.leaves.push(id);
    },
  };
  return membership;
}

async function listen(
  membership: GateMembership,
  helloTimeoutMs?: number,
): Promise<GateSocketServer> {
  const server = await listenGateSocket({ socketPath, gate: membership, helloTimeoutMs });
  if (server === null) throw new Error("the test socket is taken");
  servers.push(server);
  return server;
}

// A claim that wrongly succeeds is closed with the other servers.
async function tryListen(membership: GateMembership): Promise<GateSocketServer | null> {
  const server = await listenGateSocket({ socketPath, gate: membership });
  if (server !== null) servers.push(server);
  return server;
}

function connectClient(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    clients.push(socket);
    const lines: string[] = [];
    let buffer = "";
    let connected = false;
    const closed = new Promise<void>((done) => {
      socket.once("close", () => done());
    });
    socket.setEncoding("utf8");
    socket.on("data", (chunk: Buffer | string) => {
      buffer += String(chunk);
      let end = buffer.indexOf("\n");
      while (end >= 0) {
        lines.push(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        end = buffer.indexOf("\n");
      }
    });
    // A reset from the server after connect is expected in these tests.
    socket.on("error", (error) => {
      if (!connected) reject(error);
    });
    socket.once("connect", () => {
      connected = true;
      resolve({ socket, lines, closed });
    });
  });
}

// A socket file with no listener, as a daemon killed with SIGKILL leaves it.
function leaveStaleSocket(): void {
  const script =
    'const s = require("node:net").createServer(); s.listen(process.argv[1], () => process.kill(process.pid, "SIGKILL"));';
  const result = spawnSync(process.execPath, ["-e", script, socketPath], {
    stdio: "ignore",
    timeout: 10_000,
  });
  if (result.signal !== "SIGKILL" || !existsSync(socketPath)) {
    throw new Error("could not leave a stale socket file");
  }
}

// A daemon too busy to accept: it listens with a backlog of 1, says so, then blocks its event loop
// for good (the wait ends the child after a minute if the test run itself dies). The write is
// synchronous, so no connection made after the signal is ever accepted.
const BUSY_OWNER_SCRIPT =
  'const net = require("node:net"); const fs = require("node:fs"); net.createServer().listen(process.argv[1], 1, () => { fs.writeSync(1, "listening"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000); process.exit(0); });';

// The child's environment is built from scratch: nothing from the process running vitest, which
// may itself run under a gate, reaches it.
function startBusyOwner(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", BUSY_OWNER_SCRIPT, socketPath], {
      env: {},
      stdio: ["ignore", "pipe", "ignore"],
    });
    children.push(child);
    child.once("error", reject);
    child.once("exit", () => reject(new Error("the busy owner exited before it listened")));
    child.stdout.once("data", () => resolve());
  });
}

// Kills by the pid the handle holds. SIGKILL ends a process blocked in Atomics.wait at once.
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  child.kill("SIGKILL");
  await exited;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "heavy-gate-socket-"));
  socketPath = join(root, "gate.sock");
});

afterEach(async () => {
  for (const child of children.splice(0)) await stopChild(child);
  for (const socket of clients.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) await server.close();
  rmSync(root, { recursive: true, force: true });
});

describe("listenGateSocket", () => {
  it("passes a valid hello to the gate and the gate's notices back as JSON lines", async () => {
    const membership = createMembership();
    await listen(membership);
    const client = await connectClient();
    client.socket.write(`${JSON.stringify(HELLO)}\n`);
    await vi.waitFor(() => expect(client.lines).toHaveLength(1));
    expect(membership.joins).toEqual([HELLO]);
    expect(JSON.parse(client.lines[0])).toEqual({
      type: "wait",
      ahead: 0,
      freeBytes: null,
      neededBytes: 1,
      waitingOn: "slot",
    });
  });

  it("calls leave once when the shim's connection closes", async () => {
    const membership = createMembership();
    await listen(membership);
    const client = await connectClient();
    client.socket.write(`${JSON.stringify(HELLO)}\n`);
    await vi.waitFor(() => expect(membership.joins).toHaveLength(1));
    client.socket.end();
    await vi.waitFor(() => expect(membership.leaves).toEqual(["m1"]));
  });

  it("drops a first line that is not JSON", async () => {
    const membership = createMembership();
    await listen(membership);
    const client = await connectClient();
    client.socket.write("hello\n");
    await client.closed;
    expect(membership.joins).toEqual([]);
    expect(membership.leaves).toEqual([]);
  });

  it("drops a hello that fails the schema", async () => {
    const membership = createMembership();
    await listen(membership);
    const client = await connectClient();
    client.socket.write(`${JSON.stringify({ ...HELLO, version: 2 })}\n`);
    await client.closed;
    expect(membership.joins).toEqual([]);
  });

  it("drops a connection that sends no hello in time", async () => {
    const membership = createMembership();
    await listen(membership, 100);
    const client = await connectClient();
    await client.closed;
    expect(membership.joins).toEqual([]);
  });

  it("drops a line longer than 64 KB", async () => {
    const membership = createMembership();
    await listen(membership);
    const client = await connectClient();
    client.socket.write("x".repeat(MAX_LINE_LENGTH + 1));
    await client.closed;
    expect(membership.joins).toEqual([]);
  });

  it("closes a connection whose join throws, and keeps serving the next one", async () => {
    const membership = createMembership();
    membership.failNextJoin = true;
    await listen(membership);
    const first = await connectClient();
    first.socket.write(`${JSON.stringify(HELLO)}\n`);
    await first.closed;
    const second = await connectClient();
    second.socket.write(`${JSON.stringify(HELLO)}\n`);
    await vi.waitFor(() => expect(membership.joins).toHaveLength(1));
  });

  it("claims a socket file that a dead daemon left behind", async () => {
    leaveStaleSocket();
    const membership = createMembership();
    await listen(membership);
    const client = await connectClient();
    client.socket.write(`${JSON.stringify(HELLO)}\n`);
    await vi.waitFor(() => expect(membership.joins).toHaveLength(1));
  });

  it("stands down while another live server owns the socket", async () => {
    const owner = createMembership();
    await listen(owner);
    expect(await listenGateSocket({ socketPath, gate: createMembership() })).toBeNull();
    const client = await connectClient();
    client.socket.write(`${JSON.stringify(HELLO)}\n`);
    await vi.waitFor(() => expect(owner.joins).toHaveLength(1));
  });

  itOnLinux("stands down while the owner is too busy to accept", async () => {
    await startBusyOwner();
    await connectClient();
    await connectClient();
    await expect(connectClient()).rejects.toMatchObject({ code: "EAGAIN" });
    const membership = createMembership();
    expect(await tryListen(membership)).toBeNull();
    expect(membership.joins).toEqual([]);
    expect(membership.leaves).toEqual([]);
    expect(existsSync(socketPath)).toBe(true);
    // A claim that had replaced the file would accept this connection.
    await expect(connectClient()).rejects.toMatchObject({ code: "EAGAIN" });
  });

  it("closes every connection and removes the socket file on close", async () => {
    const membership = createMembership();
    const server = await listen(membership);
    const client = await connectClient();
    client.socket.write(`${JSON.stringify(HELLO)}\n`);
    await vi.waitFor(() => expect(membership.joins).toHaveLength(1));
    await server.close();
    await client.closed;
    expect(membership.leaves).toEqual(["m1"]);
    expect(existsSync(socketPath)).toBe(false);
  });
});
