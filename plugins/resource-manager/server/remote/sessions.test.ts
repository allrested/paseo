import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostReading, ServerReading } from "../../shared/rpc.js";
import { writeFakeProc, type FakePidSpace } from "../local/fake-proc.js";
import type { PidRecord } from "../pid-files.js";
import type { SshServer } from "./discovery.js";
import { FakeSessionClient, FakeStarter, FakeTimers, SAMPLE_ANSWER } from "./fakes.js";
import { McpSessionError, type ToolCallResult } from "./mcp-stdio-client.js";
import { REMOTE_COMMAND } from "./remote-output.js";
import { REMOTE_OUTPUT_SAMPLE, REMOTE_SNAPSHOT_SAMPLE } from "./remote-output-sample.js";
import { LIST_TOOL, RemoteSessions, SHUTDOWN_MESSAGE, WAITING_MESSAGE } from "./sessions.js";

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

// ssh-mcp 2.24.0 list-connections lines (build/tools/session-tools.js).
const PROD_LINE = "prod: deploy@10.0.0.1:22 [connected] sessions=0 role=operator";
const DB_LINE = "db: root@10.0.0.2:22 [disconnected] sessions=0 role=operator";
const CACHE_LINE = "cache: root@10.0.0.3:22 [disconnected] sessions=0 role=operator";
const REFUSED = "Error (code 255): ssh: connect to host 10.0.0.2 port 22: Connection refused";

function listed(...lines: string[]): ToolCallResult {
  return { isError: false, text: lines.join("\n") };
}

function hostOk(profile: string, label: string, readAt = T0_ISO): HostReading {
  return { profile, label, snapshot: REMOTE_SNAPSHOT_SAMPLE, readAt, error: null };
}

function multi(...hosts: HostReading[]): ServerReading {
  return { id: ID, snapshot: null, readAt: null, error: null, hosts };
}

function runFor(profile?: string): { name: string; args: Record<string, unknown> } {
  const args =
    profile === undefined ? { command: REMOTE_COMMAND } : { command: REMOTE_COMMAND, profile };
  return { name: "run-command", args };
}

