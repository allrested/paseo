import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerReading } from "../../shared/rpc.js";
import { writeFakeProc, type FakePidSpace } from "../local/fake-proc.js";
import type { PidRecord } from "../pid-files.js";
import type { SshServer } from "./discovery.js";
import { FakeSessionClient, FakeStarter, FakeTimers, SAMPLE_ANSWER } from "./fakes.js";
import { McpSessionError, type ToolCallResult } from "./mcp-stdio-client.js";
import { REMOTE_COMMAND } from "./remote-output.js";
import { REMOTE_OUTPUT_SAMPLE, REMOTE_SNAPSHOT_SAMPLE } from "./remote-output-sample.js";
import { RemoteSessions, SHUTDOWN_MESSAGE, WAITING_MESSAGE } from "./sessions.js";

const SPACE: FakePidSpace = { pidNamespace: "pid:[4026531836]", bootId: "boot-1" };
const ID = "0123456789abcdef";
const T0_ISO = "2026-11-06T09:00:00.000Z";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: (value) => settle(value) };
}

function server(overrides: Partial<SshServer> = {}): SshServer {
  return {
    id: ID,
    name: "prod-box",
    source: "User config",
    command: "npx",
    args: ["ssh-mcp", "-y", "--", "--host=10.0.0.1"],
    env: {},
    missingVariables: [],
    fingerprint: "a".repeat(64),
    ...overrides,
  };
}

