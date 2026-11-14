import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { filesHolding, linesHolding } from "./grep.js";

let dir: string;

const write = (name: string, text: string): string => {
  const file = join(dir, name);
  writeFileSync(file, text);
  return file;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chat-search-grep-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("filesHolding", () => {
  it("names the files that match, whatever the case", async () => {
    const a = write("a.jsonl", '{"text":"the Login token"}\n');
    const b = write("b.jsonl", '{"text":"nothing here"}\n');
    const c = write("c with space.jsonl", '{"text":"LOGIN again"}\n');
    expect(await filesHolding([a, b, c], "login")).toEqual(new Set([a, c]));
  });

  it("takes a pattern that starts like an option as a pattern", async () => {
    const a = write("a.jsonl", "a.b\n");
    const c = write("c.jsonl", "say -e loudly\n");
    expect(await filesHolding([a, c], "-e")).toEqual(new Set([c]));
  });

  it("folds the case of letters outside ASCII where the host has a UTF-8 locale", async () => {
    const a = write("a.jsonl", "ÜBER alles\n");
    const found = await filesHolding([a], "über");
    // A host without C.UTF-8 compares bytes; the exact spelling is still found there.
    expect([0, 1]).toContain(found.size);
    expect(await filesHolding([a], "ÜBER")).toEqual(new Set([a]));
  });

  it("goes through more files than one run takes, and skips one that is gone", async () => {
    const files = Array.from({ length: 12 }, (_, i) =>
      write(`f${i}.jsonl`, i % 3 === 0 ? "needle\n" : "hay\n"),
    );
    const gone = join(dir, "gone.jsonl");
    const found = await filesHolding([...files, gone], "needle", { batch: 5 });
    expect([...found].toSorted()).toEqual([files[0], files[3], files[6], files[9]].toSorted());
  });

  it("is empty for no files, without running anything", async () => {
    expect(await filesHolding([], "needle", { command: "/no/such/grep" })).toEqual(new Set());
  });

  it("says so when the host has no grep", async () => {
    const a = write("a.jsonl", "needle\n");
    await expect(filesHolding([a], "needle", { command: "/no/such/grep" })).rejects.toThrow(
      "Chat search needs grep on this host, and could not run it",
    );
  });

  it("gives up, and stops grep, when the time is up or the caller lets go", async () => {
    const a = write("a.jsonl", "needle\n");
    await expect(filesHolding([a], "needle", { signal: AbortSignal.abort() })).rejects.toThrow(
      "The search was stopped",
    );
    // A command that takes its time stands in for a grep over a cold disk.
    const slow = write("slow-grep", "#!/bin/sh\nexec sleep 30\n");
    chmodSync(slow, 0o755);
    const started = Date.now();
    await expect(
      filesHolding([a], "needle", { signal: AbortSignal.timeout(200), command: slow }),
    ).rejects.toThrow("The search was stopped");
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe.skipIf(process.platform === "win32")("linesHolding", () => {
  async function lines(file: string, patterns: string[], options = {}): Promise<string[]> {
    const found: string[] = [];
    for await (const line of linesHolding(file, patterns, options)) found.push(line);
    return found;
  }

  it("hands over the lines that match any pattern, in the file's order", async () => {
    const a = write("a.jsonl", "one Needle\ntwo hay\n{title} three\nfour NEEDLE\n");
    expect(await lines(a, ["needle", String.raw`^\{title\}`])).toEqual([
      "one Needle",
      "{title} three",
      "four NEEDLE",
    ]);
  });

  it("reads a file with a stray byte in it as text", async () => {
    const a = join(dir, "a.jsonl");
    writeFileSync(
      a,
      Buffer.concat([Buffer.from("needle \0 and "), Buffer.from([0xff]), Buffer.from("\n")]),
    );
    expect(await lines(a, ["needle"])).toHaveLength(1);
    expect(await lines(a, ["nëedle"])).toHaveLength(0);
  });

  it("has no lines for a file that is gone", async () => {
    expect(await lines(join(dir, "gone.jsonl"), ["needle"])).toEqual([]);
  });

  it("stops grep when the caller stops reading", async () => {
    // A command that never ends by itself: the loop below can only finish if it is stopped.
    const endless = write("endless-grep", "#!/bin/sh\nwhile :; do echo needle; done\n");
    chmodSync(endless, 0o755);
    let seen = 0;
    for await (const line of linesHolding(endless, ["needle"], { command: endless })) {
      expect(line).toBe("needle");
      seen += 1;
      if (seen === 3) break;
    }
    expect(seen).toBe(3);
  });

  it("fails when the host has no grep, or the search was stopped", async () => {
    const a = write("a.jsonl", "needle\n");
    await expect(lines(a, ["needle"], { command: "/no/such/grep" })).rejects.toThrow(
      "Chat search needs grep on this host, and could not run it",
    );
    await expect(lines(a, ["needle"], { signal: AbortSignal.abort() })).rejects.toThrow(
      "The search was stopped",
    );
    const slow = write("slow-grep", "#!/bin/sh\nexec sleep 30\n");
    chmodSync(slow, 0o755);
    await expect(
      lines(a, ["needle"], { signal: AbortSignal.timeout(200), command: slow }),
    ).rejects.toThrow("The search was stopped");
  });
});
