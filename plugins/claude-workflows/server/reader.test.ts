import { appendFile, mkdtemp, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHUNK_BYTES, newCursor, readNewLines, type LineSink } from "./reader.js";

let root = "";

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "claude-workflows-reader-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

interface RecordingSink extends LineSink {
  lines: string[];
  restarts: number;
}

function recordingSink(): RecordingSink {
  const sink: RecordingSink = {
    lines: [],
    restarts: 0,
    restart() {
      sink.restarts += 1;
      sink.lines = [];
    },
    line(text) {
      sink.lines.push(text);
    },
  };
  return sink;
}

describe("readNewLines", () => {
  it("keeps a partial last line until its newline arrives", async () => {
    const path = join(root, "agent.jsonl");
    const cursor = newCursor();
    const sink = recordingSink();
    await writeFile(path, "one\ntw");

    await readNewLines({ path, cursor, sink });
    expect(sink.lines).toEqual(["one"]);
    await appendFile(path, "o\nthree\n");
    await readNewLines({ path, cursor, sink });

    expect(sink.lines).toEqual(["one", "two", "three"]);
  });

  it("reads only the bytes appended since the last call", async () => {
    const path = join(root, "agent.jsonl");
    const cursor = newCursor();
    const sink = recordingSink();
    await writeFile(path, "one\n");

    await readNewLines({ path, cursor, sink });
    await appendFile(path, "two\n");
    await readNewLines({ path, cursor, sink });
    await readNewLines({ path, cursor, sink });

    expect(sink.lines).toEqual(["one", "two"]);
    expect(cursor.offset).toBe(8);
    expect(sink.restarts).toBe(0);
  });

  it("starts over when the file shrank", async () => {
    const path = join(root, "journal.jsonl");
    const cursor = newCursor();
    const sink = recordingSink();
    await writeFile(path, "one\ntwo\n");

    await readNewLines({ path, cursor, sink });
    await writeFile(path, "new\n");
    await readNewLines({ path, cursor, sink });

    expect(sink.restarts).toBe(1);
    expect(sink.lines).toEqual(["new"]);
  });

  it("starts over when the file was replaced", async () => {
    const path = join(root, "journal.jsonl");
    const cursor = newCursor();
    const sink = recordingSink();
    await writeFile(path, "one\n");

    await readNewLines({ path, cursor, sink });
    await writeFile(join(root, "next.jsonl"), "uno\ndos\n");
    await rename(join(root, "next.jsonl"), path);
    await readNewLines({ path, cursor, sink });

    expect(sink.restarts).toBe(1);
    expect(sink.lines).toEqual(["uno", "dos"]);
  });

  it("reads a large file in chunks without splitting a line or a character", async () => {
    const path = join(root, "agent.jsonl");
    const sink = recordingSink();
    // "é" is two bytes in UTF-8; here its first byte ends the second chunk.
    const lineA = "a".repeat(CHUNK_BYTES);
    const lineB = `${"b".repeat(CHUNK_BYTES - 2)}é`;
    await writeFile(path, `${lineA}\n${lineB}\nc\n`);

    await readNewLines({ path, cursor: newCursor(), sink });

    expect(sink.lines.map((line) => line.length)).toEqual([CHUNK_BYTES, CHUNK_BYTES - 1, 1]);
    expect(sink.lines[1].slice(-2)).toBe("bé");
  });

  it("returns the mtime of the file it read", async () => {
    const path = join(root, "journal.jsonl");
    await writeFile(path, "one\n");

    const result = await readNewLines({ path, cursor: newCursor(), sink: recordingSink() });

    expect(result.mtimeMs).toBe((await stat(path)).mtimeMs);
  });

  it("rejects with the file error when the file cannot be opened", async () => {
    const request = {
      path: join(root, "absent.jsonl"),
      cursor: newCursor(),
      sink: recordingSink(),
    };
    await expect(readNewLines(request)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
