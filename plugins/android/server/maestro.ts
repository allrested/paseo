// Runs a workspace's Maestro flows against the stack's device, one at a time, for the panel.
// Agents run `maestro` themselves; the two are not coordinated (see the Maestro panel spec).
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Clock } from "./timers.js";
import { errorMessage } from "./errors.js";

export const MAESTRO_LIMIT_MS = 15 * 60 * 1000;
const KEEP_RUNS = 10;
const OUTPUT_LINES = 40;
const MAX_DEPTH = 3;
const FLOW_FOLDERS = new Set([".maestro", "maestro"]);
const SKIPPED = new Set(["node_modules", ".git"]);
const FLOW = /\.ya?ml$/;
const CONFIG = /^config\.ya?ml$/;

export type MaestroStatus = "running" | "passed" | "failed" | "stopped";

export interface MaestroRun {
  id: string;
  flow: string;
  status: MaestroStatus;
  startedAt: number;
  endedAt: number | null;
  failedStep: string | null;
  message: string | null;
  hasPicture: boolean;
  /** The last output lines. */
  output: string[];
}

export interface MaestroRunnerDeps {
  /** The maestro executable. */
  command: string;
  argsBefore?: string[];
  /** The device's adb serial. */
  serial: string;
  /** Where each run keeps its report and debug output. */
  runsDir: string;
  env: NodeJS.ProcessEnv;
  clock: Clock;
  newId(): string;
  log(message: string): void;
}

export interface MaestroRunner {
  /** The workspace's flows, as paths relative to `dir`. */
  flows(dir: string): Promise<string[]>;
  start(input: { dir: string; flow: string }): Promise<{ ok: true } | { ok: false; error: string }>;
  stop(): Promise<void>;
  /** The current run, or the last one; null before the first. */
  state(): MaestroRun | null;
  /** Calls back on every change; the returned function stops it. */
  watch(listener: (run: MaestroRun | null) => void): () => void;
  failurePicture(runId: string): Promise<Buffer | null>;
  close(): Promise<void>;
}

async function listFlows(dir: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(relative: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(join(dir, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIPPED.has(entry.name)) continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (FLOW_FOLDERS.has(entry.name)) {
        const files = await readdir(join(dir, path), { withFileTypes: true });
        for (const file of files) {
          if (file.isFile() && FLOW.test(file.name) && !CONFIG.test(file.name)) {
            found.push(`${path}/${file.name}`);
          }
        }
      } else if (depth < MAX_DEPTH && !entry.name.startsWith(".")) {
        await walk(path, depth + 1);
      }
    }
  }
  await walk("", 1);
  return found.sort();
}

/** The step Maestro printed as failed, without its "... FAILED" tail. */
function failedStep(lines: string[]): string | null {
  for (let index = lines.length - 1; index >= 0; index--) {
    const match = /^(.*?)\.\.\.\s*FAILED\s*$/.exec(lines[index]);
    if (match) return match[1].trim();
  }
  return null;
}

function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** The first failure's message in a JUnit report: its message attribute, or its text. */
async function reportMessage(path: string): Promise<string | null> {
  let xml: string;
  try {
    xml = await readFile(path, "utf8");
  } catch {
    return null;
  }
  const failure = /<failure\b([^>]*)>([\s\S]*?)<\/failure>|<failure\b([^>]*)\/>/.exec(xml);
  if (!failure) return null;
  const attributes = failure[1] ?? failure[3] ?? "";
  const attribute = /\bmessage="([^"]*)"/.exec(attributes)?.[1];
  const text = (attribute ?? failure[2] ?? "").trim();
  return text ? decode(text) : null;
}

/** The newest PNG Maestro saved in the run's debug folder. */
async function newestPicture(debugDir: string): Promise<string | null> {
  let names: string[];
  try {
    names = (await readdir(debugDir)).filter((name) => name.endsWith(".png"));
  } catch {
    return null;
  }
  let newest: { path: string; time: number } | null = null;
  for (const name of names) {
    const path = join(debugDir, name);
    const time = (await stat(path)).mtimeMs;
    if (!newest || time >= newest.time) newest = { path, time };
  }
  return newest?.path ?? null;
}

