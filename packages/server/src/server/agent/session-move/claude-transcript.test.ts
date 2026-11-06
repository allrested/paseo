import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeProjectDir } from "../providers/claude/project-dir.js";
import { copyClaudeTranscript, undoClaudeTranscriptCopy } from "./claude-transcript.js";

describe("copyClaudeTranscript", () => {
  let root: string;
  let cwd: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "claude-move-"));
    cwd = join(root, "repo");
    await mkdir(cwd);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("copies the session into the target config dir's project folder", async () => {
    const fromConfigDir = join(root, ".claude");
    const toConfigDir = join(root, ".claude-work");
    const sourceDir = await claudeProjectDir(cwd, { configDir: fromConfigDir });
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "s-1.jsonl"), '{"type":"user"}\n');

    const result = await copyClaudeTranscript({
      cwd,
      sessionId: "s-1",
      fromConfigDir,
      toConfigDir,
    });

    const expected = join(await claudeProjectDir(cwd, { configDir: toConfigDir }), "s-1.jsonl");
    expect(result).toEqual({ status: "copied", path: expected, previousSize: null });
    expect(await readFile(expected, "utf8")).toBe('{"type":"user"}\n');
  });

  it("overwrites an older copy so moving back carries the newer turns", async () => {
    const a = join(root, ".claude");
    const b = join(root, ".claude-work");
    for (const [dir, body] of [
      [a, "old\n"],
      [b, "old\nnew\n"],
    ] as const) {
      const projectDir = await claudeProjectDir(cwd, { configDir: dir });
      await mkdir(projectDir, { recursive: true });
      await writeFile(join(projectDir, "s-1.jsonl"), body);
    }
    const result = await copyClaudeTranscript({
      cwd,
      sessionId: "s-1",
      fromConfigDir: b,
      toConfigDir: a,
    });
    expect(result).toMatchObject({ status: "copied", previousSize: 4 });
    const back = join(await claudeProjectDir(cwd, { configDir: a }), "s-1.jsonl");
    expect(await readFile(back, "utf8")).toBe("old\nnew\n");
  });

  async function writeTranscripts(bodies: { from: string; to: string }) {
    const from = join(root, ".claude-work");
    const to = join(root, ".claude");
    const paths = { from: "", to: "" };
    for (const [key, dir] of [
      ["from", from],
      ["to", to],
    ] as const) {
      const projectDir = await claudeProjectDir(cwd, { configDir: dir });
      await mkdir(projectDir, { recursive: true });
      paths[key] = join(projectDir, "s-1.jsonl");
      await writeFile(paths[key], bodies[key]);
    }
    return { fromConfigDir: from, toConfigDir: to, paths };
  }

  it("refuses a target that is not a prefix and leaves it untouched", async () => {
    const { fromConfigDir, toConfigDir, paths } = await writeTranscripts({
      from: "old\nnew\n",
      to: "old\nother\n",
    });

    const result = await copyClaudeTranscript({
      cwd,
      sessionId: "s-1",
      fromConfigDir,
      toConfigDir,
    });

    expect(result).toEqual({ status: "diverged", path: paths.to });
    expect(await readFile(paths.to, "utf8")).toBe("old\nother\n");
  });

  it("undo removes a created copy and truncates a replaced one to its old bytes", async () => {
    const { fromConfigDir, toConfigDir, paths } = await writeTranscripts({
      from: "old\nnew\n",
      to: "old\n",
    });
    const replaced = await copyClaudeTranscript({
      cwd,
      sessionId: "s-1",
      fromConfigDir,
      toConfigDir,
    });
    if (replaced.status !== "copied") throw new Error("expected a copy");
    await undoClaudeTranscriptCopy(replaced);
    expect(await readFile(paths.to, "utf8")).toBe("old\n");

    await rm(paths.to);
    const created = await copyClaudeTranscript({
      cwd,
      sessionId: "s-1",
      fromConfigDir,
      toConfigDir,
    });
    if (created.status !== "copied") throw new Error("expected a copy");
    await undoClaudeTranscriptCopy(created);
    await expect(access(paths.to)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("a failed copy leaves the target untouched and no temp file behind", async () => {
    const { fromConfigDir, toConfigDir, paths } = await writeTranscripts({
      from: "old\nnew\n",
      to: "old\n",
    });
    // The temp path points into a folder that does not exist, so writing it fails. A read-only
    // folder would not, because root ignores permission bits.
    await symlink(join(root, "missing", "x"), `${paths.to}.paseo-move-tmp`);

    await expect(
      copyClaudeTranscript({ cwd, sessionId: "s-1", fromConfigDir, toConfigDir }),
    ).rejects.toMatchObject({ code: "ENOENT" });

    expect(await readFile(paths.to, "utf8")).toBe("old\n");
    expect(await readdir(join(paths.to, ".."))).toEqual(["s-1.jsonl"]);
  });

  it("copies a transcript that lives in another project folder into that folder", async () => {
    const fromConfigDir = join(root, ".claude");
    const toConfigDir = join(root, ".claude-work");
    // Claude Code named this folder from its own view of the cwd, not the one paseo encodes.
    const elsewhere = join(fromConfigDir, "projects", "elsewhere");
    await mkdir(elsewhere, { recursive: true });
    await writeFile(join(elsewhere, "s-1.jsonl"), "old\n");

    const result = await copyClaudeTranscript({
      cwd,
      sessionId: "s-1",
      fromConfigDir,
      toConfigDir,
    });

    const expected = join(toConfigDir, "projects", "elsewhere", "s-1.jsonl");
    expect(result).toEqual({ status: "copied", path: expected, previousSize: null });
    expect(await readFile(expected, "utf8")).toBe("old\n");
  });

  it("a move back overwrites the copy in that folder instead of writing a second one", async () => {
    const home = join(root, ".claude");
    const work = join(root, ".claude-work");
    for (const [dir, body] of [
      [home, "old\n"],
      [work, "old\nnew\n"],
    ] as const) {
      await mkdir(join(dir, "projects", "elsewhere"), { recursive: true });
      await writeFile(join(dir, "projects", "elsewhere", "s-1.jsonl"), body);
    }

    const result = await copyClaudeTranscript({
      cwd,
      sessionId: "s-1",
      fromConfigDir: work,
      toConfigDir: home,
    });

    expect(result).toMatchObject({ status: "copied", previousSize: 4 });
    expect(await readFile(join(home, "projects", "elsewhere", "s-1.jsonl"), "utf8")).toBe(
      "old\nnew\n",
    );
    await expect(access(await claudeProjectDir(cwd, { configDir: home }))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("reports a missing transcript instead of throwing", async () => {
    const result = await copyClaudeTranscript({
      cwd,
      sessionId: "nope",
      fromConfigDir: join(root, ".claude"),
      toConfigDir: join(root, ".claude-work"),
    });
    expect(result).toEqual({ status: "missing" });
  });

  it("rethrows a read error that is not a missing file", async () => {
    // A config dir that is a file makes the transcript path fail with ENOTDIR, not ENOENT.
    const fromConfigDir = join(root, "not-a-dir");
    await writeFile(fromConfigDir, "");

    await expect(
      copyClaudeTranscript({
        cwd,
        sessionId: "s-1",
        fromConfigDir,
        toConfigDir: join(root, ".claude-work"),
      }),
    ).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});