function ok(readAt = T0_ISO): ServerReading {
  return { id: ID, snapshot: REMOTE_SNAPSHOT_SAMPLE, readAt, error: null };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

let root: string;
let runDir: string;
let procRoot: string;
let starter: FakeStarter;
let timers: FakeTimers;
let logs: string[];

function sessions(): RemoteSessions {
  return new RemoteSessions({
    runDir,
    procRoot,
    startClient: starter.start,
    timers,
    log: (message) => logs.push(message),
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rm-sessions-"));
  runDir = join(root, "run");
  procRoot = join(root, "proc");
  writeFakeProc(procRoot, [{ pid: 1, ppid: 0, startTime: 10 }], SPACE);
  starter = new FakeStarter();
  timers = new FakeTimers();
  logs = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("RemoteSessions", () => {
  it("reads through exec with the fixed command and reuses the session", async () => {
    const remote = sessions();

    await expect(remote.read(server())).resolves.toEqual(ok());
    await expect(remote.read(server())).resolves.toEqual(ok());

    expect(starter.started).toHaveLength(1);
    expect(starter.clients[0].calls).toEqual([
      { name: "exec", args: { command: REMOTE_COMMAND } },
      { name: "exec", args: { command: REMOTE_COMMAND } },
    ]);
  });

  it("falls back to run-command and reads a clean run with stderr", async () => {
    const stderr = "warning: setlocale: LC_ALL: cannot change locale";
    const answer: ToolCallResult = {
      isError: false,
      text: `${REMOTE_OUTPUT_SAMPLE}\n\n[stderr]\n${stderr}\n`,
    };
    starter.queue.push(new FakeSessionClient(["read-command", "run-command"], [answer]));

    await expect(sessions().read(server())).resolves.toEqual(ok());
    expect(starter.clients[0].calls[0].name).toBe("run-command");
  });

  it("shows a failed run-command's exit code and stderr, not its output", async () => {
    const failed: ToolCallResult = {
      isError: true,
      text: "@@meminfo\n\n\n[stderr]\ncat: /proc/meminfo: No such file or directory\n\n\n[exit 1]",
    };
    starter.queue.push(new FakeSessionClient(["run-command"], [failed]));

    await expect(sessions().read(server())).resolves.toEqual({
      id: ID,
      snapshot: null,
      readAt: null,
      error: "The command exited with code 1: cat: /proc/meminfo: No such file or directory",
    });
    expect(starter.clients[0].closed).toBe(false);
  });

  it("reports an ssh-mcp with neither tool and keeps its session", async () => {
    starter.queue.push(new FakeSessionClient(["read-command"]));

    await expect(sessions().read(server())).resolves.toEqual({
      id: ID,
      snapshot: null,
      readAt: null,
      error: "This ssh-mcp offers neither exec nor run-command",
    });
    expect(starter.clients[0].closed).toBe(false);
  });

  it("keeps the last snapshot and the session on a tool error", async () => {
    const refused = "Error (code 255): ssh: connect to host 10.0.0.1 port 22: Connection refused";
    starter.queue.push(
      new FakeSessionClient(["exec"], [SAMPLE_ANSWER, { isError: true, text: refused }]),
    );
    const remote = sessions();

    await remote.read(server());
    timers.advance(30_000);
    await expect(remote.read(server())).resolves.toEqual({ ...ok(), error: refused });

    expect(starter.clients[0].closed).toBe(false);
  });

  it("keeps the session when the output does not parse", async () => {
    starter.queue.push(new FakeSessionClient(["exec"], [{ isError: false, text: "garbage" }]));

    await expect(sessions().read(server())).resolves.toEqual({
      id: ID,
      snapshot: null,
      readAt: null,
      error: "The output has no meminfo section",
    });
    expect(starter.clients[0].closed).toBe(false);
  });

  it("drops the session on a session error and starts a new one on the next read", async () => {
    const lost = new McpSessionError("ssh-mcp exited (code 1): Connection reset by peer");
    starter.queue.push(new FakeSessionClient(["exec"], [lost]));
    const remote = sessions();

    await expect(remote.read(server())).resolves.toEqual({
      id: ID,
      snapshot: null,
      readAt: null,
      error: "ssh-mcp exited (code 1): Connection reset by peer",
    });
    await flush();
    expect(starter.clients[0].closeCount).toBe(1);

    await expect(remote.read(server())).resolves.toEqual(ok());
    expect(starter.started).toHaveLength(2);
  });

  it("reports a failed start and retries it on the next read", async () => {
    starter.queue.push(
      new McpSessionError("ssh-mcp exited (code 255): Permission denied (publickey)"),
    );
    const remote = sessions();

    await expect(remote.read(server())).resolves.toMatchObject({
      error: "ssh-mcp exited (code 255): Permission denied (publickey)",
    });
    await expect(remote.read(server())).resolves.toEqual(ok());
    expect(starter.started).toHaveLength(2);
  });

  it("answers after 40 s with the waiting message, and a later read gets the late result", async () => {
    const slow = deferred<ToolCallResult>();
    starter.queue.push(new FakeSessionClient(["exec"], [slow.promise, SAMPLE_ANSWER]));
    const remote = sessions();

    const first = remote.read(server());
    await flush();
    timers.advance(40_000);
    await expect(first).resolves.toEqual({
      id: ID,
      snapshot: null,
      readAt: null,
      error: WAITING_MESSAGE,
    });

    const second = remote.read(server());
    await flush();
    expect(starter.clients[0].calls).toHaveLength(1);
    slow.resolve(SAMPLE_ANSWER);
    await expect(second).resolves.toEqual(ok("2026-11-06T09:00:40.000Z"));
  });

  it("closes the session 2 minutes after the last read", async () => {
    const remote = sessions();
    await remote.read(server());

    timers.advance(119_000);
    await remote.read(server());
    timers.advance(119_000);
    await flush();
    expect(starter.clients[0].closed).toBe(false);

    timers.advance(1_000);
    await flush();
    expect(starter.clients[0].closeCount).toBe(1);

    await remote.read(server());
    expect(starter.started).toHaveLength(2);
  });

  it("keeps a session whose read is still running past the idle time", async () => {
    const slow = deferred<ToolCallResult>();
    starter.queue.push(new FakeSessionClient(["exec"], [slow.promise]));
    const remote = sessions();

    const reading = remote.read(server());
    await flush();
    timers.advance(130_000);
    await flush();
    expect(starter.clients[0].closed).toBe(false);

    slow.resolve(SAMPLE_ANSWER);
    await flush();
    await expect(reading).resolves.toMatchObject({ error: WAITING_MESSAGE });
    timers.advance(120_000);
    await flush();
    expect(starter.clients[0].closeCount).toBe(1);
  });

  it("never starts a server whose config names unset variables", async () => {
    await expect(sessions().read(server({ missingVariables: ["PROD_HOST"] }))).resolves.toEqual({
      id: ID,
      snapshot: null,
      readAt: null,
      error: "The config refers to PROD_HOST, which the daemon's environment does not set",
    });
    expect(starter.started).toEqual([]);
  });

  it("replaces the session when the entry's command, args or env change", async () => {
    const remote = sessions();
    await remote.read(server());

    await remote.read(server({ fingerprint: "b".repeat(64) }));
    await flush();

    expect(starter.clients[0].closeCount).toBe(1);
    expect(starter.started.map((record) => record.server.fingerprint)).toEqual([
      "a".repeat(64),
      "b".repeat(64),
    ]);
  });

  it("closeAll closes every session and later reads get the shutdown message", async () => {
    const remote = sessions();
    await remote.read(server());
    await remote.read(server({ id: "fedcba9876543210", name: "db-box" }));

    await remote.closeAll();

    expect(starter.clients.map((client) => client.closeCount)).toEqual([1, 1]);
    expect(starter.started.every((record) => record.signal.aborted)).toBe(true);
    expect(timers.scheduled).toBe(0);
    await expect(remote.read(server())).resolves.toEqual({
      id: ID,
      snapshot: null,
      readAt: null,
      error: SHUTDOWN_MESSAGE,
    });
    expect(starter.started).toHaveLength(2);
  });

  it("removes stale pid files in its run directory before the first read", async () => {
    mkdirSync(runDir);
    const stale: PidRecord = {
      pgid: 4321,
      startTime: 99,
      ownerPid: 77,
      ownerStartTime: 5,
      pidNamespace: SPACE.pidNamespace,
      bootId: "boot-0",
      initStartTime: 10,
    };
    const file = join(runDir, `${ID}-4321.pid`);
    writeFileSync(file, `${JSON.stringify(stale)}\n`);

    await sessions().ready;

    expect(existsSync(file)).toBe(false);
    expect(logs).toEqual([]);
  });
});
