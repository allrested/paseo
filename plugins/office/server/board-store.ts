import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { PostSchema, type Post } from "../shared/contracts.js";
import { errorMessage } from "./errors.js";

export const BoardsFileSchema = z.object({
  version: z.literal(1),
  /** The next post or change gets this seq. */
  nextSeq: z.number().int().nonnegative(),
  wakesPaused: z.boolean(),
  posts: z.array(PostSchema),
});

export interface BoardsFile {
  version: 1;
  nextSeq: number;
  wakesPaused: boolean;
  posts: Post[];
}

export const EMPTY_BOARDS: BoardsFile = { version: 1, nextSeq: 1, wakesPaused: false, posts: [] };

export interface BoardStore {
  /** Never rejects for a missing or broken file; a broken one is moved aside. */
  load(): Promise<BoardsFile>;
  /** Runs after every earlier save; rejects when the write fails. */
  save(data: BoardsFile): Promise<void>;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function emptyBoards(): BoardsFile {
  return { ...EMPTY_BOARDS, posts: [] };
}

export function createBoardStore(options: {
  file: string;
  now(): number;
  log(message: string): void;
}): BoardStore {
  const { file, log } = options;
  let chain: Promise<void> = Promise.resolve();
  let temp = 0;

  async function moveAside(reason: string): Promise<void> {
    const target = `${file}.corrupt-${options.now()}`;
    log(`[office] ${file} is unreadable (${reason}); moved to ${target}, starting empty`);
    try {
      await rename(file, target);
    } catch (error) {
      log(`[office] unable to move ${file} aside: ${errorMessage(error)}`);
    }
  }

  async function write(data: BoardsFile): Promise<void> {
    temp += 1;
    const tempFile = `${file}.tmp-${temp}`;
    await mkdir(dirname(file), { recursive: true });
    try {
      await writeFile(tempFile, `${JSON.stringify(data)}\n`, "utf8");
      await rename(tempFile, file);
    } catch (error) {
      await rm(tempFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  return {
    async load() {
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch (error) {
        if (isMissing(error)) return emptyBoards();
        // Moved aside like a corrupt file, so a later save never overwrites unread data.
        await moveAside(errorMessage(error));
        return emptyBoards();
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (error) {
        await moveAside(errorMessage(error));
        return emptyBoards();
      }
      const parsed = BoardsFileSchema.safeParse(json);
      if (!parsed.success) {
        await moveAside("unexpected shape");
        return emptyBoards();
      }
      return parsed.data;
    },
    save(data) {
      const run = chain.then(() => write(data));
      chain = run.catch(() => undefined);
      return run;
    },
  };
}
