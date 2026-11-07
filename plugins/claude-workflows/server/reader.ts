import { open } from "node:fs/promises";

/** The most bytes one read takes, so a large first read yields to the event loop between reads. */
export const CHUNK_BYTES = 1024 * 1024;

const NEWLINE = 0x0a;

/** Where reading a file stopped. */
export interface FileCursor {
  offset: number;
  /** The inode read last, or null before the first read. */
  inode: number | null;
  /** The bytes of the unfinished last line, kept as bytes so a split character survives. */
  partial: Buffer;
}

export function newCursor(): FileCursor {
  return { offset: 0, inode: null, partial: Buffer.alloc(0) };
}

/** Receives a file's complete lines in order, and `restart` before the file is read from zero. */
export interface LineSink {
  restart(): void;
  line(text: string): void;
}

export interface ReadRequest {
  path: string;
  cursor: FileCursor;
  sink: LineSink;
}

export interface ReadResult {
  mtimeMs: number;
}

/**
 * Hands the sink each line completed since the cursor, reading only the bytes added since the
 * last call and keeping the unfinished last line for the next. A file that shrank or was
 * replaced is read again from zero. Rejects with the file error when the file cannot be read.
 */
export async function readNewLines(request: ReadRequest): Promise<ReadResult> {
  const { path, cursor, sink } = request;
  const handle = await open(path, "r");
  try {
    const stats = await handle.stat();
    const replaced = cursor.inode !== null && cursor.inode !== stats.ino;
    const shrank = stats.size < cursor.offset;
    if (replaced || shrank) {
      cursor.offset = 0;
      cursor.partial = Buffer.alloc(0);
      sink.restart();
    }
    cursor.inode = stats.ino;
    const remaining = stats.size - cursor.offset;
    const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, remaining));
    while (cursor.offset < stats.size) {
      const length = Math.min(chunk.length, stats.size - cursor.offset);
      const { bytesRead } = await handle.read(chunk, 0, length, cursor.offset);
      if (bytesRead === 0) break;
      cursor.offset += bytesRead;
      const bytes = Buffer.concat([cursor.partial, chunk.subarray(0, bytesRead)]);
      cursor.partial = emitLines(bytes, sink);
    }
    return { mtimeMs: stats.mtimeMs };
  } finally {
    await handle.close();
  }
}

/** Hands each complete line in `bytes` to the sink, and returns the unfinished rest. */
function emitLines(bytes: Buffer, sink: LineSink): Buffer {
  let start = 0;
  let end = bytes.indexOf(NEWLINE, start);
  while (end !== -1) {
    sink.line(bytes.toString("utf8", start, end));
    start = end + 1;
    end = bytes.indexOf(NEWLINE, start);
  }
  // Copied, so a short partial line does not keep the whole chunk alive in the cache.
  return Buffer.from(bytes.subarray(start));
}
