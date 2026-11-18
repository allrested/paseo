import { join, resolve } from "node:path";

// Mirrors resolvePaseoHome in packages/server/src/server/paseo-home.ts; a built-in cannot import it.
function expandHomeDir(input: string, home: string): string {
  if (input.startsWith("~/")) return join(home, input.slice(2));
  if (input === "~") return home;
  return input;
}

/** Built-ins run in the daemon process, so the env is the daemon's. */
export function attributionRoot(env: NodeJS.ProcessEnv, home: string): string {
  return join(resolve(expandHomeDir(env.PASEO_HOME ?? "~/.paseo", home)), "attribution");
}
