import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { kiroRoot, kiroStore } from "./kiro.js";

let root: string;

// Kiro CLI writes compact JSON, one object a line, as these are.
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const text = (data: string) => ({ kind: "text", data });
const prompt = (said: string, timestamp = 1_794_000_000) =>
  line({
    version: "v1",
    kind: "Prompt",
    data: { message_id: "m", content: [text(said)], meta: { timestamp } },
  });
const answer = (...content: unknown[]) =>
  line({ version: "v1", kind: "AssistantMessage", data: { message_id: "m", content } });
const thinking = (thought: string) => ({
  kind: "thinking",
  data: { text: thought, modelId: "m", signature: null },
});
const toolUse = (command: string) => ({
  kind: "toolUse",
  data: { name: "shell", toolUseId: "t", input: { command } },
});
const toolResults = (output: string) =>
  line({
    version: "v1",
    kind: "ToolResults",
    data: {
      message_id: "m",
      content: [{ kind: "toolResult", data: { toolUseId: "t", content: [text(output)] } }],
    },
  });

function chat(sessionId: string, lines: string, sidecar?: Record<string, unknown>): string {
  const file = join(root, `${sessionId}.jsonl`);
  writeFileSync(file, lines);
  if (sidecar) writeFileSync(join(root, `${sessionId}.json`), JSON.stringify(sidecar));
  return file;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chat-search-kiro-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("kiroStore", () => {
  it("looks for Kiro CLI's chats under the home folder", () => {
    expect(kiroRoot("/home/me")).toBe("/home/me/.kiro/sessions/cli");
    expect(kiroStore(root).provider).toBe("kiro");
  });

  it("lists each chat once, by its session, newest first, and not the files beside it", async () => {
    const older = chat("s-old", prompt("hello"), { session_id: "s-old" });
    const newer = chat("s-new", prompt("hello"));
    writeFileSync(join(root, "s-old.history"), "{}");
    utimesSync(older, new Date("2026-11-10T08:00:00Z"), new Date("2026-11-10T08:00:00Z"));
    utimesSync(newer, new Date("2026-11-14T08:00:00Z"), new Date("2026-11-14T08:00:00Z"));

    expect(await kiroStore(root).list()).toEqual([
      { file: newer, sessionId: "s-new", changedAt: "2026-11-14T08:00:00.000Z" },
      { file: older, sessionId: "s-old", changedAt: "2026-11-10T08:00:00.000Z" },
    ]);
  });

  it("has no chats on a host without Kiro", async () => {
    expect(await kiroStore(join(root, "missing")).list()).toEqual([]);
  });

  it("reads what was typed and what Kiro wrote, with the chat's title and folder", async () => {
    const file = chat(
      "s1",
      prompt("Why is the rounding wrong\nin checkout?") +
        answer(thinking("thinking about it"), text("The rounding uses floats."), toolUse("ls")) +
        toolResults("total 0"),
      { session_id: "s1", cwd: "/work/shop", title: "Checkout rounding" },
    );

    expect(await kiroStore(root).read(file, "rounding", 3)).toEqual({
      title: "Checkout rounding",
      folder: "/work/shop",
      matches: 2,
      snippets: [
        {
          role: "user",
          at: "2026-11-06T21:20:00.000Z",
          before: "Why is the ",
          match: "rounding",
          after: " wrong in checkout?",
        },
        { role: "assistant", at: null, before: "The ", match: "rounding", after: " uses floats." },
      ],
    });
  });

  it("does not search thinking, tool calls or tool output", async () => {
    const file = chat(
      "s1",
      prompt("Run it") +
        answer(thinking("the needle is here"), text("Running."), toolUse("grep needle")) +
        toolResults("needle found"),
    );

    expect(await kiroStore(root).read(file, "needle", 3)).toBeNull();
  });

  it("titles a chat Kiro did not title by its first prompt", async () => {
    const lines = prompt("  \nFind the needle in the logs\nplease") + answer(text("The needle."));
    const untitled = chat("s1", lines, { session_id: "s1", cwd: "/work/logs", title: "" });
    const alone = chat("s2", lines);

    const read = await kiroStore(root).read(untitled, "needle", 3);
    expect(read?.title).toBe("Find the needle in the logs");
    expect(read?.folder).toBe("/work/logs");
    expect(await kiroStore(root).read(alone, "needle", 3)).toMatchObject({
      title: "Find the needle in the logs",
      folder: null,
    });
  });

  it("reads past a line cut short and a file beside the chat that is not JSON", async () => {
    const file = chat(
      "s1",
      `{"version":"v1","kind":"Prompt","data":{"content":[{"kind":"text","data":"needle\n${prompt("The needle again")}`,
    );
    writeFileSync(join(root, "s1.json"), "{ not json");

    expect(await kiroStore(root).read(file, "needle", 3)).toMatchObject({
      title: "The needle again",
      folder: null,
      matches: 1,
    });
  });

  it("keeps the first snippets and counts the rest", async () => {
    const file = chat("s1", prompt("needle one") + prompt("needle two") + prompt("needle three"));

    const read = await kiroStore(root).read(file, "needle", 2);
    expect(read?.matches).toBe(3);
    expect(read?.snippets.map((snippet) => snippet.match + snippet.after)).toEqual([
      "needle one",
      "needle two",
    ]);
  });
});
