import { spawn as nodeSpawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { errorMessage } from "./errors.js";

export const ADB_TIMEOUT_MS = 15_000;
const TEXT_LIMIT = 4 * 1024 * 1024;
const BINARY_LIMIT = 32 * 1024 * 1024;

export interface AdbRunner {
  /** Runs `adb <args>`; resolves stdout. Rejects on a non-zero exit, a timeout (the child is killed) or a spawn error. */
  run(args: readonly string[], options?: { timeoutMs?: number; binary?: boolean }): Promise<Buffer>;
}

/** The first executable called `name` on `env.PATH`, or null. */
export function findOnPath(name: string, env: NodeJS.ProcessEnv): string | null {
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

// Runs inside the daemon process: nothing here throws; every failure is a rejection.
export function createAdbRunner(input: { adbPath?: string; spawn?: typeof nodeSpawn }): AdbRunner {
  const adbPath = input.adbPath ?? "adb";
  const spawn = input.spawn ?? nodeSpawn;
  return {
    run(args, options = {}) {
      const timeoutMs = options.timeoutMs ?? ADB_TIMEOUT_MS;
      const limit = options.binary ? BINARY_LIMIT : TEXT_LIMIT;
      return new Promise<Buffer>((resolve, reject) => {
        let settled = false;
        let child: ReturnType<typeof nodeSpawn>;
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let size = 0;
        let timer: NodeJS.Timeout | undefined;
        function finish(error: Error | null, output?: Buffer) {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (error) reject(error);
          else resolve(output ?? Buffer.alloc(0));
        }
        try {
          child = spawn(adbPath, [...args], { stdio: ["ignore", "pipe", "pipe"] });
        } catch (error) {
          finish(new Error(errorMessage(error)));
          return;
        }
        timer = setTimeout(() => {
          child.kill("SIGKILL");
          finish(new Error(`adb timed out after ${timeoutMs} ms`));
        }, timeoutMs);
        timer.unref();
        child.stdout?.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > limit) {
            child.kill("SIGKILL");
            finish(new Error(`adb printed more than ${limit} bytes`));
            return;
          }
          stdout.push(chunk);
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          if (stderr.length < 64) stderr.push(chunk);
        });
        child.on("error", (error: NodeJS.ErrnoException) => {
          finish(new Error(error.code === "ENOENT" ? "adb is not installed" : errorMessage(error)));
        });
        child.on("close", (code) => {
          const out = Buffer.concat(stdout);
          if (code === 0) {
            finish(null, out);
            return;
          }
          const said = Buffer.concat(stderr).toString().trim() || out.toString().trim();
          finish(new Error(said || `adb exited with code ${code}`));
        });
      });
    },
  };
}