export function createMaestroRunner(deps: MaestroRunnerDeps): MaestroRunner {
  let current: MaestroRun | null = null;
  let child: ChildProcess | null = null;
  let stopReason: string | null = null;
  let cancelLimit: () => void = () => undefined;
  const pictures = new Map<string, string>();
  const listeners = new Set<(run: MaestroRun | null) => void>();

  function changed(): void {
    const snapshot = current ? { ...current, output: [...current.output] } : null;
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        deps.log(`[android] maestro watcher failed: ${errorMessage(error)}`);
      }
    }
  }

  async function prune(): Promise<void> {
    const names = (await readdir(deps.runsDir)).sort((a, b) => b.localeCompare(a));
    for (const name of names.slice(KEEP_RUNS)) {
      await rm(join(deps.runsDir, name), { recursive: true, force: true });
      pictures.delete(name);
    }
  }

  async function finish(run: MaestroRun, code: number | null, runDir: string): Promise<void> {
    cancelLimit();
    child = null;
    if (stopReason !== null) {
      run.status = "stopped";
      run.message = stopReason;
    } else if (code === 0) {
      run.status = "passed";
    } else {
      run.status = "failed";
      run.failedStep = failedStep(run.output);
      run.message =
        (await reportMessage(join(runDir, "report.xml"))) ?? `maestro exited with ${code}`;
      const picture = await newestPicture(join(runDir, "debug"));
      if (picture) {
        pictures.set(run.id, picture);
        run.hasPicture = true;
      }
    }
    run.endedAt = deps.clock.now();
    changed();
    await prune().catch((error: unknown) =>
      deps.log(`[android] pruning Maestro runs failed: ${errorMessage(error)}`),
    );
  }

  return {
    flows: listFlows,
    async start({ dir, flow }) {
      if (current?.status === "running") return { ok: false, error: "A flow is already running" };
      if (!(await listFlows(dir)).includes(flow)) {
        return { ok: false, error: "No such flow in this workspace" };
      }
      const id = deps.newId();
      const runDir = join(deps.runsDir, id);
      await mkdir(runDir, { recursive: true });
      const run: MaestroRun = {
        id,
        flow,
        status: "running",
        startedAt: deps.clock.now(),
        endedAt: null,
        failedStep: null,
        message: null,
        hasPicture: false,
        output: [],
      };
      current = run;
      stopReason = null;
      const args = [
        ...(deps.argsBefore ?? []),
        "--device",
        deps.serial,
        "test",
        flow,
        "--format",
        "JUNIT",
        "--output",
        join(runDir, "report.xml"),
        "--debug-output",
        join(runDir, "debug"),
        "--flatten-debug-output",
        "--no-ansi",
      ];
      const started = spawn(deps.command, args, { cwd: dir, env: deps.env, stdio: "pipe" });
      child = started;
      let pending = "";
      const take = (chunk: Buffer) => {
        pending += chunk.toString("utf8");
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        const added = lines.filter((line) => line.trim() !== "");
        if (added.length === 0) return;
        run.output = [...run.output, ...added].slice(-OUTPUT_LINES);
        changed();
      };
      started.stdout?.on("data", take);
      started.stderr?.on("data", take);
      started.once("error", (error) => {
        run.output = [...run.output, `maestro did not start: ${error.message}`].slice(
          -OUTPUT_LINES,
        );
      });
      started.once("close", (code) => {
        if (pending.trim()) run.output = [...run.output, pending].slice(-OUTPUT_LINES);
        void finish(run, code, runDir).catch((error: unknown) =>
          deps.log(`[android] Maestro run ${id} failed to finish: ${errorMessage(error)}`),
        );
      });
      cancelLimit = deps.clock.setTimeout(() => {
        stopReason = "Stopped after 15 minutes";
        child?.kill("SIGTERM");
      }, MAESTRO_LIMIT_MS);
      changed();
      return { ok: true };
    },
    async stop() {
      if (current?.status !== "running" || child === null) return;
      stopReason = "Stopped";
      child.kill("SIGTERM");
    },
    state: () => (current ? { ...current, output: [...current.output] } : null),
    watch(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async failurePicture(runId) {
      const path = pictures.get(runId);
      if (!path) return null;
      try {
        return await readFile(path);
      } catch {
        return null;
      }
    },
    async close() {
      cancelLimit();
      child?.kill("SIGTERM");
      listeners.clear();
    },
  };
}
