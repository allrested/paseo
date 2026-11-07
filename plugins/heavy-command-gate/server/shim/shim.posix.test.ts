import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearInterval, clearTimeout, setInterval, setTimeout } from "node:timers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGate, type Gate, type GateDeps } from "../gate.js";
import { gatePaths, type GatePaths } from "../paths.js";
import { readShimRss } from "../procfs.js";
import type { ShimConfig, WaitNotice } from "../protocol.js";
import { listenGateSocket, type GateSocketServer } from "../socket-server.js";
import { installShims, writeShimConfig } from "./install.js";

const GIB = 1024 ** 3;
const SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin";
const WAIT = { timeout: 5_000, interval: 50 };

// Logs its start, with whether it runs held, and its end. GATE_TEST_SLEEP and GATE_TEST_EXIT
// shape the run.
const LOGGING_TOOL = [
  "#!/bin/sh",
  'echo "start $(basename "$0") $* held=${PASEO_HEAVY_GATE_HELD:-unset}" >> "$GATE_TEST_LOG"',
  'sleep "${GATE_TEST_SLEEP:-0}"',
  'echo "end $(basename "$0") $*" >> "$GATE_TEST_LOG"',
  'exit "${GATE_TEST_EXIT:-0}"',
  "",
].join("\n");
// Replaced by sleep itself, so a signal the shim forwards reaches the sleeping process.
const SLEEPING_TOOL = "#!/bin/sh\nexec sleep 30\n";
// Logs its start with $0, the path the shim handed to exec.
const INVOCATION_TOOL = '#!/bin/sh\necho "start $0 $*" >> "$GATE_TEST_LOG"\n';
// A shim that takes another shim for the tool can exec it, and be exec'd back, without end. A run
// that could do so is killed after this long, so the test fails instead of hanging.
const LOOP_LIMIT_MS = 3_000;

const CONFIG: ShimConfig = {
  version: 1,
  enabled: true,
  patterns: [
    { words: ["tsc"], estimateBytes: 3 * GIB },
    { words: ["jest"], estimateBytes: 2 * GIB },
    { words: ["npm", "run", "typecheck"], estimateBytes: 3 * GIB },
  ],
};

interface ShimResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

interface ShimRun {
  child: ChildProcess;
  result: Promise<ShimResult>;
}

interface ShimOptions {
  /** Where the shim starts. The test's temp dir by default. */
  cwd?: string;
  /** Kills the shim with SIGKILL after this long. */
  timeoutMs?: number;
}

let root = "";
let paths: GatePaths = gatePaths("");
let realBin = "";
let logFile = "";
let gate: Gate | null = null;
let server: GateSocketServer | null = null;
let fakeGate: Server | null = null;
const fakeSockets: Socket[] = [];
const children: ChildProcess[] = [];

function writeTool(name: string, text: string): void {
  const file = join(realBin, name);
  writeFileSync(file, text);
  chmodSync(file, 0o755);
}

function readLog(): string[] {
  return existsSync(logFile) ? readFileSync(logFile, "utf8").trim().split("\n") : [];
}

// Slots only (no free-memory reading), one slot, a 1 GB reserve. A test that needs the RSS of the
// running commands passes a reader.
async function startGate(readRss: GateDeps["readRss"] = () => null): Promise<Gate> {
  const deps: GateDeps = {
    now: () => Date.now(),
    readFreeMemory: () => null,
    readRss,
    startTimer(callback, ms) {
      const timer = setInterval(callback, ms);
      return () => clearInterval(timer);
    },
    log: () => undefined,
  };
  const created = createGate({ config: { enabled: true, slots: 1, reserveBytes: GIB }, deps });
  gate = created;
  server = await listenGateSocket({ socketPath: paths.socketPath, gate: created });
  if (server === null) throw new Error("the test socket is taken");
  return created;
}

