import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { filesHolding } from "./grep.js";
import { grepPattern } from "./pattern.js";

// The pattern is for grep, so grep is what tests it: a message is stored as Claude Code stores
// it, and grep is asked for the words.
describe.skipIf(process.platform === "win32")("grepPattern", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chat-search-pattern-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function holds(message: string, words: string): Promise<boolean> {
    const file = join(dir, "t.jsonl");
    writeFileSync(file, `${JSON.stringify({ message: { content: message } })}\n`);
    return (await filesHolding([file], grepPattern(words))).has(file);
  }

  it("finds the words in a stored message, whatever their case", async () => {
    expect(await holds("The Login Token was empty", "login token")).toBe(true);
    expect(await holds("The login was fine", "login token")).toBe(false);
  });

  it("lets a line break, a tab or several spaces stand between two words", async () => {
    expect(await holds("the login\ntoken", "login token")).toBe(true);
    expect(await holds("the login\t  token", "login  token")).toBe(true);
    expect(await holds("the login\r\n\r\ntoken", " login token ")).toBe(true);
    expect(await holds("the loginntoken", "login token")).toBe(false);
  });

  it("takes punctuation as written, not as a pattern or an option", async () => {
    expect(await holds("is a !== b right?", "!==")).toBe(true);
    expect(await holds("call foo(bar) now", "foo(bar)")).toBe(true);
    expect(await holds("axb", "a.b")).toBe(false);
    expect(await holds("a.b", "a.b")).toBe(true);
    expect(await holds("price is $5 (five)", "$5 (five)")).toBe(true);
    expect(await holds("use a|b or [c] {d} ^e* f+ g?", "a|b or [c] {d} ^e* f+ g?")).toBe(true);
    expect(await holds("say -e loudly", "-e loudly")).toBe(true);
  });

  it("finds a quote and a backslash, which JSON stores escaped", async () => {
    expect(await holds('say "hi" to it', '"hi" to')).toBe(true);
    expect(await holds("the path C:\\temp\\x", "C:\\temp")).toBe(true);
    expect(await holds("say hi to it", '"hi"')).toBe(false);
  });

  it("finds letters outside ASCII in their own case", async () => {
    expect(await holds("Die Größe ändern", "Größe ändern")).toBe(true);
  });
});
