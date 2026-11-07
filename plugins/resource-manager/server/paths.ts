import { join, resolve } from "node:path";

// Mirrors resolvePaseoHome in packages/server/src/server/paseo-home.ts, which a plugin bundle
// cannot import: only "~" and a leading "~/" expand, and an unset PASEO_HOME means ~/.paseo.
export function expandHomeDir(input: string, home: string): string {
  if (input.startsWith("~/")) return join(home, input.slice(2));
  if (input === "~") return home;
  return input;
}

// Built-ins run in the daemon process, so the env is the daemon's.
export function paseoHome(env: NodeJS.ProcessEnv, home: string): string {
  return resolve(expandHomeDir(env.PASEO_HOME ?? "~/.paseo", home));
}

// Pid files of the ssh-mcp groups this plugin started.
export function resourceManagerRunDir(env: NodeJS.ProcessEnv, home: string): string {
  return join(paseoHome(env, home), "resource-manager", "run");
}

// shared-mcp's pid files (plugins/shared-mcp/server/plugin.ts:279). Read only.
export function sharedMcpRunDir(env: NodeJS.ProcessEnv, home: string): string {
  return join(paseoHome(env, home), "shared-mcp", "run");
}

// The heavy-command gate's shim directory (plugins/heavy-command-gate/server/paths.ts, gatePaths).
// A shim that admitted a command stays its parent, running as `<node> <this dir>/<command>`
// through its #! line. Read only.
export function heavyGateBinDir(env: NodeJS.ProcessEnv, home: string): string {
  return join(paseoHome(env, home), "heavy-command-gate", "bin");
}

// Claude Code keeps user- and local-scope MCP servers in .claude.json, under CLAUDE_CONFIG_DIR
// when that is set and in the home directory otherwise.
export function claudeConfigFile(env: NodeJS.ProcessEnv, home: string): string {
  const configDir = env.CLAUDE_CONFIG_DIR;
  if (configDir) return join(expandHomeDir(configDir, home), ".claude.json");
  return join(home, ".claude.json");
}