// A gate that is not the real one: it reads each shim's hello line and then calls `answer`. It
// answers only after the hello, as the real gate does, so its reply cannot race the shim's write.
// Returns the hello lines it has read.
async function startFakeGate(answer: (socket: Socket) => void): Promise<string[]> {
  const hellos: string[] = [];
  const created = createServer((socket) => {
    fakeSockets.push(socket);
    let buffer = "";
    let answered = false;
    socket.setEncoding("utf8");
    // A shim that falls open or is killed can reset the connection. That is not a test failure.
    socket.on("error", () => undefined);
    socket.on("data", (chunk: Buffer | string) => {
      buffer += String(chunk);
      const end = buffer.indexOf("\n");
      if (end < 0 || answered) return;
      answered = true;
      hellos.push(buffer.slice(0, end));
      answer(socket);
    });
  });
  fakeGate = created;
  await new Promise<void>((resolve, reject) => {
    created.once("error", reject);
    created.listen(paths.socketPath, () => resolve());
  });
  return hellos;
}

async function stopFakeGate(): Promise<void> {
  const closing = fakeGate;
  fakeGate = null;
  if (closing === null) return;
  const closed = new Promise<void>((resolve) => closing.close(() => resolve()));
  for (const socket of fakeSockets.splice(0)) socket.destroy();
  await closed;
}

function runShim(
  name: string,
  args: string[],
  env: Record<string, string> = {},
  options: ShimOptions = {},
): ShimRun {
  const child = spawn(join(paths.binDir, name), args, {
    cwd: options.cwd ?? root,
    env: {
      PATH: `${paths.binDir}:${realBin}:${SYSTEM_PATH}`,
      GATE_TEST_LOG: logFile,
      PASEO_AGENT_ID: "agent-1",
      ...env,
    },
    stdio: ["ignore", "ignore", "pipe"],
    timeout: options.timeoutMs,
    killSignal: "SIGKILL",
  });
  children.push(child);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const result = new Promise<ShimResult>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal, stderr }));
  });
  return { child, result };
}

// SIGTERM goes through the shim to the stand-in tool, so no sleep outlives the test.
function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

// A socket file with no listener, as a daemon killed with SIGKILL leaves it.
function leaveStaleSocket(): void {
  const script =
    'const s = require("node:net").createServer(); s.listen(process.argv[1], () => process.kill(process.pid, "SIGKILL"));';
  const result = spawnSync(process.execPath, ["-e", script, paths.socketPath], {
    stdio: "ignore",
    timeout: 10_000,
  });
  if (result.signal !== "SIGKILL") throw new Error("could not leave a stale socket file");
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "heavy-gate-shim-"));
  paths = gatePaths(join(root, "home"));
  realBin = join(root, "real");
  logFile = join(root, "runs.log");
  mkdirSync(paths.home, { mode: 0o700 });
  mkdirSync(realBin);
  writeTool("tsc", LOGGING_TOOL);
  writeTool("npm", LOGGING_TOOL);
  writeTool("jest", SLEEPING_TOOL);
  await installShims({ paths, interpreter: process.execPath });
  await writeShimConfig(paths.configPath, CONFIG);
});

afterEach(async () => {
  await Promise.all(children.splice(0).map(stopChild));
  await stopFakeGate();
  await server?.close();
  gate?.stop();
  server = null;
  gate = null;
  rmSync(root, { recursive: true, force: true });
});

