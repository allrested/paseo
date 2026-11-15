// The feed on disk: one JSON file, written whole through a temp file. It is a list of what
// happened lately, so a file that cannot be read is logged and the feed starts empty.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { FeedStateSchema, type FeedState } from "../shared/contracts.js";
import { EMPTY_FEED } from "../shared/feed.js";
import { errorMessage } from "./errors.js";

// What ran when the file was written does not run when it is read, so it is not in the file.
const FeedFileSchema = FeedStateSchema.omit({ running: true }).extend({ version: z.literal(1) });

export interface FeedStore {
  /** Runs after every earlier save. Never rejects: a missing or broken file is an empty feed. */
  load(): Promise<FeedState>;
  /** Runs after every earlier load and save; rejects when the write fails. */
  save(state: FeedState): Promise<void>;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function createFeedStore(options: { file: string; log(message: string): void }): FeedStore {
  const { file, log } = options;
  let chain: Promise<void> = Promise.resolve();
  let temp = 0;

  async function read(): Promise<FeedState> {
    try {
      const parsed = FeedFileSchema.parse(JSON.parse(await readFile(file, "utf8")));
      const { version: _version, ...state } = parsed;
      return state;
    } catch (error) {
      if (!isMissing(error)) {
        log(`[feed] ${file} is unreadable (${errorMessage(error)}); starting empty`);
      }
      return EMPTY_FEED;
    }
  }

  async function write({ running: _running, ...state }: FeedState): Promise<void> {
    temp += 1;
    const tempFile = `${file}.tmp-${temp}`;
    await mkdir(dirname(file), { recursive: true });
    try {
      await writeFile(tempFile, `${JSON.stringify({ version: 1, ...state })}\n`, "utf8");
      await rename(tempFile, file);
    } catch (error) {
      await rm(tempFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  // One at a time, in call order: a later save never lands before an earlier one.
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return { load: () => enqueue(read), save: (state) => enqueue(() => write(state)) };
}
