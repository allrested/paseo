import { access, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import type { RpcOutput } from "@getpaseo/plugin";
import type {
  PluginServerContext,
  PluginSessionOpenRequest,
  PluginSettings,
  PluginSettingsState,
} from "@getpaseo/plugin/server";
import { restartRpc, statusRpc } from "../shared/rpc.js";
import { sharedMcpSettings, type ServerDefinition } from "../shared/settings.js";
import { probeMcp, type ProbeTarget } from "./probe.js";
import { readProcessGroupRss } from "./procfs.js";
import { reclaimOrphan, spawnServer, type RunningProcess } from "./process-runner.js";
import { Supervisor, TIMING, type SupervisorDeps } from "./supervisor.js";
import { loadOrCreateToken } from "./token-store.js";

type SettingsSchema = typeof sharedMcpSettings.schema;
type SettingsState = PluginSettingsState<SettingsSchema>;
type RestartResult = RpcOutput<typeof restartRpc>;

export interface SharedMcpOptions {
  server: PluginServerContext;
  home: string;
  deps?: Partial<SupervisorDeps>;
}

interface TokenSource {
  current(): string | null;
  load(): Promise<string | null>;
}

interface SharedMcp {
  readonly home: string;
  readonly token: TokenSource;
  readonly supervisor: Supervisor;
  current: ServerDefinition[];
  pending: ServerDefinition[] | null;
  applying: Promise<void>;
  stopped: boolean;
}

/**
 * Registers everything the runtime snapshots at "ready" (settings, both RPCs, the agent hook)
 * before returning. Reading settings, reclaiming orphans and starting servers run afterwards.
 */
export function createSharedMcp(options: SharedMcpOptions): () => Promise<void> {
  const { server, home } = options;
  const token = createTokenSource(home);
  const mcp: SharedMcp = {
    home,
    token,
    supervisor: new Supervisor(createDeps(home, token, options.deps)),
    current: [],
    pending: null,
    // Applies and restarts queue behind the reclaim, so a group left by a dead daemon frees its
    // port first.
    applying: reclaimOrphans(join(home, "run")),
    stopped: false,
  };
  const settings = server.registerSettings(sharedMcpSettings);
  let superseded = false;
  // subscribe() never replays the stored value: read() supplies it unless a save arrived first.
  const unsubscribe = settings.subscribe((state) => {
    superseded = true;
    acceptSettings(mcp, state);
  });
  const initialRead = readStoredSettings(settings, (state) => {
    if (!superseded) acceptSettings(mcp, state);
  });
  // One hook for the plugin's lifetime: adding or removing it reloads every agent's session.
  const removeHook = server.addHook("agent.open.before", async ({ request }) => {
    await initialRead;
    return addAgentTokens(mcp, request);
  });
  server.handle(statusRpc, async () => ({ servers: await mcp.supervisor.status() }));
  server.handle(restartRpc, ({ id }) => restartServer(mcp, id));
  return async function cleanup(): Promise<void> {
    mcp.stopped = true;
    unsubscribe();
    removeHook();
    // The daemon waits only about 2 s for an in-process plugin: signal every group first. The
    // supervisor spawns nothing once stopAll() has begun, so an apply still running starts no
    // server; waiting for it only keeps queued work from outliving cleanup.
    await mcp.supervisor.stopAll();
    await initialRead;
    await mcp.applying;
  };
}

function acceptSettings(mcp: SharedMcp, state: SettingsState): void {
  if (state.status === "invalid") {
    // Running servers stay up; the Definitions screen shows the same error.
    console.error(`shared-mcp: settings are invalid: ${state.error}`);
    return;
  }
  mcp.current = state.values.servers;
  mcp.pending = state.values.servers;
  mcp.applying = mcp.applying.then(() => applyPending(mcp));
}

// Listeners are not awaited or serialized, so saves queue here and only the newest applies.
async function applyPending(mcp: SharedMcp): Promise<void> {
  const defs = mcp.pending;
  mcp.pending = null;
  if (defs === null) return;
  if (mcp.stopped) return;
  try {
    await prepareHome(mcp, defs);
    if (mcp.stopped) return;
    await mcp.supervisor.apply(defs);
  } catch (error) {
    // The plugin runs inside the daemon, which exits on an unhandled rejection.
    console.error("shared-mcp: applying servers failed", error);
  }
}

// Logs and pid files appear only once something will run; an empty list writes nothing.
async function prepareHome(mcp: SharedMcp, defs: ServerDefinition[]): Promise<void> {
  if (!defs.some((def) => def.enabled)) return;
  await mkdir(join(mcp.home, "logs"), { recursive: true, mode: 0o700 });
  await mkdir(join(mcp.home, "run"), { recursive: true, mode: 0o700 });
  // spawn() is synchronous, so the token has to be in memory before the supervisor starts.
  if (hasBearerServer(defs)) await mcp.token.load();
}

// Queued with the applies, so a Restart click cannot interleave with a settings save.
async function restartServer(mcp: SharedMcp, id: string): Promise<RestartResult> {
  const run = mcp.applying.then(() => restartUnlessStopped(mcp, id));
  mcp.applying = run.catch(() => undefined);
  try {
    await run;
    return { ok: true, error: null };
  } catch (error) {
    // A refusal comes back as data, so the screen shows it without the RPC error prefix.
    return { ok: false, error: describeError(error) };
  }
}

async function restartUnlessStopped(mcp: SharedMcp, id: string): Promise<void> {
  // Once cleanup has begun the supervisor spawns nothing, so a restart would report success
  // without starting the server.
  if (mcp.stopped) throw new Error("shared-mcp is stopping");
  await mcp.supervisor.restart(id);
}

// Disabled servers count too. Agents get their env only when they open, and the hook never
// changes presence, so an agent opened while a server is disabled must already hold its token
// when the server is switched back on.
async function addAgentTokens(
  mcp: SharedMcp,
  request: PluginSessionOpenRequest,
): Promise<PluginSessionOpenRequest | undefined> {
  if (!hasBearerServer(mcp.current)) return undefined;
  const token = await mcp.token.load();
  if (token === null) return undefined;
  // The daemon replaces env with the returned map, so the launch env is carried over.
  const env = { ...request.env, ...agentTokenEnv(mcp.current, token) };
  return { ...request, env };
}

function hasBearerServer(defs: ServerDefinition[]): boolean {
  return defs.some((def) => def.bearerToken !== undefined);
}

function agentTokenEnv(defs: ServerDefinition[], token: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const def of defs) {
    if (def.bearerToken) env[def.bearerToken.agentEnv] = token;
  }
  return env;
}

