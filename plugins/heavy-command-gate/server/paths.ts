import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Mirrors resolvePaseoHome in packages/server/src/server/paseo-home.ts, which a plugin bundle
// cannot import: only "~" and a leading "~/" expand, and an unset PASEO_HOME means ~/.paseo.
function expandHomeDir(input: string): string {
  if (input.startsWith("~/")) {
    return join(homedir(), input.slice(2));
  }
  if (input === "~") {
    return homedir();
  }
  return input;
}

// The plugin SDK exposes no data directory, so the gate lives next to the daemon's own state.
// Built-ins run in the daemon process, so process.env is the daemon's env.
export function gateHome(env: NodeJS.ProcessEnv = process.env): string {
  const paseoHome = resolve(expandHomeDir(env.PASEO_HOME ?? "~/.paseo"));
  return join(paseoHome, "heavy-command-gate");
}

export interface GatePaths {
  home: string;
  /** The shim, written at every start. */
  script: string;
  /** One symlink per shimmed command, first on every agent's PATH. */
  binDir: string;
  /** The settings the shims classify against (ShimConfig). */
  configPath: string;
  socketPath: string;
}

export function gatePaths(home: string): GatePaths {
  return {
    home,
    script: join(home, "gate.mjs"),
    binDir: join(home, "bin"),
    configPath: join(home, "config.json"),
    socketPath: join(home, "gate.sock"),
  };
}
