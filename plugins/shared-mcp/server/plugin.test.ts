import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginRpcContract } from "@getpaseo/plugin";
import type {
  PluginServerContext,
  PluginSessionOpenRequest,
  PluginSettingsState,
} from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { input as ZodInput, output as ZodOutput } from "zod";
import contribute from "../index.server.js";
import { restartRpc, statusRpc, type ServerStatus } from "../shared/rpc.js";
import { sharedMcpSettings, type ServerDefinition } from "../shared/settings.js";
import { createSharedMcp, startTimer } from "./plugin.js";
import type { ProbeResult } from "./probe.js";
import { reclaimOrphan, type ExitInfo, type RunningProcess } from "./process-runner.js";
import { readProcessGroupRss } from "./procfs.js";
import { Supervisor, type SupervisorDeps } from "./supervisor.js";

// Wrapped, not replaced: the real functions run unless a test overrides one. process-runner.test.ts
// and procfs.test.ts cover what the real ones do.
vi.mock("./process-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./process-runner.js")>();
  return { ...actual, reclaimOrphan: vi.fn(actual.reclaimOrphan) };
});
vi.mock("./procfs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./procfs.js")>();
  return { ...actual, readProcessGroupRss: vi.fn(actual.readProcessGroupRss) };
});

type SettingsState = PluginSettingsState<typeof sharedMcpSettings.schema>;
type SettingsListener = (state: SettingsState) => void | Promise<void>;
type RpcHandler = (input: unknown, context: object) => unknown;
type OpenHook = (
  payload: { request: PluginSessionOpenRequest },
  context: { signal: AbortSignal },
) => Promise<PluginSessionOpenRequest | undefined>;

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
}

interface FakeServer {
  context: PluginServerContext;
  settingsIds: string[];
  listeners: Set<SettingsListener>;
  hooks: Map<string, OpenHook>;
  rpcs: Map<string, RpcHandler>;
  resolveRead(state: SettingsState): void;
  emit(state: SettingsState): void;
  call<Contract extends PluginRpcContract>(
    contract: Contract,
    input: ZodInput<Contract["input"]>,
  ): Promise<ZodOutput<Contract["output"]>>;
  openAgent(request: PluginSessionOpenRequest): Promise<PluginSessionOpenRequest | undefined>;
}

interface FakeProcess extends RunningProcess {
  stopCalls: number;
}

interface Spawned {
  def: ServerDefinition;
  proc: FakeProcess;
}

interface FakeDeps {
  deps: Partial<SupervisorDeps>;
  spawned: Spawned[];
}

interface HeldProbe {
  calls: number;
  probe: SupervisorDeps["probe"];
  answer(result: ProbeResult): void;
}

interface RecordingServer {
  port: number;
  authorizations: (string | undefined)[];
  close(): Promise<void>;
}

// Above Linux pid_max, so a group signal sent by mistake can never reach a real process.
const FAKE_PID_BASE = 2_000_000_000;
const GITLAB_BEARER = { serverEnv: "STREAMABLE_HTTP_AUTH_TOKEN", agentEnv: "SHARED_MCP_TOKEN" };
const ALPHA_BEARER = { serverEnv: "ALPHA_SERVER_TOKEN", agentEnv: "ALPHA_TOKEN" };
const BETA_BEARER = { serverEnv: "BETA_SERVER_TOKEN", agentEnv: "BETA_TOKEN" };
const OFF_BEARER = { serverEnv: "OFF_SERVER_TOKEN", agentEnv: "OFF_TOKEN" };
const ECHO_BEARER = { serverEnv: "ECHO_TOKEN", agentEnv: "ECHO_AGENT_TOKEN" };
const REFUSED: ProbeResult = { ok: false, error: "connect ECONNREFUSED" };
const WALK_FAILED = "process tree walk failed, signalling the group only: EACCES";
const THROWN = new Error("thrown by a timer callback");
const REJECTED = new Error("rejected by a timer callback");
// Answers every POST like an MCP initialize and logs whether the probe sent the plugin's token.
const ECHO_SERVER = `
const http = require("node:http");
let sessions = 0;
http
  .createServer((request, response) => {
    request.resume();
    if (request.method === "DELETE") {
      response.writeHead(200);
      response.end();
      return;
    }
    const expected = "Bearer " + process.env.ECHO_TOKEN;
    console.log(request.headers.authorization === expected ? "auth ok" : "auth missing");
    sessions += 1;
    const headers = { "content-type": "application/json", "mcp-session-id": "s" + sessions };
    response.writeHead(200, headers);
    response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
  })
  .listen(Number(process.env.ECHO_PORT), "127.0.0.1");
`;

