import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTranscript } from "./transcript.js";

describe.skipIf(process.platform === "win32")("readTranscript", () => {
  let dir: string;
  let file: string;

  const line = (value: unknown) => `${JSON.stringify(value)}\n`;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chat-search-"));
    file = join(dir, "session.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds the matching messages, the chat's folder and a title from the first prompt", async () => {
    writeFileSync(
      file,
      line({ type: "attachment", cwd: "/work/shop" }) +
        line({
          type: "user",
          cwd: "/work/shop",
          timestamp: "2026-11-14T08:00:00.000Z",
          message: { content: "Fix the checkout total\nIt is off by one cent." },
        }) +
        line({
          type: "assistant",
          cwd: "/work/shop",
          timestamp: "2026-11-14T08:00:05.000Z",
          message: { content: [{ type: "text", text: "The rounding happens before the tax." }] },
        }) +
        line({
          type: "user",
          timestamp: "2026-11-14T08:01:00.000Z",
          message: { content: [{ type: "tool_result", content: "rounding in tool output" }] },
        }) +
        line({
          type: "user",
          timestamp: "2026-11-14T08:02:00.000Z",
          message: { content: "Move the ROUNDING after the tax then." },
        }),
    );
    expect(await readTranscript(file, "rounding", 3)).toEqual({
      title: "Fix the checkout total",
      folder: "/work/shop",
      matches: 2,
      snippets: [
        {
          role: "assistant",
          at: "2026-11-14T08:00:05.000Z",
          before: "The ",
          match: "rounding",
          after: " happens before the tax.",
        },
        {
          role: "user",
          at: "2026-11-14T08:02:00.000Z",
          before: "Move the ",
          match: "ROUNDING",
          after: " after the tax then.",
        },
      ],
    });
  });

  it("uses the title Claude Code gave the chat when there is one", async () => {
    writeFileSync(
      file,
      line({ type: "user", cwd: "/w", message: { content: "hello needle" } }) +
        line({ type: "ai-title", aiTitle: "Checkout rounding" }),
    );
    expect((await readTranscript(file, "needle", 3))?.title).toBe("Checkout rounding");
  });

  it("keeps the first snippets and still counts the rest", async () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      line({ type: "user", cwd: "/w", message: { content: `needle number ${i}` } }),
    ).join("");
    writeFileSync(file, many);
    const read = await readTranscript(file, "needle", 3);
    expect(read?.matches).toBe(7);
    expect(read?.snippets.map((snippet) => snippet.after)).toEqual([
      " number 0",
      " number 1",
      " number 2",
    ]);
  });

  it("stops at ten matching messages and leaves the rest of the file unread", async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      line({ type: "user", cwd: "/w", message: { content: `needle number ${i}` } }),
    ).join("");
    writeFileSync(file, many + line({ type: "ai-title", aiTitle: "Named after the stop" }));
    const read = await readTranscript(file, "needle", 3);
    expect(read?.matches).toBe(10);
    expect(read?.title).toBe("needle number 0");
  });

  it("is null when only tool output or a broken line held the words", async () => {
    writeFileSync(
      file,
      line({ type: "user", cwd: "/w", message: { content: "plain prompt" } }) +
        line({ type: "user", message: { content: [{ type: "tool_result", content: "needle" }] } }) +
        '{"type":"user","message":{"content":"needle but cut off\n',
    );
    expect(await readTranscript(file, "needle", 3)).toBeNull();
  });

  it("finds words that are punctuation only", async () => {
    writeFileSync(
      file,
      line({ type: "user", cwd: "/w", message: { content: "is a => b right?" } }),
    );
    expect((await readTranscript(file, "=>", 3))?.snippets).toEqual([
      { role: "user", at: null, before: "is a ", match: "=>", after: " b right?" },
    ]);
  });

  it("finds words a line break separates in the message", async () => {
    writeFileSync(
      file,
      line({ type: "user", cwd: "/w", message: { content: "the login\ntoken is empty" } }),
    );
    expect((await readTranscript(file, "login token", 3))?.snippets[0]?.match).toBe("login token");
  });

  it("finds words with a quote or a backslash, which a line stores escaped", async () => {
    writeFileSync(
      file,
      line({ type: "user", cwd: "/w", message: { content: 'say "hi" in C:\\temp please' } }),
    );
    expect((await readTranscript(file, '"hi" in', 3))?.snippets[0]?.match).toBe('"hi" in');
    expect((await readTranscript(file, "C:\\temp", 3))?.snippets[0]?.match).toBe("C:\\temp");
  });

  it("is Untitled chat when nothing was typed and no title was given", async () => {
    writeFileSync(
      file,
      line({ type: "assistant", cwd: "/w", message: { content: "a needle from nowhere" } }),
    );
    expect((await readTranscript(file, "needle", 3))?.title).toBe("Untitled chat");
  });

  it("is null for a file that is gone", async () => {
    expect(await readTranscript(join(dir, "missing.jsonl"), "needle", 3)).toBeNull();
  });

  it("fails when the host has no grep, or the search was stopped", async () => {
    writeFileSync(file, line({ type: "user", cwd: "/w", message: { content: "needle" } }));
    await expect(readTranscript(file, "needle", 3, { command: "/no/such/grep" })).rejects.toThrow(
      "Chat search needs grep on this host, and could not run it",
    );
    await expect(
      readTranscript(file, "needle", 3, { signal: AbortSignal.abort() }),
    ).rejects.toThrow("The search was stopped");
  });
});
