// The counts on disk: one JSON file, written whole through a temp file. They are a tally, not a
// record of anything else, so a file that cannot be read is logged and the count starts over.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { HourSchema, type Hour } from "../shared/contracts.js";
import { errorMessage } from "./errors.js";

export interface StoredStats {
  /** When the host began to count. */
  countingSince: string;
  hours: Hour[];
  /** The folder each workspace's agents last worked in: its name once the workspace is gone. */
  folders: Record<string, string>;
}

const FileSchema = z.object({
  version: z.literal(1),
  countingSince: z.string(),
  hours: z.array(HourSchema),
  folders: z.record(z.string(), z.string()),
});

export interface StatsStore {
  /** Null when there is no file yet, or none that can be read. Never rejects. */
  load(): Promise<StoredStats | null>;
  /** Runs after every earlier save; rejects when the write fails. */
  save(stats: StoredStats): Promise<void>;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function createStatsStore(options: {
  file: string;
  log(message: string): void;
}): StatsStore {
  const { file, log } = options;
  let chain: Promise<void> = Promise.resolve();
  let temp = 0;

  async function read(): Promise<StoredStats | null> {
    try {
      const { version: _version, ...stats } = FileSchema.parse(
        JSON.parse(await readFile(file, "utf8")),
      );
      return stats;
    } catch (error) {
      if (!isMissing(error)) {
        log(`[agent-stats] ${file} is unreadable (${errorMessage(error)}); counting from now`);
      }
      return null;
    }
  }

  async function write(stats: StoredStats): Promise<void> {
    temp += 1;
    const tempFile = `${file}.tmp-${temp}`;
    await mkdir(dirname(file), { recursive: true });
    try {
      await writeFile(tempFile, `${JSON.stringify({ version: 1, ...stats })}\n`, "utf8");
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

  return { load: () => enqueue(read), save: (stats) => enqueue(() => write(stats)) };
}
