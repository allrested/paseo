import { describe, expect, it, vi, type Mock } from "vitest";
import type { ServerStatus } from "../shared/rpc.js";
import { ServerDefinitionSchema, type ServerDefinition } from "../shared/settings.js";
import type { ExitInfo, RunningProcess } from "./process-runner.js";
import type { ProbeResult } from "./probe.js";
import { Supervisor, TIMING, type SupervisorDeps } from "./supervisor.js";

const T0 = Date.parse("2026-11-06T00:00:00.000Z");

interface FakeTimer {
  at: number;
  seq: number;
  fn: () => void;
  cancelled: boolean;
}

class FakeClock {
  time = T0;
  private seq = 0;
  private timers: FakeTimer[] = [];

  setTimer(fn: () => void, ms: number): () => void {
    const timer: FakeTimer = { at: this.time + ms, seq: this.seq, fn, cancelled: false };
    this.seq += 1;
    this.timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  }

  pending(): number {
    return this.timers.filter((timer) => !timer.cancelled).length;
  }

  // Fires every timer due by now + ms in order, letting each callback's promises settle first.
  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    await flush();
    for (let timer = this.nextDue(end); timer !== null; timer = this.nextDue(end)) {
      this.time = timer.at;
      timer.cancelled = true;
      timer.fn();
      await flush();
    }
    this.time = end;
  }

  private nextDue(end: number): FakeTimer | null {
    const due = this.timers.filter((timer) => !timer.cancelled && timer.at <= end);
    due.sort((a, b) => a.at - b.at || a.seq - b.seq);
    return due[0] ?? null;
  }
}

interface FakeProcess extends RunningProcess {
  def: ServerDefinition;
  answering: boolean;
  alive: boolean;
  stop: Mock<RunningProcess["stop"]>;
  emit(line: string): void;
  exit(info: ExitInfo): void;
}

interface FakeProcessSpec {
  pid: number;
  def: ServerDefinition;
  answering: boolean;
  onLine: (line: string) => void;
}

interface World {
  processes: FakeProcess[];
  externalPorts: Set<number>;
  existingPaths: Set<string>;
  listening: boolean;
}

interface FakeDeps extends SupervisorDeps {
  spawn: Mock<SupervisorDeps["spawn"]>;
  probe: Mock<SupervisorDeps["probe"]>;
  pathExists: Mock<SupervisorDeps["pathExists"]>;
  readRss: Mock<SupervisorDeps["readRss"]>;
}