describe("the generated shim", () => {
  it("runs a light command straight, with its arguments and its exit code, without the gate", async () => {
    const run = runShim("npm", ["--version"], { GATE_TEST_EXIT: "3" });
    expect(await run.result).toEqual({ code: 3, signal: null, stderr: "" });
    expect(readLog()).toEqual(["start npm --version held=unset", "end npm --version"]);
  });

  it("runs a heavy command once the gate says go, with PASEO_HEAVY_GATE_HELD=1", async () => {
    await startGate();
    const run = runShim("tsc", ["--noEmit"]);
    expect(await run.result).toEqual({ code: 0, signal: null, stderr: "" });
    expect(readLog()).toEqual(["start tsc --noEmit held=1", "end tsc --noEmit"]);
  });

  it("classifies npm run typecheck as heavy", async () => {
    await startGate();
    const run = runShim("npm", ["run", "typecheck"]);
    expect(await run.result).toEqual({ code: 0, signal: null, stderr: "" });
    expect(readLog()).toEqual(["start npm run typecheck held=1", "end npm run typecheck"]);
  });

  it("tells the gate its command line, agent and pid while it runs", async () => {
    const running = await startGate();
    const run = runShim("tsc", ["--noEmit"], { GATE_TEST_SLEEP: "2" });
    await vi.waitFor(() => expect(running.snapshot().running).toHaveLength(1), WAIT);
    expect(running.snapshot().running[0]).toMatchObject({
      agentId: "agent-1",
      command: "tsc --noEmit",
      pid: run.child.pid,
      estimateBytes: 3 * GIB,
    });
    await run.result;
  });

  // The shim reads its own pid, start time and pid space from /proc, and the gate reads them back
  // with procfs.ts. A pair that disagrees leaves rssBytes null, which turns the accounting of
  // promised memory off without an error. The test's limit is above WAIT.timeout, so a failure
  // reports the null instead of a timeout.
  it.runIf(process.platform === "linux")(
    "lets the gate read the RSS of a running command from the process fields the shim sent",
    async () => {
      const running = await startGate((shim) => readShimRss(shim));
      const run = runShim("jest", []);
      await vi.waitFor(() => {
        expect(running.snapshot().running[0]?.rssBytes).toBeGreaterThan(0);
      }, WAIT);
      run.child.kill("SIGTERM");
      await run.result;
    },
    10_000,
  );

  it("runs two heavy commands one after the other", async () => {
    await startGate();
    const first = runShim("tsc", ["first"], { GATE_TEST_SLEEP: "1" });
    await vi.waitFor(() => expect(readLog()).toContain("start tsc first held=1"), WAIT);
    const second = runShim("tsc", ["second"]);
    expect((await first.result).code).toBe(0);
    expect(await second.result).toEqual({
      code: 0,
      signal: null,
      stderr: "waiting for heavy-command slot (0 ahead, free memory unknown)\n",
    });
    expect(readLog()).toEqual([
      "start tsc first held=1",
      "end tsc first",
      "start tsc second held=1",
      "end tsc second",
    ]);
  });

  it("frees the slot when the holding shim is killed", async () => {
    const running = await startGate();
    const holder = runShim("tsc", ["holder"], { GATE_TEST_SLEEP: "2" });
    await vi.waitFor(() => expect(running.snapshot().running).toHaveLength(1), WAIT);
    const waiter = runShim("tsc", ["waiter"]);
    await vi.waitFor(() => expect(running.snapshot().waiting).toHaveLength(1), WAIT);
    holder.child.kill("SIGKILL");
    expect((await holder.result).signal).toBe("SIGKILL");
    expect((await waiter.result).code).toBe(0);
    expect(readLog()).toContain("start tsc waiter held=1");
  });

  it("lets a nested command through while the slot is held", async () => {
    const running = await startGate();
    runShim("jest", []);
    await vi.waitFor(() => expect(running.snapshot().running).toHaveLength(1), WAIT);
    const nested = runShim("tsc", ["nested"], { PASEO_HEAVY_GATE_HELD: "1" });
    expect(await nested.result).toEqual({ code: 0, signal: null, stderr: "" });
    expect(readLog()).toContain("start tsc nested held=1");
    expect(running.snapshot().waiting).toEqual([]);
  });

  it("passes a signal to the command, dies by it and frees the slot", async () => {
    const running = await startGate();
    const run = runShim("jest", []);
    await vi.waitFor(() => expect(running.snapshot().running).toHaveLength(1), WAIT);
    run.child.kill("SIGTERM");
    expect(await run.result).toEqual({ code: null, signal: "SIGTERM", stderr: "" });
    await vi.waitFor(() => expect(running.snapshot().running).toEqual([]), WAIT);
  });

  it("runs the command after one warning line when no gate listens", async () => {
    const run = runShim("tsc", ["offline"]);
    expect(await run.result).toEqual({
      code: 0,
      signal: null,
      stderr: "heavy-command gate: not reachable (ENOENT), running tsc ungated\n",
    });
    expect(readLog()).toEqual(["start tsc offline held=1", "end tsc offline"]);
  });

  it("runs the command after one warning line when the socket refuses connections", async () => {
    leaveStaleSocket();
    const run = runShim("tsc", ["stale"]);
    expect(await run.result).toEqual({
      code: 0,
      signal: null,
      stderr: "heavy-command gate: not reachable (ECONNREFUSED), running tsc ungated\n",
    });
  });

  it("runs the command after one warning line when the gate never answers", async () => {
    const hellos = await startFakeGate(() => undefined);
    // Long enough that a slow start cannot fire the timer before the shim has sent its hello.
    await installShims({ paths, interpreter: process.execPath, helloTimeoutMs: 1_500 });
    const run = runShim("tsc", ["silent"]);
    expect(await run.result).toEqual({
      code: 0,
      signal: null,
      stderr:
        "heavy-command gate: not reachable (no answer from the daemon), running tsc ungated\n",
    });
    expect(hellos).toHaveLength(1);
    expect(readLog()).toEqual(["start tsc silent held=1", "end tsc silent"]);
  });

  it("runs the command after one warning line when the gate closes the socket after a wait", async () => {
    const notice: WaitNotice = {
      type: "wait",
      ahead: 2,
      freeBytes: Math.round(1.8 * GIB),
      neededBytes: 3 * GIB,
      waitingOn: "memory",
    };
    await startFakeGate((socket) => socket.end(`${JSON.stringify(notice)}\n`));
    const run = runShim("tsc", ["dropped"]);
    expect(await run.result).toEqual({
      code: 0,
      signal: null,
      stderr:
        "waiting for free memory (2 ahead, 1.8 GB free, 3.0 GB needed)\n" +
        "heavy-command gate: not reachable (the daemon closed the connection), running tsc ungated\n",
    });
    expect(readLog()).toEqual(["start tsc dropped held=1", "end tsc dropped"]);
  });

  it("runs heavy commands straight when the gate is switched off", async () => {
    await startGate();
    await writeShimConfig(paths.configPath, { ...CONFIG, enabled: false });
    const run = runShim("tsc", ["off"]);
    expect(await run.result).toEqual({ code: 0, signal: null, stderr: "" });
    expect(readLog()).toEqual(["start tsc off held=unset", "end tsc off"]);
  });

  it("exits 127 when no real binary follows the shim directory", async () => {
    const run = runShim("pytest", [], { PATH: `${paths.binDir}:${realBin}` });
    expect(await run.result).toEqual({
      code: 127,
      signal: null,
      stderr: "heavy-command gate: no pytest on PATH after the shim directory\n",
    });
  });

  it("skips the shim of another gate home on PATH instead of running it as the tool", async () => {
    const other = gatePaths(join(root, "other-home"));
    await installShims({ paths: other, interpreter: process.execPath });
    await writeShimConfig(other.configPath, CONFIG);
    const bothHomes = `${paths.binDir}:${other.binDir}:${realBin}:${SYSTEM_PATH}`;
    const options = { timeoutMs: LOOP_LIMIT_MS };
    const light = runShim("npm", ["--version"], { PATH: bothHomes }, options);
    expect(await light.result).toEqual({ code: 0, signal: null, stderr: "" });
    const heavy = runShim("tsc", ["--noEmit"], { PATH: bothHomes }, options);
    expect(await heavy.result).toEqual({
      code: 0,
      signal: null,
      stderr: "heavy-command gate: not reachable (ENOENT), running tsc ungated\n",
    });
    expect(readLog()).toEqual([
      "start npm --version held=unset",
      "end npm --version",
      "start tsc --noEmit held=1",
      "end tsc --noEmit",
    ]);
  });

  // With process.execve a bare name still reaches the tool through the working directory, so the
  // tool reports how it was started. Where the shim runs the command as a child instead (Node
  // before 22.15), a bare name is looked up on PATH again and finds the shim first.
  it("runs a command found through a relative PATH entry by its full path", async () => {
    writeTool("pytest", INVOCATION_TOOL);
    const run = runShim(
      "pytest",
      ["--version"],
      { PATH: `${paths.binDir}:.:${SYSTEM_PATH}` },
      { cwd: realBin },
    );
    expect(await run.result).toEqual({ code: 0, signal: null, stderr: "" });
    expect(readLog()).toEqual([`start ${join(realpathSync(realBin), "pytest")} --version`]);
  });
});
