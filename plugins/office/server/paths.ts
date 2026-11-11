import { join, resolve } from "node:path";

// Copied from plugins/resource-manager/server/paths.ts, which mirrors resolvePaseoHome in
// packages/server/src/server/paseo-home.ts; a built-in can import neither.
function expandHomeDir(input: string, home: string): string {
  if (input.startsWith("~/")) return join(home, input.slice(2));
  if (input === "~") return home;
  return input;
}

/** Built-ins run in the daemon process, so the env is the daemon's. */
export function paseoHome(env: NodeJS.ProcessEnv, home: string): string {
  return resolve(expandHomeDir(env.PASEO_HOME ?? "~/.paseo", home));
}

export function officeDir(env: NodeJS.ProcessEnv, home: string): string {
  return join(paseoHome(env, home), "office");
}

export function boardsFile(env: NodeJS.ProcessEnv, home: string): string {
  return join(officeDir(env, home), "boards.json");
}
