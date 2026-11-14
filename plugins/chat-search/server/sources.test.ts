import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listTranscripts, transcriptRoots } from "./sources.js";

let home: string;

function transcript(configDir: string, project: string, name: string, mtime: string): string {
  const dir = join(home, configDir, "projects", project);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, "{}\n");
  const at = new Date(mtime);
  utimesSync(file, at, at);
  return file;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "chat-search-home-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("transcriptRoots", () => {
  it("is the main Claude folder's projects and each account's", () => {
    transcript(".claude", "p", "a.jsonl", "2026-11-14T08:00:00Z");
    transcript(".claude-work", "p", "b.jsonl", "2026-11-14T08:00:00Z");
    mkdirSync(join(home, ".claude-empty"));
    mkdirSync(join(home, ".claudex", "projects"), { recursive: true });
    expect(transcriptRoots({}, home)).toEqual([
      join(home, ".claude", "projects"),
      join(home, ".claude-work", "projects"),
    ]);
  });

  it("follows CLAUDE_CONFIG_DIR for the main folder", () => {
    transcript("elsewhere", "p", "a.jsonl", "2026-11-14T08:00:00Z");
    transcript(".claude-work", "p", "b.jsonl", "2026-11-14T08:00:00Z");
    expect(transcriptRoots({ CLAUDE_CONFIG_DIR: join(home, "elsewhere") }, home)).toEqual([
      join(home, "elsewhere", "projects"),
      join(home, ".claude-work", "projects"),
    ]);
  });

  it("is empty on a host with no Claude folder", () => {
    expect(transcriptRoots({}, home)).toEqual([]);
  });

  it("counts a folder once when an account is a link to the main one", () => {
    transcript(".claude", "p", "a.jsonl", "2026-11-14T08:00:00Z");
    symlinkSync(join(home, ".claude"), join(home, ".claude-alias"));
    expect(transcriptRoots({}, home)).toEqual([join(home, ".claude", "projects")]);
  });
});

describe("listTranscripts", () => {
  it("lists each chat's own file, newest first, with its session id and when it changed", async () => {
    const old = transcript(".claude", "-work-shop", "11111111-aaaa.jsonl", "2026-11-10T08:00:00Z");
    const fresh = transcript(
      ".claude",
      "-work-site",
      "22222222-bbbb.jsonl",
      "2026-11-14T08:00:00Z",
    );
    const account = transcript(
      ".claude-work",
      "-work-shop",
      "33333333-cccc.jsonl",
      "2026-11-12T08:00:00Z",
    );
    // A subagent's side chat, a memory folder and a stray file are not chats.
    transcript(
      ".claude",
      "-work-shop/11111111-aaaa/subagents",
      "agent-1.jsonl",
      "2026-11-14T09:00:00Z",
    );
    writeFileSync(join(home, ".claude", "projects", "-work-shop", "notes.txt"), "x");
    writeFileSync(join(home, ".claude", "projects", "stray.jsonl"), "{}\n");

    expect(await listTranscripts(transcriptRoots({}, home))).toEqual([
      { file: fresh, sessionId: "22222222-bbbb", changedAt: "2026-11-14T08:00:00.000Z" },
      { file: account, sessionId: "33333333-cccc", changedAt: "2026-11-12T08:00:00.000Z" },
      { file: old, sessionId: "11111111-aaaa", changedAt: "2026-11-10T08:00:00.000Z" },
    ]);
  });

  it("is empty for a root that is gone", async () => {
    expect(await listTranscripts([join(home, "missing")])).toEqual([]);
  });
});
