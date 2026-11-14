// The Stack tab's readings: this Paseo, FigCraft, the Android device and the newest deploy, each
// checked from this host. A part that is not set up here is "off". Nothing here throws.
import type { Probe, StackReading } from "../shared/stack.js";

export interface StackPorts {
  env: NodeJS.ProcessEnv;
  now(): number;
  uptimeSeconds(): number;
  /** The server package's package.json, where the build has one. */
  packageJson: string | null;
  readText(path: string): Promise<string>;
  /** The HTTP status a GET gets; rejects when nothing answers in time. */
  httpStatus(url: string, timeoutMs: number): Promise<number>;
  /** A command's stdout; rejects on a non-zero exit or a timeout. */
  run(command: string, args: readonly string[], timeoutMs: number): Promise<string>;
  which(name: string): string | null;
}

const PROBE_MS = 5_000;
const COMMAND_MS = 10_000;

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).trim().split("\n")[0] ?? "";
}

async function probe(
  ports: StackPorts,
  url: string,
  ok: (status: number) => boolean,
): Promise<Probe> {
  const started = ports.now();
  try {
    const status = await ports.httpStatus(url, PROBE_MS);
    const ms = ports.now() - started;
    return ok(status) ? { ok: true, ms, error: null } : { ok: false, ms, error: `HTTP ${status}` };
  } catch (error) {
    return { ok: false, ms: null, error: message(error) };
  }
}

async function paseo(ports: StackPorts): Promise<StackReading["paseo"]> {
  let version: string | null = null;
  if (ports.packageJson !== null) {
    try {
      const pkg = JSON.parse(await ports.readText(ports.packageJson)) as {
        name?: unknown;
        version?: unknown;
      };
      if (pkg.name === "@getpaseo/server" && typeof pkg.version === "string") version = pkg.version;
    } catch {
      // A build without the package next to it, as the desktop app.
    }
  }
  return { version, uptimeSeconds: Math.round(ports.uptimeSeconds()) };
}

async function figcraft(ports: StackPorts): Promise<StackReading["figcraft"]> {
  const serverUrl = ports.env.FIGCRAFT_URL;
  if (!serverUrl) return { status: "off" };
  // A WebSocket server answers a plain GET with some HTTP status: any answer means it is up.
  const server = await probe(ports, serverUrl.replace(/^ws/, "http"), () => true);
  const webUrl = ports.env.FIGCRAFT_WEB_URL;
  const web = webUrl ? await probe(ports, webUrl, (status) => status < 400) : null;
  let cliVersion: string | null = null;
  const cli = ports.env.FIGCRAFT_CLI || ports.which("figcraft-cli");
  if (cli) {
    try {
      cliVersion =
        (await ports.run(cli, ["--version"], COMMAND_MS)).trim().split(/\s+/).pop() ?? null;
    } catch {
      cliVersion = null;
    }
  }
  let keyFile: "present" | "missing" | "empty" | "not set" = "not set";
  const keyPath = ports.env.FIGCRAFT_SERVER_KEY_FILE;
  if (keyPath) {
    try {
      keyFile = (await ports.readText(keyPath)).trim() === "" ? "empty" : "present";
    } catch {
      keyFile = "missing";
    }
  }
  return { status: "on", server, web, cliVersion, keyFile };
}

async function android(ports: StackPorts): Promise<StackReading["android"]> {
  const serial = ports.env.PASEO_ANDROID_ADB;
  if (!serial) return { status: "off" };
  const maestro = ports.which("maestro") !== null;
  const adb = ports.which("adb");
  if (adb === null) {
    return {
      status: "on",
      state: null,
      androidVersion: null,
      maestro,
      error: "adb is not on PATH",
    };
  }
  try {
    if (serial.includes(":")) await ports.run(adb, ["connect", serial], COMMAND_MS);
    const state = (await ports.run(adb, ["-s", serial, "get-state"], COMMAND_MS)).trim();
    const androidVersion =
      (
        await ports.run(
          adb,
          ["-s", serial, "shell", "getprop", "ro.build.version.release"],
          COMMAND_MS,
        )
      ).trim() || null;
    return { status: "on", state, androidVersion, maestro, error: null };
  } catch (error) {
    return { status: "on", state: null, androidVersion: null, maestro, error: message(error) };
  }
}

interface RunEntry {
  databaseId: number;
  headBranch: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
}

async function deploy(ports: StackPorts): Promise<StackReading["deploy"]> {
  const repo = ports.env.PASEO_DEPLOY_REPO;
  if (!repo) return { status: "off" };
  const off = {
    status: "on" as const,
    repo,
    tag: null,
    runAt: null,
    docker: null,
    deployJob: null,
  };
  const gh = ports.which("gh");
  if (gh === null) return { ...off, error: "gh is not on PATH" };
  try {
    const runs = JSON.parse(
      await ports.run(
        gh,
        [
          "run",
          "list",
          "--repo",
          repo,
          "--workflow",
          "docker.yml",
          "--limit",
          "30",
          "--json",
          "databaseId,headBranch,status,conclusion,createdAt",
        ],
        COMMAND_MS,
      ),
    ) as RunEntry[];
    const run = runs.find((entry) => /^v\d/.test(entry.headBranch));
    if (!run) return { ...off, error: "No Docker run for a v* tag yet" };
    const { jobs } = JSON.parse(
      await ports.run(
        gh,
        ["run", "view", String(run.databaseId), "--repo", repo, "--json", "jobs"],
        COMMAND_MS,
      ),
    ) as { jobs: { name: string; status: string; conclusion: string | null }[] };
    const job = jobs.find((entry) => entry.name === "deploy");
    return {
      ...off,
      tag: run.headBranch,
      runAt: run.createdAt,
      docker: run.conclusion || run.status,
      deployJob: job ? job.conclusion || job.status : null,
      error: null,
    };
  } catch (error) {
    return { ...off, error: message(error) };
  }
}

export async function readStack(ports: StackPorts): Promise<StackReading> {
  const [paseoPart, figcraftPart, androidPart, deployPart] = await Promise.all([
    paseo(ports),
    figcraft(ports),
    android(ports),
    deploy(ports),
  ]);
  return {
    readAt: new Date(ports.now()).toISOString(),
    paseo: paseoPart,
    figcraft: figcraftPart,
    android: androidPart,
    deploy: deployPart,
  };
}