function noop(): void {}

function throwNow(): void {
  throw THROWN;
}

async function rejectLater(): Promise<void> {
  throw REJECTED;
}

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function deferred<Value>(): Deferred<Value> {
  let settle: (value: Value) => void = noop;
  const promise = new Promise<Value>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve(value) {
      settle(value);
    },
  };
}

function ready(servers: object[]): SettingsState {
  const values = sharedMcpSettings.schema.parse({ servers });
  return { status: "ready", revision: "test", values };
}

function serverDef(id: string, port: number, extra: object = {}): object {
  return { id, label: id, command: `serve-${id}`, port, ...extra };
}

function openRequest(env: Record<string, string> = {}): PluginSessionOpenRequest {
  return {
    agentId: "agent-1",
    workspaceId: null,
    provider: "claude",
    cwd: "/workspace",
    reason: "create",
    purpose: "interactive",
    title: null,
    labels: {},
    tools: [],
    env,
    mcpServers: {},
  };
}

function readToken(home: string): string {
  return readFileSync(join(home, "token"), "utf8").trim();
}

function fakeProcess(pid: number): FakeProcess {
  const exit = deferred<ExitInfo>();
  const proc: FakeProcess = {
    pid,
    exited: exit.promise,
    stopCalls: 0,
    async stop() {
      proc.stopCalls += 1;
      exit.resolve({ code: null, signal: "SIGTERM" });
      await exit.promise;
    },
  };
  return proc;
}

async function refuse(): Promise<ProbeResult> {
  return REFUSED;
}

function fakeDeps(probe: SupervisorDeps["probe"] = refuse): FakeDeps {
  const spawned: Spawned[] = [];
  return {
    spawned,
    deps: {
      // Timers never fire, so the state after apply() holds still while the test looks at it.
      setTimer: () => noop,
      spawn(def) {
        const proc = fakeProcess(FAKE_PID_BASE + spawned.length);
        spawned.push({ def, proc });
        return proc;
      },
      probe,
      pathExists: async () => true,
      readRss: async () => null,
    },
  };
}

function heldProbe(): HeldProbe {
  const pending = deferred<ProbeResult>();
  const held: HeldProbe = {
    calls: 0,
    probe() {
      held.calls += 1;
      return pending.promise;
    },
    answer: pending.resolve,
  };
  return held;
}

function spawnedIds(spawned: Spawned[]): string[] {
  return spawned.map((entry) => entry.def.id);
}

