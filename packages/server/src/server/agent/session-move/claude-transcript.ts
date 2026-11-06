import { mkdir, readFile, rename, rm, truncate, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { claudeTranscriptPath } from "../providers/claude/project-dir.js";

/** A transcript copy, enough to undo it: `previousSize` is null when the copy created the file. */
export interface ClaudeTranscriptCopy {
  path: string;
  previousSize: number | null;
}

export type CopyClaudeTranscriptResult =
  | ({ status: "copied" } & ClaudeTranscriptCopy)
  | { status: "missing" }
  | { status: "diverged"; path: string };

/** Reads a file, or returns null when it does not exist. Any other read error is thrown. */
async function readIfExists(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Claude Code resumes a session only from its own config dir's projects folder, so moving a
 * session to another login (CLAUDE_CONFIG_DIR) means copying the transcript across first.
 * Only a missing source counts as "missing"; any other read error is thrown. A target that is
 * not a byte prefix of the source holds turns the source lacks, so it is left alone and reported
 * as "diverged". The copy goes through a temp file, so a failed copy never touches the target.
 */
export async function copyClaudeTranscript(input: {
  cwd: string;
  sessionId: string;
  fromConfigDir: string;
  toConfigDir: string;
}): Promise<CopyClaudeTranscriptResult> {
  const sourcePath = await claudeTranscriptPath({
    cwd: input.cwd,
    sessionId: input.sessionId,
    configDir: input.fromConfigDir,
  });
  const source = await readIfExists(sourcePath);
  if (!source) return { status: "missing" };
  // Claude Code named the source's project folder from its own view of the cwd, which can differ
  // from ours (a moved project, WSL). Keep that name so the target resumes the same file and a
  // move back overwrites the original instead of writing a second copy.
  const targetDir = join(input.toConfigDir, "projects", basename(dirname(sourcePath)));
  await mkdir(targetDir, { recursive: true });
  const target = join(targetDir, `${input.sessionId}.jsonl`);
  const existing = await readIfExists(target);
  if (
    existing &&
    (source.length < existing.length || !source.subarray(0, existing.length).equals(existing))
  ) {
    return { status: "diverged", path: target };
  }
  const temp = `${target}.paseo-move-tmp`;
  try {
    await writeFile(temp, source);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return { status: "copied", path: target, previousSize: existing ? existing.length : null };
}

/** Undoes a copy: removes a file it created, or cuts a replaced one back to its old bytes. */
export async function undoClaudeTranscriptCopy(copy: ClaudeTranscriptCopy): Promise<void> {
  if (copy.previousSize === null) {
    await rm(copy.path, { force: true });
    return;
  }
  // The old file was a prefix of the copy, so truncating restores it byte for byte.
  await truncate(copy.path, copy.previousSize);
}
