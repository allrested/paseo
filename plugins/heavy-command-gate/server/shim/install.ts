import { accessSync, constants, statSync } from "node:fs";
import { chmod, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { gbToBytes, type GateSettings } from "../../shared/settings.js";
import type { GatePaths } from "../paths.js";
import { HELD_ENV, type ShimConfig } from "../protocol.js";
import { classifyCommand } from "./classify.js";
import { runShim } from "./run-shim.js";

/** The spec's shimmed commands. `pytest` has no default pattern; a user pattern can gate it. */
export const SHIMMED_COMMANDS: readonly string[] = [
  "npm",
  "npx",
  "pnpm",
  "tsc",
  "tsgo",
  "vitest",
  "jest",
  "gradle",
  "gradlew",
  "pytest",
];

/** How long a shim waits for the gate's first answer before it runs the command ungated. */
export const HELLO_TIMEOUT_MS = 10_000;

// Linux reads at most 255 bytes of a #! line (BINPRM_BUF_SIZE 256), macOS about 510.
const MAX_INTERPRETER_LENGTH = 200;

export type InterpreterResult = { ok: true; path: string } | { ok: false; reason: string };

export interface InterpreterProbe {
  execPath: string;
  isElectron: boolean;
  pathEnv: string | undefined;
  platform: NodeJS.Platform;
  isExecutable(file: string): boolean;
}

export function currentInterpreterProbe(): InterpreterProbe {
  return {
    execPath: process.execPath,
    isElectron: process.versions.electron !== undefined,
    pathEnv: process.env.PATH,
    platform: process.platform,
    isExecutable(file) {
      try {
        accessSync(file, constants.X_OK);
        return statSync(file).isFile();
      } catch {
        return false;
      }
    },
  };
}

// Under Electron, execPath is the app binary, which runs as node only with ELECTRON_RUN_AS_NODE
// set, and a #! line cannot set it.
function findNodeOnPath(probe: InterpreterProbe): string | null {
  for (const entry of (probe.pathEnv ?? "").split(delimiter)) {
    if (!entry.startsWith("/")) continue;
    const candidate = join(entry, "node");
    if (probe.isExecutable(candidate)) return candidate;
  }
  return null;
}

/** The node the #! line names, or why the gate cannot run on this system. */
export function resolveShimInterpreter(
  probe: InterpreterProbe = currentInterpreterProbe(),
): InterpreterResult {
  if (probe.platform === "win32") return { ok: false, reason: "PATH shims need a POSIX system" };
  const path = probe.isElectron ? findNodeOnPath(probe) : probe.execPath;
  if (path === null) return { ok: false, reason: "no node binary on the daemon PATH" };
  if (/\s/.test(path)) {
    return {
      ok: false,
      reason: `the node path ${path} contains whitespace, which a #! line cannot hold`,
    };
  }
  if (path.length > MAX_INTERPRETER_LENGTH) {
    return {
      ok: false,
      reason: `the node path is longer than ${MAX_INTERPRETER_LENGTH} characters, more than a #! line can hold`,
    };
  }
  return { ok: true, path };
}

export function toShimConfig(values: GateSettings): ShimConfig {
  return {
    version: 1,
    enabled: values.enabled,
    patterns: values.patterns.map((pattern) => ({
      words: pattern.command.split(" "),
      estimateBytes: gbToBytes(pattern.estimateGb),
    })),
  };
}

export interface ShimScriptOptions {
  interpreter: string;
  socketPath: string;
  configPath: string;
  /** A test seam: HELLO_TIMEOUT_MS unless a test shortens it. The plugin never sets it. */
  helloTimeoutMs?: number;
}

/** gate.mjs: a bootstrap around the source text of classifyCommand and runShim. */
export function buildShimScript(options: ShimScriptOptions): string {
  return [
    `#!${options.interpreter}`,
    "// Written by the Paseo heavy-command-gate plugin at every daemon start. Edits are overwritten.",
    'import * as childProcess from "node:child_process";',
    'import * as fs from "node:fs";',
    'import * as net from "node:net";',
    'import * as os from "node:os";',
    'import * as path from "node:path";',
    "",
    `const classify = ${classifyCommand.toString()};`,
    "",
    `const runShim = ${runShim.toString()};`,
    "",
    "runShim({",
    "  argv: process.argv,",
    "  env: process.env,",
    "  process,",
    "  childProcess,",
    "  fs,",
    "  net,",
    "  os,",
    "  path,",
    '  execve: typeof process.execve === "function" ? process.execve.bind(process) : null,',
    "  classify,",
    `  socketPath: ${JSON.stringify(options.socketPath)},`,
    `  configPath: ${JSON.stringify(options.configPath)},`,
    `  heldEnv: ${JSON.stringify(HELD_ENV)},`,
    `  helloTimeoutMs: ${options.helloTimeoutMs ?? HELLO_TIMEOUT_MS},`,
    "});",
    "",
  ].join("\n");
}

// A shim starting mid-write sees the old file or the new one, never half of one.
async function writeAtomic(path: string, text: string, mode: number): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text, { mode });
  // writeFile's mode passes through the umask; chmod sets it exactly.
  await chmod(temporary, mode);
  await rename(temporary, path);
}

export interface InstallOptions {
  paths: GatePaths;
  interpreter: string;
  /** Passed to buildShimScript; see ShimScriptOptions. */
  helloTimeoutMs?: number;
}

export async function installShims(options: InstallOptions): Promise<void> {
  const { paths } = options;
  await mkdir(paths.binDir, { recursive: true, mode: 0o700 });
  const script = buildShimScript({
    interpreter: options.interpreter,
    socketPath: paths.socketPath,
    configPath: paths.configPath,
    helloTimeoutMs: options.helloTimeoutMs,
  });
  await writeAtomic(paths.script, script, 0o700);
  for (const name of SHIMMED_COMMANDS) {
    const link = join(paths.binDir, name);
    const temporary = `${link}.${process.pid}.tmp`;
    await rm(temporary, { force: true });
    // Relative, so the links keep working when the home is moved.
    await symlink("../gate.mjs", temporary);
    await rename(temporary, link);
  }
}

export async function writeShimConfig(path: string, config: ShimConfig): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(config)}\n`, 0o600);
}