interface Harness {
  clock: FakeClock;
  world: World;
  deps: FakeDeps;
  supervisor: Supervisor;
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function createFakeProcess(spec: FakeProcessSpec): FakeProcess {
  let resolveExit: (info: ExitInfo) => void = () => {};
  const exited = new Promise<ExitInfo>((resolve) => {
    resolveExit = resolve;
  });
  const proc: FakeProcess = {
    pid: spec.pid,
    def: spec.def,
    exited,
    answering: spec.answering,
    alive: true,
    emit: spec.onLine,
    exit(info) {
      proc.alive = false;
      resolveExit(info);
    },
    stop: vi.fn<RunningProcess["stop"]>(async () => {
      proc.exit({ code: null, signal: "SIGTERM" });
    }),
  };
  return proc;
}

// A port answers when an outside server holds it or a live fake process on it answers. Keying on
// the port, not the id, lets a process that is still shutting down answer for a new definition.
function probeFake(world: World, def: ServerDefinition): ProbeResult {
  const isExternal = world.externalPorts.has(def.port);
  const isAnswering = world.processes.some(
    (proc) => proc.def.port === def.port && proc.alive && proc.answering,
  );
  if (isExternal || isAnswering) return { ok: true, status: 200 };
  return { ok: false, error: `connect ECONNREFUSED 127.0.0.1:${def.port}` };
}

function createHarness(): Harness {
  const clock = new FakeClock();
  const world: World = {
    processes: [],
    externalPorts: new Set(),
    existingPaths: new Set(),
    listening: true,
  };
  const deps: FakeDeps = {
    now: () => clock.time,
    setTimer: (fn, ms) => clock.setTimer(fn, ms),
    spawn: vi.fn<SupervisorDeps["spawn"]>((def, onLine) => {
      const pid = 4000 + world.processes.length;
      const proc = createFakeProcess({ pid, def, answering: world.listening, onLine });
      world.processes.push(proc);
      return proc;
    }),
    probe: vi.fn<SupervisorDeps["probe"]>(async (def) => probeFake(world, def)),
    pathExists: vi.fn<SupervisorDeps["pathExists"]>(async (path) => world.existingPaths.has(path)),
    readRss: vi.fn<SupervisorDeps["readRss"]>(async (pgid) => pgid * 1024),
  };
  return { clock, world, deps, supervisor: new Supervisor(deps) };
}

function definition(overrides: Partial<ServerDefinition> = {}): ServerDefinition {
  return ServerDefinitionSchema.parse({
    id: "ctx",
    label: "Context7",
    command: "npx -y @upstash/context7-mcp --transport http --port 8932",
    port: 8932,
    ...overrides,
  });
}

function latest(world: World, id = "ctx"): FakeProcess {
  const spawned = world.processes.filter((proc) => proc.def.id === id);
  return spawned[spawned.length - 1];
}

async function statusOf(supervisor: Supervisor, id = "ctx"): Promise<ServerStatus> {
  const statuses = await supervisor.status();
  const found = statuses.find((status) => status.id === id);
  if (found === undefined) throw new Error(`no status for ${id}`);
  return found;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

async function retryDelay(harness: Harness): Promise<number> {
  const { nextRetryAt } = await statusOf(harness.supervisor);
  if (nextRetryAt === null) throw new Error("no retry scheduled");
  return Date.parse(nextRetryAt) - harness.clock.time;
}

async function crashNow(harness: Harness): Promise<void> {
  latest(harness.world).exit({ code: 1, signal: null });
  await flush();
}

// Makes the next stop() of this process wait until the returned function is called.
function holdStop(proc: FakeProcess): () => void {
  let release: () => void = () => {};
  proc.stop.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  return () => release();
}

async function crashAndRetry(harness: Harness): Promise<void> {
  await crashNow(harness);
  await harness.clock.advance(await retryDelay(harness));
}

describe("Supervisor", () => {
  it("checks the port, spawns, probes every second until healthy, then every 30 s", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    world.listening = false;
    const ctx = definition();

    await supervisor.apply([ctx]);

    expect(deps.probe).toHaveBeenCalledTimes(1);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(deps.spawn).toHaveBeenCalledWith(ctx, expect.any(Function));
    expect((await statusOf(supervisor)).state).toBe("starting");

    await clock.advance(TIMING.startupProbeMs);
    expect(deps.probe).toHaveBeenCalledTimes(2);
    expect((await statusOf(supervisor)).state).toBe("starting");

    latest(world).answering = true;
    await clock.advance(TIMING.startupProbeMs);
    expect(deps.probe).toHaveBeenCalledTimes(3);
    expect((await statusOf(supervisor)).state).toBe("healthy");

    await clock.advance(TIMING.probeIntervalMs - 1);
    expect(deps.probe).toHaveBeenCalledTimes(3);
    await clock.advance(1);
    expect(deps.probe).toHaveBeenCalledTimes(4);
    expect(deps.probe).toHaveBeenLastCalledWith(ctx);
    expect((await statusOf(supervisor)).state).toBe("healthy");
  });

  it("reports pid, start time, restarts, RSS and the log tail", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    await supervisor.apply([definition()]);
    latest(world).emit("listening on 8932");
    latest(world).emit("ready");
    await clock.advance(TIMING.startupProbeMs);

    expect(await supervisor.status()).toEqual([
      {
        id: "ctx",
        label: "Context7",
        port: 8932,
        state: "healthy",
        pid: 4000,
        startedAt: "2026-11-06T00:00:00.000Z",
        restarts: 0,
        rssBytes: 4000 * 1024,
        lastError: null,
        nextRetryAt: null,
        logTail: ["listening on 8932", "ready"],
      },
    ]);
    expect(deps.readRss).toHaveBeenCalledWith(4000);
  });

  it("kills and restarts a server after two failed probes in a row", async () => {
    const { clock, world, supervisor } = createHarness();
    await supervisor.apply([definition()]);
    await clock.advance(TIMING.startupProbeMs);
    const first = latest(world);
    first.answering = false;

    await clock.advance(TIMING.probeIntervalMs);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "unhealthy",
      pid: 4000,
      lastError: "Health check failed: connect ECONNREFUSED 127.0.0.1:8932",
    });
    expect(first.stop).not.toHaveBeenCalled();

    await clock.advance(TIMING.probeIntervalMs);
    expect(first.stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "backoff",
      pid: null,
      lastError: "Health check failed 2 times in a row: connect ECONNREFUSED 127.0.0.1:8932",
      nextRetryAt: iso(clock.time + TIMING.backoffStartMs),
    });

