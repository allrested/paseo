// Where Claude Code keeps its transcripts on this host: <config folder>/projects/<folder slug>/
// <session id>.jsonl, for the main config folder and for each account claude-accounts made.
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

// plugins/claude-accounts/server/profiles.ts names an account's folder ~/.claude-<name>.
const ACCOUNT_PREFIX = ".claude-";
const TRANSCRIPT = ".jsonl";

export interface Transcript {
  file: string;
  /** The file's name: Claude Code names a transcript after its session. */
  sessionId: string;
  changedAt: string;
}

/** The projects folders that exist, the main one first, each real folder once. */
export function transcriptRoots(env: NodeJS.ProcessEnv, home: string): string[] {
  const configDirs = [env.CLAUDE_CONFIG_DIR || join(home, ".claude")];
  let names: string[] = [];
  try {
    names = readdirSync(home);
  } catch {
    // No home folder to read: the main config folder is the only candidate.
  }
  for (const name of names.toSorted()) {
    if (name.startsWith(ACCOUNT_PREFIX)) configDirs.push(join(home, name));
  }
  const seen = new Set<string>();
  const roots: string[] = [];
  for (const configDir of configDirs) {
    const root = join(configDir, "projects");
    if (!existsSync(root)) continue;
    const real = realpathSync(root);
    if (seen.has(real)) continue;
    seen.add(real);
    roots.push(root);
  }
  return roots;
}

// Any read error means the same here: the folder or the file went away since it was listed.
async function namesIn(dir: string): Promise<string[]> {
  return readdir(dir).catch((): string[] => []);
}

async function transcriptAt(dir: string, name: string): Promise<Transcript | null> {
  if (!name.endsWith(TRANSCRIPT)) return null;
  const file = join(dir, name);
  const info = await stat(file).catch((): null => null);
  if (info === null || !info.isFile()) return null;
  return {
    file,
    sessionId: name.slice(0, -TRANSCRIPT.length),
    changedAt: info.mtime.toISOString(),
  };
}

/**
 * Every chat's transcript under the roots, newest first. Only the files directly inside a project
 * folder: deeper ones are subagents' side chats.
 */
export async function listTranscripts(roots: readonly string[]): Promise<Transcript[]> {
  const found: Transcript[] = [];
  for (const root of roots) {
    for (const project of await namesIn(root)) {
      const dir = join(root, project);
      const names = await namesIn(dir);
      const entries = await Promise.all(names.map((name) => transcriptAt(dir, name)));
      for (const entry of entries) if (entry !== null) found.push(entry);
    }
  }
  return found.toSorted((a, b) => b.changedAt.localeCompare(a.changedAt));
}
