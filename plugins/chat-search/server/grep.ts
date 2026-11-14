// grep does the reading, in its own process. It goes through a gigabyte of transcripts in under
// a second once they are cached: first it names the files that hold the words, then it hands
// over only the lines that do, so the daemon parses a few lines and never a whole transcript.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// Far under the kernel's limit on a command line: 400 paths of 150 characters are 60 kB.
const BATCH = 400;
const STOPPED = "The search was stopped";
const NO_GREP = "Chat search needs grep on this host, and could not run it";

export interface GrepOptions {
  /** Stops grep early: the search's time is up, or a newer search replaced it. */
  signal?: AbortSignal;
  command?: string;
}

// -a: a transcript is text, even with a stray byte in it. -i: any case.
const TEXT = ["-a", "-E", "-i"];

// In the C locale grep compares bytes, which took 0.7 s over 700 MB of transcripts where a UTF-8
// locale took 4.9 s. Only a letter outside ASCII needs the UTF-8 locale, to fold its case; a
// host without C.UTF-8 falls back to bytes and finds such a letter in its own case only.
function environment(patterns: readonly string[]): NodeJS.ProcessEnv {
  const ascii = patterns.every((pattern) => /^[ -~]*$/.test(pattern));
  return { ...process.env, LC_ALL: ascii ? "C" : "C.UTF-8" };
}

function failure(error: Error): Error {
  return new Error(error.name === "AbortError" ? STOPPED : NO_GREP);
}

// -l --null: only the names of matching files, NUL-ended, so any path survives. grep exits 1
// when nothing matched and 2 when a file could not be read; both leave the names it did print
// valid.
function names(
  files: readonly string[],
  pattern: string,
  { signal, command = "grep" }: GrepOptions,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...TEXT, "-l", "--null", "-e", pattern, "--", ...files], {
      env: environment([pattern]),
      stdio: ["ignore", "pipe", "ignore"],
      signal,
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", (error) => reject(failure(error)));
    child.once("close", () => {
      resolve(Buffer.concat(chunks).toString("utf8").split("\0").filter(Boolean));
    });
  });
}

/** The files among `files` that match the pattern (grepPattern), whatever the case. */
export async function filesHolding(
  files: readonly string[],
  pattern: string,
  options: GrepOptions & { batch?: number } = {},
): Promise<Set<string>> {
  const { batch = BATCH, signal } = options;
  const found = new Set<string>();
  for (let start = 0; start < files.length; start += batch) {
    if (signal?.aborted) throw new Error(STOPPED);
    for (const name of await names(files.slice(start, start + batch), pattern, options)) {
      found.add(name);
    }
  }
  return found;
}

/**
 * The lines of one file that match any of the patterns, in the file's order. grep is stopped
 * when the caller stops reading. A file that is gone has no lines.
 */
export async function* linesHolding(
  file: string,
  patterns: readonly string[],
  { signal, command = "grep" }: GrepOptions = {},
): AsyncGenerator<string> {
  if (signal?.aborted) throw new Error(STOPPED);
  const wanted = patterns.flatMap((pattern) => ["-e", pattern]);
  const child = spawn(command, [...TEXT, ...wanted, "--", file], {
    env: environment(patterns),
    stdio: ["ignore", "pipe", "ignore"],
    signal,
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  // A child with no error listener throws in the daemon's own process when grep cannot start.
  // Closing the reader ends the loop below, which a grep that never ran would leave waiting.
  let failed: Error | null = null;
  child.once("error", (error) => {
    failed = failure(error);
    lines.close();
  });
  try {
    for await (const line of lines) yield line;
  } finally {
    lines.close();
    child.kill();
  }
  if (failed !== null) throw failed;
}