function serverEnv(def: ServerDefinition, token: string | null): Record<string, string> {
  if (def.bearerToken === undefined || token === null) return def.env;
  return { ...def.env, [def.bearerToken.serverEnv]: token };
}

// bearer is null unless the plugin holds the process on this port (createDeps).
function probeTarget(def: ServerDefinition, bearer: string | null): ProbeTarget {
  const target: ProbeTarget = { port: def.port, healthPath: def.healthPath };
  if (def.bearerToken !== undefined && bearer !== null) target.bearerToken = bearer;
  return target;
}

async function readStoredSettings(
  settings: PluginSettings<SettingsSchema>,
  accept: (state: SettingsState) => void,
): Promise<void> {
  try {
    accept(await settings.read());
  } catch (error) {
    console.error("shared-mcp: reading settings failed", error);
  }
}

// Runs before any supervisor entry exists, so a reclaim's own report goes to the daemon log.
async function reclaimOrphans(runDirectory: string): Promise<void> {
  const pidFiles = await listPidFiles(runDirectory);
  const reclaims = pidFiles.map((name) => reclaimPidFile(join(runDirectory, name)));
  const results = await Promise.allSettled(reclaims);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("shared-mcp: reclaiming an orphaned server failed", result.reason);
    }
  }
}

// A process tree walk that fails during the kill is reported, never silent.
function reclaimPidFile(pidFile: string): Promise<boolean> {
  return reclaimOrphan(pidFile, (line) => {
    console.error(`shared-mcp: reclaim ${pidFile}: ${line}`);
  });
}

