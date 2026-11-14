import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { connect } from "node:net";
import { readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { StackPorts } from "./stack.js";

function which(env: NodeJS.ProcessEnv, name: string): string | null {
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here.
    }
  }
  return null;
}

/** The real host. `builtinDirectory` is this plugin's folder in the server build, when known. */
export function nodeStackPorts(
  env: NodeJS.ProcessEnv,
  builtinDirectory: string | null,
): StackPorts {
  return {
    env,
    now: () => Date.now(),
    uptimeSeconds: () => process.uptime(),
    // dist/server/builtin-plugins/<id> in @getpaseo/server; the desktop app copies the built-ins
    // elsewhere, where this file is not there and the version reads as not available.
    packageJson: builtinDirectory
      ? join(builtinDirectory, "..", "..", "..", "..", "package.json")
      : null,
    readText: (path) => readFile(path, "utf8"),
    async httpStatus(url, timeoutMs) {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "manual",
      });
      await response.body?.cancel();
      return response.status;
    },
    connect: (host, port, timeoutMs) =>
      new Promise((resolve, reject) => {
        const socket = connect({ host, port });
        socket.setTimeout(timeoutMs, () => socket.destroy(new Error("timed out")));
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", reject);
      }),
    run: (command, args, timeoutMs) =>
      new Promise((resolve, reject) => {
        execFile(
          command,
          [...args],
          { env, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
          (error, stdout, stderr) => {
            if (error) reject(new Error(String(stderr).trim() || error.message));
            else resolve(String(stdout));
          },
        );
      }),
    which: (name) => which(env, name),
  };
}
