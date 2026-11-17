import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { ChatMessageSchema, type ChatMessage } from "../shared/contracts.js";
import { errorMessage } from "./errors.js";

/**
 * The file upstream's engine saves. zod drops the keys it does not know, so a photo's picture and
 * a work card's body do not come back on load.
 */
export const ChatFileSchema = z.object({
  v: z.literal(1),
  msgs: z.array(ChatMessageSchema),
  /** The pinned message's id. */
  pinned: z.string().nullable(),
  /** The day each once-a-day line was last said, by the line's key. */
  days: z.record(z.string(), z.string()),
  /** The keys of lines already said, so one is not said twice. */
  keys: z.array(z.string()),
});

export interface ChatData {
  v: 1;
  msgs: ChatMessage[];
  pinned: string | null;
  days: Record<string, string>;
  keys: string[];
}

// A new object each time, since the engine changes what load returns.
export function emptyChat(): ChatData {
  return { v: 1, msgs: [], pinned: null, days: {}, keys: [] };
}

export interface ChatStore {
  /**
   * Runs after every earlier load and save. Never rejects for a missing or broken file; a broken
   * one is moved aside.
   */
  load(): Promise<ChatData>;
  /** Runs after every earlier load and save; rejects when the write fails. */
  save(data: ChatData): Promise<void>;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function createChatStore(options: {
  file: string;
  now(): number;
  log(message: string): void;
}): ChatStore {
  const { file, log } = options;
  let chain: Promise<void> = Promise.resolve();
  let temp = 0;

  async function moveAside(reason: string): Promise<void> {
    const target = `${file}.corrupt-${options.now()}`;
    try {
      await rename(file, target);
      log(`[office] ${file} is unreadable (${reason}); moved to ${target}, starting empty`);
    } catch (error) {
      log(
        `[office] ${file} is unreadable (${reason}) and could not be moved aside (${errorMessage(error)}); starting empty, the next save will replace the file`,
      );
    }
  }

  async function write(data: ChatData): Promise<void> {
    temp += 1;
    const tempFile = `${file}.tmp-${temp}`;
    await mkdir(dirname(file), { recursive: true });
    try {
      await writeFile(tempFile, `${JSON.stringify(data)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(tempFile, file);
    } catch (error) {
      await rm(tempFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async function read(): Promise<ChatData> {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (isMissing(error)) return emptyChat();
      // Moved aside like a corrupt file, so a later save never overwrites unread data.
      await moveAside(errorMessage(error));
      return emptyChat();
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      await moveAside(errorMessage(error));
      return emptyChat();
    }
    const parsed = ChatFileSchema.safeParse(json);
    if (!parsed.success) {
      await moveAside("unexpected shape");
      return emptyChat();
    }
    return parsed.data;
  }

  // Loads and saves share one queue, so a load always reads the saves called before it.
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    load: () => enqueue(read),
    save: (data) => enqueue(() => write(data)),
  };
}
