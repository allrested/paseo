// The trackers' tokens on disk: one JSON file only the daemon's user can read, written whole
// through a temp file. Nothing here sends a token anywhere; the trackers' clients read it.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { SourceSchema, type Source } from "../shared/contracts.js";
import { errorMessage } from "./issue.js";

const FileSchema = z.object({
  version: z.literal(1),
  tokens: z.partialRecord(SourceSchema, z.string()),
});

export type SavedTokens = Partial<Record<Source, string>>;

export interface TokenStore {
  /** Never rejects: a missing or broken file is no tokens. */
  read(): Promise<SavedTokens>;
  /** Saves the token, or removes it for `null`. Rejects when the write fails. */
  write(source: Source, token: string | null): Promise<void>;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function createTokenStore(options: {
  file: string;
  log(message: string): void;
}): TokenStore {
  const { file, log } = options;
  let chain: Promise<void> = Promise.resolve();
  let temp = 0;

  async function read(): Promise<SavedTokens> {
    try {
      return FileSchema.parse(JSON.parse(await readFile(file, "utf8"))).tokens;
    } catch (error) {
      // The reason may quote the file, so only its kind is logged.
      if (!isMissing(error)) {
        const kind = error instanceof Error ? error.name : "error";
        log(`[tasks] ${file} is unreadable (${kind}); no tokens are loaded`);
      }
      return {};
    }
  }

  async function write(source: Source, token: string | null): Promise<void> {
    const tokens = { ...(await read()) };
    if (token === null) delete tokens[source];
    else tokens[source] = token;
    temp += 1;
    const tempFile = `${file}.tmp-${temp}`;
    try {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      // A daemon that died mid-write leaves its temp file, and "wx" would refuse it forever.
      await rm(tempFile, { force: true });
      // "wx" with the mode: the file never exists with wider permissions, not even for a moment.
      await writeFile(tempFile, `${JSON.stringify({ version: 1, tokens })}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await rename(tempFile, file);
    } catch (error) {
      await rm(tempFile, { force: true }).catch(() => undefined);
      throw new Error(`The token could not be saved: ${errorMessage(error)}`, { cause: error });
    }
  }

  // One at a time, in call order: two saves never read the same old file.
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    read: () => enqueue(read),
    write: (source, token) => enqueue(() => write(source, token)),
  };
}