function createFakeServer(initial?: SettingsState): FakeServer {
  const settingsIds: string[] = [];
  const listeners = new Set<SettingsListener>();
  const hooks = new Map<string, OpenHook>();
  const rpcs = new Map<string, RpcHandler>();
  const stored = deferred<SettingsState>();
  if (initial) stored.resolve(initial);
  const settings = {
    read: () => stored.promise,
    subscribe(listener: SettingsListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  // Implements only what createSharedMcp calls.
  const context = {
    registerSettings(definition: { id: string }) {
      settingsIds.push(definition.id);
      return settings;
    },
    handle(contract: { name: string }, handler: RpcHandler) {
      rpcs.set(contract.name, handler);
    },
    addHook(name: string, handler: OpenHook) {
      hooks.set(name, handler);
      return () => {
        hooks.delete(name);
      };
    },
  } as unknown as PluginServerContext;
  return {
    context,
    settingsIds,
    listeners,
    hooks,
    rpcs,
    resolveRead: stored.resolve,
    emit(state) {
      for (const listener of listeners) void listener(state);
    },
    async call(contract, input) {
      const handler = rpcs.get(contract.name);
      if (handler === undefined) throw new Error(`No handler for ${contract.name}`);
      const output = await handler(contract.input.parse(input), {});
      return contract.output.parse(output);
    },
    openAgent(request) {
      const hook = hooks.get("agent.open.before");
      if (hook === undefined) throw new Error("No agent.open.before hook");
      return hook({ request: structuredClone(request) }, { signal: new AbortController().signal });
    },
  };
}

async function statusOf(server: FakeServer, id: string): Promise<ServerStatus | undefined> {
  const { servers } = await server.call(statusRpc, {});
  return servers.find((entry) => entry.id === id);
}

function waitForServer(
  server: FakeServer,
  id: string,
  accept: (status: ServerStatus) => boolean,
  timeout = 1_000,
): Promise<ServerStatus> {
  return vi.waitFor(
    async () => {
      const status = await statusOf(server, id);
      if (status === undefined || !accept(status)) {
        throw new Error(`${id} is not there yet: ${JSON.stringify(status)}`);
      }
      return status;
    },
    { timeout, interval: 50 },
  );
}

async function waitForLogLine(server: FakeServer, id: string, line: string): Promise<void> {
  await vi.waitFor(
    async () => {
      const status = await statusOf(server, id);
      expect(status?.logTail).toContain(line);
    },
    { timeout: 5_000, interval: 50 },
  );
}

function groupOf(status: ServerStatus): number {
  if (status.pid === null) throw new Error(`${status.id} has no pid`);
  return status.pid;
}

function isHealthy(status: ServerStatus): boolean {
  return status.state === "healthy";
}

function isRestarted(status: ServerStatus): boolean {
  return status.state === "healthy" && status.restarts === 1;
}

function isBlocked(status: ServerStatus): boolean {
  return status.state === "blocked";
}

async function freePort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve) => {
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  await new Promise<void>((resolve) => {
    listener.close(() => resolve());
  });
  if (address === null || typeof address === "string") throw new Error("No TCP port assigned");
  return address.port;
}

// Records each request's Authorization header. The first answer is 503, which a probe counts as
// down, so the supervisor spawns. Every later one is 401, as mcp-gitlab answers a request without
// the token, and a probe counts that as alive.
async function startRecordingServer(): Promise<RecordingServer> {
  const authorizations: (string | undefined)[] = [];
  const listener = createHttpServer((request, response) => {
    request.resume();
    authorizations.push(request.headers.authorization);
    response.writeHead(authorizations.length === 1 ? 503 : 401);
    response.end();
  });
  await new Promise<void>((resolve) => {
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  if (address === null || typeof address === "string") throw new Error("No TCP port assigned");
  return {
    port: address.port,
    authorizations,
    close() {
      return new Promise<void>((resolve) => {
        listener.close(() => resolve());
      });
    },
  };
}

describe("createSharedMcp", () => {
  let root: string;
  let home: string;
  let fake: FakeServer | null;
  let stop: (() => Promise<void>) | null;
  let apply: MockInstance<Supervisor["apply"]>;

  function start(initial: SettingsState | undefined, deps: Partial<SupervisorDeps>): FakeServer {
    const server = createFakeServer(initial);
    fake = server;
    stop = createSharedMcp({ server: server.context, home, deps });
    return server;
  }

  async function stopNow(): Promise<void> {
    const cleanup = stop;
    stop = null;
    await cleanup?.();
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "shared-mcp-"));
    home = join(root, "home");
    fake = null;
    stop = null;
    vi.mocked(reclaimOrphan).mockReset();
    vi.mocked(readProcessGroupRss).mockReset();
    apply = vi.spyOn(Supervisor.prototype, "apply");
  });

  afterEach(async () => {
    fake?.resolveRead(ready([]));
    await stopNow();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("registers its settings, both RPCs and one agent.open.before hook before returning", () => {
    const server = start(undefined, fakeDeps().deps);
    expect(server.settingsIds).toEqual(["servers"]);
    expect([...server.rpcs.keys()]).toEqual([
      "shared-mcp.status.request",
      "shared-mcp.restart.request",
    ]);
    expect([...server.hooks.keys()]).toEqual(["agent.open.before"]);
  });

  it("starts the stored servers once the settings are read", async () => {
    const { deps, spawned } = fakeDeps();
    const stored = ready([serverDef("alpha", 18_101)]);
    const server = start(stored, deps);
    await vi.waitFor(() => expect(spawnedIds(spawned)).toEqual(["alpha"]));
    expect(apply).toHaveBeenCalledWith(stored.values.servers);
    expect(existsSync(join(home, "logs"))).toBe(true);
    expect(existsSync(join(home, "run"))).toBe(true);
    expect(await statusOf(server, "alpha")).toMatchObject({
      label: "alpha",
      port: 18_101,
      state: "starting",
      pid: FAKE_PID_BASE,
      restarts: 0,
    });
  });

  it("re-applies every saved settings state", async () => {
    const { deps, spawned } = fakeDeps();
    const alpha = serverDef("alpha", 18_101);
    const beta = serverDef("beta", 18_102);
    const server = start(ready([alpha]), deps);
    await vi.waitFor(() => expect(spawnedIds(spawned)).toEqual(["alpha"]));
    server.emit(ready([alpha, beta]));
    await vi.waitFor(() => expect(spawnedIds(spawned)).toEqual(["alpha", "beta"]));
    server.emit(ready([beta]));
    await vi.waitFor(() => expect(spawned[0].proc.stopCalls).toBe(1));
    server.emit(ready([{ ...beta, enabled: false }]));
    await vi.waitFor(() => expect(spawned[1].proc.stopCalls).toBe(1));
    expect(spawned).toHaveLength(2);
    expect(await statusOf(server, "beta")).toMatchObject({ state: "disabled" });
  });

  it("applies only the newest of several saves that arrive together", async () => {
    const server = start(undefined, fakeDeps().deps);
    server.emit(ready([serverDef("alpha", 18_101)]));
    server.emit(ready([serverDef("beta", 18_102)]));
    const newest = ready([serverDef("gamma", 18_103)]);
    server.emit(newest);
    await vi.waitFor(() => expect(apply).toHaveBeenCalled());
    server.resolveRead(ready([]));
    await stopNow();
    expect(apply.mock.calls).toEqual([[newest.values.servers]]);
  });

  it("keeps a save that lands before the stored settings are read", async () => {
    const server = start(undefined, fakeDeps().deps);
    const saved = ready([serverDef("beta", 18_102, { bearerToken: BETA_BEARER })]);
    server.emit(saved);
    server.resolveRead(ready([serverDef("alpha", 18_101, { bearerToken: ALPHA_BEARER })]));
    const request = openRequest();
    expect(await server.openAgent(request)).toEqual({
      ...request,
      env: { BETA_TOKEN: readToken(home) },
    });
    await vi.waitFor(() => expect(apply).toHaveBeenCalled());
    await stopNow();
    expect(apply.mock.calls).toEqual([[saved.values.servers]]);
  });

  it("keeps waiting for a valid save when the stored settings are invalid", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(noop);
    const server = start(
      { status: "invalid", revision: "bad", error: "Duplicate server port 8931" },
      fakeDeps().deps,
    );
    await server.openAgent(openRequest());
    expect(error).toHaveBeenCalledWith(
      "shared-mcp: settings are invalid: Duplicate server port 8931",
    );
    expect(apply).not.toHaveBeenCalled();
    const saved = ready([serverDef("alpha", 18_101)]);
    server.emit(saved);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(saved.values.servers));
  });

  it("reclaims every leftover pid file before the first apply", async () => {
    const run = join(home, "run");
    mkdirSync(run, { recursive: true });
    for (const name of ["alpha.pid", "beta.pid", "gamma.pid.tmp", "notes.txt"]) {
      writeFileSync(join(run, name), "");
    }
    const error = vi.spyOn(console, "error").mockImplementation(noop);
    const reclaimed = deferred<boolean>();
    // Each reclaim reports a line, as a failed process tree walk does, then waits.
    vi.mocked(reclaimOrphan).mockImplementation((_pidFile, onLine) => {
      onLine?.(WALK_FAILED);
      return reclaimed.promise;
    });
    const server = start(ready([serverDef("alpha", 18_101)]), fakeDeps().deps);
    await vi.waitFor(() => expect(reclaimOrphan).toHaveBeenCalledTimes(2));
    expect(reclaimOrphan).toHaveBeenCalledWith(join(run, "alpha.pid"), expect.any(Function));
    expect(reclaimOrphan).toHaveBeenCalledWith(join(run, "beta.pid"), expect.any(Function));
    await server.openAgent(openRequest());
    expect(apply).not.toHaveBeenCalled();
    reclaimed.resolve(true);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    // Asserted after the reclaim settles, so a failure cannot leave cleanup waiting on it.
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(
      `shared-mcp: reclaim ${join(run, "alpha.pid")}: ${WALK_FAILED}`,
    );
    expect(error).toHaveBeenCalledWith(
      `shared-mcp: reclaim ${join(run, "beta.pid")}: ${WALK_FAILED}`,
    );
  });

  it("logs a pid file it cannot reclaim and still applies the settings", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(noop);
    const run = join(home, "run");
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "alpha.pid"), "");
    const unreadable = new Error("Removed unreadable pid file");
    vi.mocked(reclaimOrphan).mockRejectedValue(unreadable);
    const stored = ready([serverDef("alpha", 18_101)]);
    start(stored, fakeDeps().deps);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(stored.values.servers));
    expect(error).toHaveBeenCalledWith(
      "shared-mcp: reclaiming an orphaned server failed",
      unreadable,
    );
  });

  it("adds the token to the launch env for every bearer server, enabled or not", async () => {
    const server = start(
      ready([
        serverDef("gitlab", 18_103, { bearerToken: GITLAB_BEARER }),
        serverDef("context7", 18_102),
        serverDef("off", 18_104, { enabled: false, bearerToken: OFF_BEARER }),
      ]),
      fakeDeps().deps,
    );
    const request = openRequest({ USER_SET: "1" });
    const opened = await server.openAgent(request);
    const token = readToken(home);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(opened).toEqual({
      ...request,
      env: { USER_SET: "1", SHARED_MCP_TOKEN: token, OFF_TOKEN: token },
    });
    expect(await server.openAgent(request)).toEqual(opened);
  });

  // An agent opened now still has the token when the Servers screen switches the server on.
  it("gives agents the token of a bearer server that is disabled", async () => {
    const server = start(
      ready([serverDef("off", 18_104, { enabled: false, bearerToken: OFF_BEARER })]),
      fakeDeps().deps,
    );
    const request = openRequest();
    expect(await server.openAgent(request)).toEqual({
      ...request,
      env: { OFF_TOKEN: readToken(home) },
    });
    expect(existsSync(join(home, "logs"))).toBe(false);
    expect(existsSync(join(home, "run"))).toBe(false);
  });

  it("leaves the request alone and writes no token without a bearer server", async () => {
    const server = start(
      ready([serverDef("context7", 18_102), serverDef("off", 18_104, { enabled: false })]),
      fakeDeps().deps,
    );
    expect(await server.openAgent(openRequest())).toBeUndefined();
    expect(existsSync(join(home, "token"))).toBe(false);
  });

  it("writes nothing under its home while the server list is empty", async () => {
    const server = start(ready([]), fakeDeps().deps);
    expect(await server.openAgent(openRequest())).toBeUndefined();
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith([]));
    expect(existsSync(home)).toBe(false);
  });

  it("still opens agents when the token cannot be stored", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(noop);
    writeFileSync(home, "a file where the home directory should be");
    const server = start(
      ready([serverDef("gitlab", 18_103, { bearerToken: GITLAB_BEARER })]),
      fakeDeps().deps,
    );
    expect(await server.openAgent(openRequest())).toBeUndefined();
    expect(error).toHaveBeenCalledWith("shared-mcp: token unavailable", expect.any(Error));
  });

  it("reports no RSS instead of failing the status RPC when /proc cannot be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(noop);
    const denied = new Error("EACCES: permission denied, scandir '/proc'");
    vi.mocked(readProcessGroupRss).mockRejectedValue(denied);
    const { deps, spawned } = fakeDeps();
    delete deps.readRss;
    const server = start(ready([serverDef("alpha", 18_101)]), deps);
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    expect(await statusOf(server, "alpha")).toMatchObject({ pid: FAKE_PID_BASE, rssBytes: null });
    expect(readProcessGroupRss).toHaveBeenCalledWith(FAKE_PID_BASE);
    expect(error).toHaveBeenCalledWith("shared-mcp: reading RSS failed", denied);
  });

  it("restarts a server through the restart RPC and reports an unknown id", async () => {
    const { deps, spawned } = fakeDeps();
    const server = start(ready([serverDef("alpha", 18_101)]), deps);
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    expect(await server.call(restartRpc, { id: "alpha" })).toEqual({ ok: true, error: null });
    expect(spawned).toHaveLength(2);
    expect(spawned[0].proc.stopCalls).toBe(1);
    expect(await statusOf(server, "alpha")).toMatchObject({
      pid: FAKE_PID_BASE + 1,
      restarts: 1,
    });
    expect(await server.call(restartRpc, { id: "nope" })).toEqual({
      ok: false,
      error: expect.stringContaining("nope"),
    });
  });

  it("queues a restart behind an apply that is still running", async () => {
    const held = heldProbe();
    const { deps, spawned } = fakeDeps(held.probe);
    const restart = vi.spyOn(Supervisor.prototype, "restart");
    const server = start(ready([serverDef("alpha", 18_101)]), deps);
    await vi.waitFor(() => expect(held.calls).toBe(1));
    const restarting = server.call(restartRpc, { id: "alpha" });
    await nextMacrotask();
    // Read before the probe answers, but asserted after, so a failure cannot leave apply() hanging.
    const restartsWhileApplying = restart.mock.calls.length;
    held.answer(REFUSED);
    expect(await restarting).toEqual({ ok: true, error: null });
    expect(restartsWhileApplying).toBe(0);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(spawnedIds(spawned)).toEqual(["alpha", "alpha"]);
    expect(spawned[0].proc.stopCalls).toBe(1);
  });

  it("refuses a restart once cleanup has begun", async () => {
    const { deps, spawned } = fakeDeps();
    const server = start(ready([serverDef("alpha", 18_101)]), deps);
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    const stopping = stopNow();
    expect(await server.call(restartRpc, { id: "alpha" })).toEqual({
      ok: false,
      error: "shared-mcp is stopping",
    });
    await stopping;
    expect(spawned).toHaveLength(1);
    expect(spawned[0].proc.stopCalls).toBe(1);
  });

  it("cleanup stops what it started, removes its hook and stops listening for saves", async () => {
    const { deps, spawned } = fakeDeps();
    const server = start(ready([serverDef("alpha", 18_101)]), deps);
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    await stopNow();
    expect(spawned[0].proc.stopCalls).toBe(1);
    expect(server.hooks.size).toBe(0);
    expect(server.listeners.size).toBe(0);
  });

  it("cleanup keeps an apply in flight from starting a server", async () => {
    const held = heldProbe();
    const { deps, spawned } = fakeDeps(held.probe);
    start(ready([serverDef("alpha", 18_101)]), deps);
    await vi.waitFor(() => expect(held.calls).toBe(1));
    const stopping = stopNow();
    held.answer(REFUSED);
    await stopping;
    expect(spawned).toEqual([]);
  });

  it("sends the token only to a server process it started and still holds", async () => {
    const recorder = await startRecordingServer();
    try {
      const { deps } = fakeDeps();
      // The real probe and timers run against a fake process.
      delete deps.probe;
      delete deps.setTimer;
      const gitlab = serverDef("gitlab", recorder.port, { bearerToken: GITLAB_BEARER });
      const server = start(ready([gitlab]), deps);
      await waitForServer(server, "gitlab", isHealthy, 5_000);
      expect(await server.call(restartRpc, { id: "gitlab" })).toEqual({ ok: true, error: null });
      // Before the spawn, while the process runs, and after the restart has stopped it.
      const bearer = `Bearer ${readToken(home)}`;
      expect(recorder.authorizations).toEqual([undefined, bearer, undefined]);
      expect(await statusOf(server, "gitlab")).toMatchObject({
        state: "backoff",
        lastError: `Port ${recorder.port} still in use after stop`,
      });
    } finally {
      await stopNow();
      await recorder.close();
    }
  }, 10_000);

  it("keeps its token, log and pid-file directories under $PASEO_HOME/shared-mcp", async () => {
    vi.stubEnv("PASEO_HOME", root);
    const entryHome = join(root, "shared-mcp");
    const missing = join(root, "missing");
    const gitlab = serverDef("gitlab", await freePort(), {
      requires: [missing],
      bearerToken: GITLAB_BEARER,
    });
    const server = createFakeServer(ready([gitlab]));
    fake = server;
    stop = contribute(server.context);
    const request = openRequest();
    expect(await server.openAgent(request)).toEqual({
      ...request,
      env: { SHARED_MCP_TOKEN: readToken(entryHome) },
    });
    const blocked = await waitForServer(server, "gitlab", isBlocked, 5_000);
    expect(blocked.lastError).toContain(missing);
    expect(existsSync(join(entryHome, "logs"))).toBe(true);
    expect(existsSync(join(entryHome, "run"))).toBe(true);
  }, 15_000);

  it.runIf(process.platform === "linux")(
    "keeps a real server healthy and restarts it after its process group is killed",
    async () => {
      writeFileSync(join(root, "echo-server.cjs"), ECHO_SERVER);
      const port = await freePort();
      const echo = serverDef("echo", port, {
        // exec makes node the direct child, so the test process reaps it and the group empties.
        command: `exec ${JSON.stringify(process.execPath)} echo-server.cjs`,
        cwd: root,
        env: { ECHO_PORT: String(port) },
        bearerToken: ECHO_BEARER,
      });
      const server = start(ready([echo]), {});
      const first = await waitForServer(server, "echo", isHealthy, 15_000);
      expect(first.restarts).toBe(0);
      await waitForLogLine(server, "echo", "auth ok");
      process.kill(-groupOf(first), "SIGKILL");
      const second = await waitForServer(server, "echo", isRestarted, 15_000);
      const secondGroup = groupOf(second);
      expect(secondGroup).not.toBe(groupOf(first));
      await stopNow();
      expect(() => process.kill(-secondGroup, 0)).toThrow(/ESRCH/);
    },
    30_000,
  );
});

describe("startTimer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a callback that throws or rejects instead of letting it reach the daemon", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(noop);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      startTimer(throwNow, 0);
      startTimer(rejectLater, 0);
      await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(2));
      await nextMacrotask();
      expect(error.mock.calls).toEqual([
        ["shared-mcp: supervisor timer failed", THROWN],
        ["shared-mcp: supervisor timer failed", REJECTED],
      ]);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