/** A 2.x client whose list-connections gives these answers in order; run-command reads. */
function listingClient(...lists: ToolCallResult[]): FakeSessionClient {
  const client = new FakeSessionClient(["read-command", "run-command", LIST_TOOL]);
  client.route = (call) => {
    if (call.name !== LIST_TOOL) return undefined;
    return lists.length > 1 ? lists.shift() : lists[0];
  };
  return client;
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

    await expect(sessions().read(server())).resolves.toStrictEqual(ok());
    expect(starter.clients[0].calls).toEqual([
      { name: "run-command", args: { command: REMOTE_COMMAND } },
    ]);
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

  it("closes a client that died between reads and starts a new one on the next read", async () => {
    const remote = sessions();

    await expect(remote.read(server())).resolves.toEqual(ok());
    starter.clients[0].closed = true;
    await expect(remote.read(server())).resolves.toEqual(ok());
    await flush();

    expect(starter.clients[0].closeCount).toBe(1);
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
      error: "The config refers to PROD_HOST, which is not set in ssh-mcp's environment",
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

describe("RemoteSessions with an ssh-mcp entry of several profiles", () => {
  it("reads every host over one session with its profile, and re-lists hosts on each read", async () => {
    const client = listingClient(
      listed(PROD_LINE, DB_LINE),
      listed(PROD_LINE, DB_LINE, CACHE_LINE),
    );
    starter.queue.push(client);
    const remote = sessions();

    await expect(remote.read(server())).resolves.toStrictEqual(
      multi(hostOk("prod", "deploy@10.0.0.1:22"), hostOk("db", "root@10.0.0.2:22")),
    );
    timers.advance(30_000);
    await expect(remote.read(server())).resolves.toMatchObject({
      hosts: [{ profile: "prod" }, { profile: "db" }, { profile: "cache", error: null }],
    });

    expect(starter.started).toHaveLength(1);
    expect(client.calls).toEqual([
      { name: LIST_TOOL, args: {} },
      runFor("prod"),
      runFor("db"),
      { name: LIST_TOOL, args: {} },
      runFor("prod"),
      runFor("db"),
      runFor("cache"),
    ]);
  });

  it("shows a failed host's error under its last reading, and keeps the other host and the session", async () => {
    const client = listingClient(listed(PROD_LINE, DB_LINE));
    starter.queue.push(client);
    const remote = sessions();
    await remote.read(server());

    client.route = (call) => {
      if (call.name === LIST_TOOL) return listed(PROD_LINE, DB_LINE);
      return call.args.profile === "db" ? { isError: true, text: REFUSED } : undefined;
    };
    timers.advance(30_000);

    await expect(remote.read(server())).resolves.toStrictEqual(
      multi(hostOk("prod", "deploy@10.0.0.1:22", "2026-11-06T09:00:30.000Z"), {
        ...hostOk("db", "root@10.0.0.2:22"),
        error: REFUSED,
      }),
    );
    expect(client.closed).toBe(false);
  });

  it("shows a host's unreadable output as that host's error", async () => {
    const client = listingClient(listed(PROD_LINE, DB_LINE));
    const route = client.route;
    client.route = (call) =>
      call.args.profile === "db" ? { isError: false, text: "garbage" } : route?.(call);
    starter.queue.push(client);

    await expect(sessions().read(server())).resolves.toStrictEqual(
      multi(hostOk("prod", "deploy@10.0.0.1:22"), {
        profile: "db",
        label: "root@10.0.0.2:22",
        snapshot: null,
        readAt: null,
        error: "The output has no meminfo section",
      }),
    );
    expect(client.closed).toBe(false);
  });

  it("keeps the hosts that read when another loses the session, then starts a new one", async () => {
    const lost = new McpSessionError("ssh-mcp did not answer tools/call within 70 s");
    const client = listingClient(listed(PROD_LINE, DB_LINE));
    const route = client.route;
    client.route = (call) => (call.args.profile === "db" ? lost : route?.(call));
    starter.queue.push(client);
    const remote = sessions();

    await expect(remote.read(server())).resolves.toStrictEqual(
      multi(hostOk("prod", "deploy@10.0.0.1:22"), {
        profile: "db",
        label: "root@10.0.0.2:22",
        snapshot: null,
        readAt: null,
        error: lost.message,
      }),
    );
    await flush();
    expect(client.closeCount).toBe(1);

    starter.queue.push(listingClient(listed(PROD_LINE, DB_LINE)));
    await expect(remote.read(server())).resolves.toStrictEqual(
      multi(hostOk("prod", "deploy@10.0.0.1:22"), hostOk("db", "root@10.0.0.2:22")),
    );
    expect(starter.started).toHaveLength(2);
  });

  it("shows the hosts that answered and keeps the rest when the 40 s wait runs out", async () => {
    const client = listingClient(listed(PROD_LINE, DB_LINE));
    starter.queue.push(client);
    const remote = sessions();
    await remote.read(server());

    const slow = deferred<ToolCallResult>();
    const route = client.route;
    client.route = (call) => (call.args.profile === "db" ? slow.promise : route?.(call));
    timers.advance(30_000);
    const waiting = remote.read(server());
    await flush();
    timers.advance(40_000);

    await expect(waiting).resolves.toStrictEqual({
      ...multi(
        hostOk("prod", "deploy@10.0.0.1:22", "2026-11-06T09:00:30.000Z"),
        hostOk("db", "root@10.0.0.2:22"),
      ),
      error: WAITING_MESSAGE,
    });
    slow.resolve(SAMPLE_ANSWER);
    await flush();
  });

  it("shows a list-connections error and keeps each host's last reading and the session", async () => {
    const unconfigured = "No SSH profiles are configured. Write /home/me/.ssh-mcp/config.toml";
    const client = listingClient(listed(PROD_LINE, DB_LINE), {
      isError: true,
      text: unconfigured,
    });
    starter.queue.push(client);
    const remote = sessions();
    await remote.read(server());

    timers.advance(30_000);
    await expect(remote.read(server())).resolves.toStrictEqual({
      ...multi(hostOk("prod", "deploy@10.0.0.1:22"), hostOk("db", "root@10.0.0.2:22")),
      error: unconfigured,
    });
    expect(client.calls.slice(3)).toEqual([{ name: LIST_TOOL, args: {} }]);
    expect(client.closed).toBe(false);
  });

  it("shows a list-connections error on the first read without reading any host", async () => {
    const client = listingClient({ isError: true, text: "Profile store unreadable" });
    starter.queue.push(client);

    await expect(sessions().read(server())).resolves.toStrictEqual({
      id: ID,
      snapshot: null,
      readAt: null,
      error: "Profile store unreadable",
    });
    expect(client.calls).toEqual([{ name: LIST_TOOL, args: {} }]);
  });

  it("reads one profile without a profile argument, as before", async () => {
    const client = listingClient(listed(PROD_LINE));
    starter.queue.push(client);

    await expect(sessions().read(server())).resolves.toStrictEqual(ok());
    expect(client.calls).toEqual([{ name: LIST_TOOL, args: {} }, runFor()]);
  });

  it("reads without a profile argument when list-connections names no host it can read", async () => {
    const client = listingClient(listed("No connections."));
    starter.queue.push(client);

    await expect(sessions().read(server())).resolves.toStrictEqual(ok());
    expect(client.calls).toEqual([{ name: LIST_TOOL, args: {} }, runFor()]);
  });

  it("goes back to one reading when a reload leaves one profile", async () => {
    const client = listingClient(listed(PROD_LINE, DB_LINE), listed(PROD_LINE));
    starter.queue.push(client);
    const remote = sessions();
    await remote.read(server());

    timers.advance(30_000);
    await expect(remote.read(server())).resolves.toStrictEqual(ok("2026-11-06T09:00:30.000Z"));
  });

  it("does not show a host's old reading once a reload gives its profile a new address", async () => {
    const moved = "db: root@10.0.0.9:22 [disconnected] sessions=0 role=operator";
    const client = listingClient(listed(PROD_LINE, DB_LINE));
    starter.queue.push(client);
    const remote = sessions();
    await remote.read(server());

    client.route = (call) => {
      if (call.name === LIST_TOOL) return listed(PROD_LINE, moved);
      return call.args.profile === "db" ? { isError: true, text: REFUSED } : undefined;
    };
    timers.advance(30_000);

    await expect(remote.read(server())).resolves.toMatchObject({
      hosts: [
        { profile: "prod", error: null },
        { profile: "db", label: "root@10.0.0.9:22", snapshot: null, readAt: null, error: REFUSED },
      ],
    });
  });
});