    await clock.advance(TIMING.backoffStartMs);
    expect(world.processes).toHaveLength(2);
    expect(await statusOf(supervisor)).toMatchObject({ state: "starting", pid: 4001, restarts: 1 });
  });

  it("only restarts on consecutive failed probes", async () => {
    const { clock, world, supervisor } = createHarness();
    await supervisor.apply([definition()]);
    await clock.advance(TIMING.startupProbeMs);
    const first = latest(world);

    first.answering = false;
    await clock.advance(TIMING.probeIntervalMs);
    first.answering = true;
    await clock.advance(TIMING.probeIntervalMs);
    expect((await statusOf(supervisor)).state).toBe("healthy");
    first.answering = false;
    await clock.advance(TIMING.probeIntervalMs);

    expect((await statusOf(supervisor)).state).toBe("unhealthy");
    expect(first.stop).not.toHaveBeenCalled();
    expect(world.processes).toHaveLength(1);
  });

  it("counts a server that is not healthy within 120 s as a crash", async () => {
    const { clock, world, supervisor } = createHarness();
    world.listening = false;
    await supervisor.apply([definition()]);

    await clock.advance(TIMING.startupTimeoutMs - TIMING.startupProbeMs);
    expect(latest(world).stop).not.toHaveBeenCalled();
    expect((await statusOf(supervisor)).state).toBe("starting");

    await clock.advance(TIMING.startupProbeMs);
    expect(latest(world).stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "backoff",
      pid: null,
      startedAt: null,
      lastError: "Not healthy within 120 s: connect ECONNREFUSED 127.0.0.1:8932",
      nextRetryAt: iso(clock.time + TIMING.backoffStartMs),
    });
  });

  it("does not stop a process again after its exit is reported", async () => {
    const harness = createHarness();
    const { clock, world, supervisor } = harness;
    await supervisor.apply([definition()]);
    await clock.advance(TIMING.startupProbeMs);
    const first = latest(world);

    await crashNow(harness);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "backoff",
      pid: null,
      startedAt: null,
      lastError: "Exited with code 1",
    });

    await clock.advance(TIMING.backoffStartMs);
    await supervisor.stopAll();
    expect(first.stop).not.toHaveBeenCalled();
    expect(latest(world).stop).toHaveBeenCalledWith(TIMING.shutdownGraceMs);
  });

  it("backs off from 2 s, doubling to 60 s, and resets after 10 minutes healthy", async () => {
    const harness = createHarness();
    const { clock, supervisor } = harness;
    await supervisor.apply([definition()]);
    const delays: number[] = [];
    for (let crash = 0; crash < 7; crash += 1) {
      await clock.advance(TIMING.startupProbeMs);
      await clock.advance(5 * 60_000);
      await crashNow(harness);
      const delay = await retryDelay(harness);
      delays.push(delay);
      await clock.advance(delay);
    }
    expect(delays).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);

    await clock.advance(TIMING.startupProbeMs);
    await clock.advance(TIMING.backoffResetAfterHealthyMs);
    await crashNow(harness);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "backoff",
      restarts: 7,
      lastError: "Exited with code 1",
    });
    expect(await retryDelay(harness)).toBe(TIMING.backoffStartMs);
  });

  it("marks a server failing after five crashes in ten minutes and retries every five minutes", async () => {
    const harness = createHarness();
    const { clock, world, supervisor } = harness;
    await supervisor.apply([definition()]);
    for (let crash = 1; crash < TIMING.crashLimit; crash += 1) await crashAndRetry(harness);
    expect(world.processes).toHaveLength(TIMING.crashLimit);

    await crashNow(harness);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "failing",
      pid: null,
      lastError: "Exited with code 1",
      nextRetryAt: iso(clock.time + TIMING.failingRetryMs),
    });

    await clock.advance(TIMING.failingRetryMs - 1);
    expect(world.processes).toHaveLength(TIMING.crashLimit);
    await clock.advance(1);
    expect(world.processes).toHaveLength(TIMING.crashLimit + 1);
    expect((await statusOf(supervisor)).state).toBe("starting");

    await crashNow(harness);
    expect((await statusOf(supervisor)).state).toBe("failing");
  });

  it("treats a spawn that throws as a crash", async () => {
    const { clock, deps, supervisor } = createHarness();
    deps.spawn.mockImplementationOnce(() => {
      throw new Error("spawn sh EACCES");
    });

    await supervisor.apply([definition()]);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "backoff",
      pid: null,
      lastError: "spawn sh EACCES",
      nextRetryAt: iso(clock.time + TIMING.backoffStartMs),
    });

    await clock.advance(TIMING.backoffStartMs);
    expect(deps.spawn).toHaveBeenCalledTimes(2);
    expect(await statusOf(supervisor)).toMatchObject({ state: "starting", restarts: 0 });
  });

  it("treats a pre-spawn check that rejects as a crash and retries", async () => {
    const { clock, deps, supervisor } = createHarness();
    deps.probe.mockRejectedValueOnce(new Error("probe exploded"));

    await supervisor.apply([definition()]);
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(await statusOf(supervisor)).toMatchObject({
      state: "backoff",
      pid: null,
      lastError: "probe exploded",
      nextRetryAt: iso(clock.time + TIMING.backoffStartMs),
    });

    await clock.advance(TIMING.backoffStartMs);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(await statusOf(supervisor)).toMatchObject({ state: "starting", restarts: 0 });
  });

  it("stops the process and retries when a health probe rejects", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    await supervisor.apply([definition()]);
    await clock.advance(TIMING.startupProbeMs);
    const first = latest(world);
    deps.probe.mockRejectedValueOnce(new Error("probe exploded"));

    await clock.advance(TIMING.probeIntervalMs);
    expect(first.stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "backoff",
      pid: null,
      lastError: "probe exploded",
    });

    await clock.advance(TIMING.backoffStartMs);
    expect(deps.spawn).toHaveBeenCalledTimes(2);
    expect(await statusOf(supervisor)).toMatchObject({ state: "starting", pid: 4001, restarts: 1 });
  });

  it("waits as blocked while a required path is missing and starts once it appears", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    world.existingPaths.add("/opt/uv");
    await supervisor.apply([definition({ requires: ["/opt/uv", "/opt/serena"] })]);

    expect(deps.pathExists).toHaveBeenCalledWith("/opt/serena");
    expect(deps.probe).not.toHaveBeenCalled();
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(await statusOf(supervisor)).toMatchObject({
      state: "blocked",
      pid: null,
      lastError: "Required path missing: /opt/serena",
      nextRetryAt: null,
    });

    await clock.advance(TIMING.probeIntervalMs);
    expect(deps.pathExists).toHaveBeenCalledTimes(4);
    expect(deps.spawn).not.toHaveBeenCalled();

    world.existingPaths.add("/opt/serena");
    await clock.advance(TIMING.probeIntervalMs);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(await statusOf(supervisor)).toMatchObject({ state: "starting", restarts: 0 });
  });

  it("does not respawn a crashed server while a required path is missing", async () => {
    const harness = createHarness();
    const { clock, world, deps, supervisor } = harness;
    world.existingPaths.add("/opt/serena");
    await supervisor.apply([definition({ requires: ["/opt/serena"] })]);
    await clock.advance(TIMING.startupProbeMs);

    world.existingPaths.delete("/opt/serena");
    await crashNow(harness);
    await clock.advance(TIMING.backoffStartMs);

    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "blocked",
      lastError: "Required path missing: /opt/serena",
    });
  });

  it("adopts a server that already answers on its port and takes over when it goes away", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    world.externalPorts.add(8932);
    await supervisor.apply([definition()]);

    expect(deps.spawn).not.toHaveBeenCalled();
    expect(await statusOf(supervisor)).toMatchObject({
      state: "external",
      pid: null,
      startedAt: null,
      rssBytes: null,
    });
    expect(deps.readRss).not.toHaveBeenCalled();

    await clock.advance(TIMING.probeIntervalMs);
    expect(deps.probe).toHaveBeenCalledTimes(2);
    expect((await statusOf(supervisor)).state).toBe("external");

    world.externalPorts.delete(8932);
    await clock.advance(TIMING.probeIntervalMs);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(await statusOf(supervisor)).toMatchObject({ state: "starting", pid: 4000, restarts: 0 });
  });

  it("keeps a disabled server stopped until it is enabled", async () => {
    const { deps, supervisor } = createHarness();
    await supervisor.apply([definition({ enabled: false })]);

    expect(deps.probe).not.toHaveBeenCalled();
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(await statusOf(supervisor)).toMatchObject({ state: "disabled", pid: null });

    await supervisor.apply([definition()]);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(await statusOf(supervisor)).toMatchObject({ state: "starting", restarts: 0 });
  });

  it("apply leaves unchanged servers alone, restarts changed ones and stops removed or disabled ones", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    await supervisor.apply([
      definition({ id: "a", label: "A", port: 8931 }),
      definition({ id: "b", label: "B", port: 8933 }),
    ]);
    await clock.advance(TIMING.startupProbeMs);
    const [firstA, firstB] = world.processes;

    await supervisor.apply([
      definition({ id: "a", label: "A", port: 8931 }),
      definition({ id: "b", label: "B", port: 8933 }),
    ]);
    expect(deps.spawn).toHaveBeenCalledTimes(2);
    expect(firstA.stop).not.toHaveBeenCalled();

    const changedA = definition({ id: "a", label: "A", port: 8931, command: "npx a --v2" });
    await supervisor.apply([
      changedA,
      definition({ id: "b", label: "B", port: 8933, enabled: false }),
    ]);
    expect(firstA.stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    expect(firstB.stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    expect(deps.spawn).toHaveBeenCalledTimes(3);
    expect(deps.spawn).toHaveBeenLastCalledWith(changedA, expect.any(Function));
    expect(await supervisor.status()).toMatchObject([
      { id: "a", state: "starting", pid: 4002, restarts: 1 },
      { id: "b", state: "disabled", pid: null },
    ]);

    await supervisor.apply([]);
    expect(latest(world, "a").stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    expect(await supervisor.status()).toEqual([]);
  });

  it("apply updates label, healthPath and env key order in place without a restart", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    await supervisor.apply([definition({ env: { A: "1", B: "2" } })]);
    await clock.advance(TIMING.startupProbeMs);
    const first = latest(world);

    const relabelled = definition({
      label: "Context 7",
      healthPath: "/health",
      env: { B: "2", A: "1" },
    });
    await supervisor.apply([relabelled]);
    expect(first.stop).not.toHaveBeenCalled();
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(await statusOf(supervisor)).toMatchObject({
      label: "Context 7",
      state: "healthy",
      pid: 4000,
    });

    await clock.advance(TIMING.probeIntervalMs);
    expect(deps.probe).toHaveBeenLastCalledWith(relabelled);
  });

  it("apply waits for a removed server to stop before starting one on the same port", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    await supervisor.apply([definition()]);
    await clock.advance(TIMING.startupProbeMs);
    const old = latest(world);
    const finishStop = holdStop(old);

    const renaming = supervisor.apply([definition({ id: "ctx2" })]);
    await flush();
    expect(old.stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    expect(deps.probe).toHaveBeenCalledTimes(2);
    expect(deps.spawn).toHaveBeenCalledTimes(1);

    old.exit({ code: null, signal: "SIGTERM" });
    finishStop();
    await renaming;

    expect(deps.spawn).toHaveBeenCalledTimes(2);
    expect(await supervisor.status()).toMatchObject([
      { id: "ctx2", state: "starting", pid: 4001, restarts: 0 },
    ]);
  });

  it("restart(id) stops the server, respawns it at once and counts the restart", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    await supervisor.apply([definition()]);
    await clock.advance(TIMING.startupProbeMs);
    const first = latest(world);

    await supervisor.restart("ctx");

    expect(first.stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    expect(deps.spawn).toHaveBeenCalledTimes(2);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "starting",
      pid: 4001,
      restarts: 1,
      startedAt: iso(clock.time),
    });
  });

  it("restart(id) does not adopt its own process that still answers after stop() resolves", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    await supervisor.apply([definition()]);
    await clock.advance(TIMING.startupProbeMs);
    const old = latest(world);
    // stop() resolves while the process keeps running and answering on the port.
    old.stop.mockResolvedValueOnce(undefined);

    await supervisor.restart("ctx");
    expect(old.stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "backoff",
      pid: null,
      lastError: "Port 8932 still in use after stop",
      nextRetryAt: iso(clock.time + TIMING.backoffStartMs),
    });

    old.exit({ code: null, signal: "SIGTERM" });
    await clock.advance(TIMING.backoffStartMs);
    expect(deps.spawn).toHaveBeenCalledTimes(2);
    expect(await statusOf(supervisor)).toMatchObject({ state: "starting", pid: 4001, restarts: 1 });
  });

  it("does not count the exit that restart(id) causes as a crash", async () => {
    const { clock, world, supervisor } = createHarness();
    await supervisor.apply([definition()]);
    await clock.advance(TIMING.startupProbeMs);
    const old = latest(world);
    const finishStop = holdStop(old);

    const restarting = supervisor.restart("ctx");
    await flush();
    // The server exits with an error code while restart(id) still waits on stop().
    old.exit({ code: 1, signal: null });
    await flush();
    finishStop();
    await restarting;

    expect(await statusOf(supervisor)).toMatchObject({
      state: "starting",
      pid: 4001,
      restarts: 1,
      lastError: null,
      nextRetryAt: null,
    });
  });

  it("restart(id) clears a failing server's crash history", async () => {
    const harness = createHarness();
    const { clock, supervisor } = harness;
    await supervisor.apply([definition()]);
    for (let crash = 1; crash < TIMING.crashLimit; crash += 1) await crashAndRetry(harness);
    await crashNow(harness);
    expect((await statusOf(supervisor)).state).toBe("failing");

    await supervisor.restart("ctx");
    expect(await statusOf(supervisor)).toMatchObject({
      state: "starting",
      lastError: null,
      nextRetryAt: null,
    });

    await crashNow(harness);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "backoff",
      nextRetryAt: iso(clock.time + TIMING.backoffStartMs),
    });
  });

  it("restart(id) refuses unknown, external and disabled servers", async () => {
    const { world, deps, supervisor } = createHarness();
    world.externalPorts.add(8931);
    await supervisor.apply([
      definition({ id: "ext", port: 8931 }),
      definition({ id: "off", port: 8933, enabled: false }),
    ]);

    await expect(supervisor.restart("nope")).rejects.toMatchObject({
      name: "RestartRefusedError",
      serverId: "nope",
      reason: "unknown",
      message: 'Server "nope" is not defined',
    });
    await expect(supervisor.restart("ext")).rejects.toMatchObject({
      serverId: "ext",
      reason: "external",
      message: 'Server "ext" is external: Paseo did not start it, so it cannot restart it',
    });
    await expect(supervisor.restart("off")).rejects.toMatchObject({
      serverId: "off",
      reason: "disabled",
      message: 'Server "off" is disabled: enable it to start it',
    });
    expect(deps.spawn).not.toHaveBeenCalled();
  });

  it("stopAll shortens running stops and stops every owned group at once", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    world.externalPorts.add(8931);
    await supervisor.apply([
      definition({ id: "ext", port: 8931 }),
      definition({ id: "a", port: 8932 }),
      definition({ id: "b", port: 8933 }),
      definition({ id: "c", port: 8934 }),
    ]);
    await clock.advance(TIMING.startupProbeMs);
    const [a, b, c] = world.processes;
    // restart("a") waits on a stop with the 5 s grace.
    const finishRestart = holdStop(a);
    const restarting = supervisor.restart("a");
    await flush();
    expect(a.stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    // Two failed probes start a kill of b that also waits on a stop with the 5 s grace.
    const finishKill = holdStop(b);
    b.answering = false;
    await clock.advance(2 * TIMING.probeIntervalMs);
    expect(b.stop).toHaveBeenCalledWith(TIMING.stopGraceMs);

    // Before its first await, stopAll calls stop() again on the two pending stops, which brings
    // their SIGKILL forward, and once on c.
    const stopping = supervisor.stopAll();
    expect(a.stop).toHaveBeenCalledTimes(2);
    expect(a.stop).toHaveBeenLastCalledWith(TIMING.shutdownGraceMs);
    expect(b.stop).toHaveBeenCalledTimes(2);
    expect(b.stop).toHaveBeenLastCalledWith(TIMING.shutdownGraceMs);
    expect(c.stop).toHaveBeenCalledTimes(1);
    expect(c.stop).toHaveBeenCalledWith(TIMING.shutdownGraceMs);
    // It does not wait for the queued restart.
    await stopping;
    finishRestart();
    finishKill();
    await restarting;
    await flush();

    expect(clock.pending()).toBe(0);
    expect(deps.spawn).toHaveBeenCalledTimes(3);
    expect((await statusOf(supervisor, "ext")).state).toBe("external");
    await supervisor.apply([definition({ id: "d", port: 8935 })]);
    await clock.advance(TIMING.failingRetryMs);
    expect(deps.spawn).toHaveBeenCalledTimes(3);
    expect(deps.probe).toHaveBeenCalledTimes(13);
  });
});