// Only "*.pid": a "<id>.pid.tmp" left by a crash mid-write names no group.
async function listPidFiles(runDirectory: string): Promise<string[]> {
  try {
    const names = await readdir(runDirectory);
    return names.filter((name) => name.endsWith(".pid"));
  } catch (error) {
    if (!isMissing(error)) console.error("shared-mcp: listing pid files failed", error);
    return [];
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function createTokenSource(home: string): TokenSource {
  let value: string | null = null;
  let loading: Promise<string | null> | null = null;
  async function read(): Promise<string | null> {
    try {
      await mkdir(home, { recursive: true, mode: 0o700 });
      value = await loadOrCreateToken(join(home, "token"));
      return value;
    } catch (error) {
      // Agents keep opening; the servers that need the token report their own failure.
      console.error("shared-mcp: token unavailable", error);
      loading = null;
      return null;
    }
  }
  return {
    current() {
      return value;
    },
    load() {
      loading ??= read();
      return loading;
    },
  };
}

function createDeps(
  home: string,
  token: TokenSource,
  overrides: Partial<SupervisorDeps> = {},
): SupervisorDeps {
  // Ids whose process this plugin spawned and has not let go of, the span in which the supervisor's
  // entry holds a child. Only their probes carry the token: whatever else answers on the port, an
  // "external" server or a process still there after a stop, may be any local program. A bearer
  // server answers a probe without the token with 401, which still counts as alive.
  const owned = new Map<string, RunningProcess>();
  const deps: SupervisorDeps = {
    now() {
      return Date.now();
    },
    setTimer: startTimer,
    spawn(def, onLine) {
      return spawnServer({
        command: def.command,
        cwd: def.cwd,
        env: serverEnv(def, token.current()),
        logFile: join(home, "logs", `${def.id}.log`),
        pidFile: join(home, "run", `${def.id}.pid`),
        onLine,
      });
    },
    probe(def) {
      const bearer = owned.has(def.id) ? token.current() : null;
      return probeMcp(probeTarget(def, bearer), { timeoutMs: TIMING.probeTimeoutMs });
    },
    pathExists,
    async readRss(pgid) {
      try {
        return await readProcessGroupRss(pgid);
      } catch (error) {
        // procfs.ts rejects on errors such as EACCES. One unreadable /proc must not fail status().
        console.error("shared-mcp: reading RSS failed", error);
        return null;
      }
    },
    ...overrides,
  };
  const startProcess = deps.spawn;
  // Wrapped after the overrides, so a test's fake process is tracked like a spawned one.
  deps.spawn = (def, onLine) => holdWhileRunning(owned, def.id, startProcess(def, onLine));
  return deps;
}

// The supervisor lets go of a process just before it calls stop() and once exited settles, so the
// id leaves `owned` at the same two points. An old process that exits after its replacement was
// spawned leaves the replacement's entry alone.
function holdWhileRunning(
  owned: Map<string, RunningProcess>,
  id: string,
  proc: RunningProcess,
): RunningProcess {
  owned.set(id, proc);
  function release(): void {
    if (owned.get(id) === proc) owned.delete(id);
  }
  // exited never rejects (process-runner.ts), and release cannot throw.
  void proc.exited.then(release);
  return {
    pid: proc.pid,
    exited: proc.exited,
    stop(graceMs) {
      release();
      return proc.stop(graceMs);
    },
  };
}

/** The real SupervisorDeps.setTimer. */
export function startTimer(fn: () => void, ms: number): () => void {
  const timer = setTimeout(() => runGuarded(fn), ms);
  // A pending probe must not keep the daemon, or a test process, alive.
  timer.unref();
  return () => clearTimeout(timer);
}

// A throw from a timer callback is an uncaught exception, and a rejection from an async one is an
// unhandled rejection. The daemon exits on either, so both are caught here.
function runGuarded(fn: () => void): void {
  try {
    const result: unknown = fn();
    if (result instanceof Promise) result.catch(reportTimerFailure);
  } catch (error) {
    reportTimerFailure(error);
  }
}

function reportTimerFailure(error: unknown): void {
  console.error("shared-mcp: supervisor timer failed", error);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
