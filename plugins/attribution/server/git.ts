import { spawn } from "node:child_process";

/** Git commands stop after this long: a snapshot must not hold a folder's queue for ever. */
export const GIT_TIMEOUT_MS = 60_000;
/** The most output one command may give: the blame of a 1 MiB file fits several times. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export class GitError extends Error {
  constructor(
    public readonly command: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
  ) {
    super(`git ${command} failed${exitCode === null ? "" : ` (${exitCode})`}: ${stderr.trim()}`);
    this.name = "GitError";
  }
}

export interface GitOptions {
  /** The folder the command runs in. */
  cwd?: string;
  /** Variables added to the cleaned env. */
  env?: Record<string, string>;
  /** Bytes for the command's input. */
  input?: string | Buffer;
  timeoutMs?: number;
}

/**
 * The daemon's env without its GIT_ variables: an inherited GIT_DIR or GIT_INDEX_FILE would aim a
 * command at another repository, and inherited author variables would sign the shadow's commits.
 */
export function gitEnv(base: NodeJS.ProcessEnv, extra: Record<string, string> = {}) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
  }
  return Object.assign(
    env,
    { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
    extra,
  );
}

// A file monitor or an untracked cache would write to the index a snapshot only borrows.
const QUIET = ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"];

/** Runs one Git command and resolves with its output. */
export function git(args: readonly string[], options: GitOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...QUIET, ...args], {
      cwd: options.cwd,
      env: gitEnv(process.env, options.env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let failure: Error | null = null;
    const stop = (error: Error) => {
      failure ??= error;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(
      () => stop(new GitError(args[0] ?? "", null, "timed out")),
      options.timeoutMs ?? GIT_TIMEOUT_MS,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) stop(new GitError(args[0] ?? "", null, "too much output"));
      else out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => void err.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(failure ?? error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code === 0) resolve(Buffer.concat(out));
      else reject(new GitError(args[0] ?? "", code, Buffer.concat(err).toString("utf8")));
    });
    // A command that exits before it read its input closes the pipe: its exit code says why.
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input ?? "");
  });
}

/** One command's output as text, without the last line break. */
export async function gitText(args: readonly string[], options: GitOptions = {}): Promise<string> {
  return (await git(args, options)).toString("utf8").replace(/\n$/, "");
}
