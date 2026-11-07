import { realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { RUN_ID_PATTERN } from "../shared/run.js";
import { isFileError, isInside, isMissing, listNames } from "./files.js";

/** Claude Code session ids are lowercase UUIDs. */
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `~/.claude-<name>`, a profile made with `CLAUDE_CONFIG_DIR=~/.claude-<name> claude`. */
const PROFILE_DIR = /^\.claude-./;

export interface ConfigDirLookup {
  home: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Every Claude Code config dir that exists, in the order they are searched: CLAUDE_CONFIG_DIR,
 * ~/.claude, then each ~/.claude-<name> profile by name. A dir named twice is listed once.
 */
export async function claudeConfigDirs(lookup: ConfigDirLookup): Promise<string[]> {
  const candidates: string[] = [];
  const custom = lookup.env.CLAUDE_CONFIG_DIR;
  if (custom) candidates.push(resolve(custom));
  candidates.push(join(lookup.home, ".claude"));
  const names = await listNames(lookup.home);
  for (const name of names.filter((entry) => PROFILE_DIR.test(entry)).sort()) {
    candidates.push(join(lookup.home, name));
  }
  const dirs: string[] = [];
  for (const dir of new Set(candidates)) {
    if (await isDirectory(dir)) dirs.push(dir);
  }
  return dirs;
}

// Copied from packages/server/src/server/agent/providers/claude/project-dir.ts (canonicalize,
// normalizeProjectPath, encode, hashSuffix), which a built-in cannot import. It ports Claude
// Code's own encoding of a session's project dir name.
const PROJECT_DIR_LENGTH_CAP = 200;

/** The name Claude Code gives the project dir of a session started in `cwd`. */
export async function projectSlug(cwd: string): Promise<string> {
  return encode(await canonicalize(cwd));
}

async function canonicalize(input: string): Promise<string> {
  try {
    return normalizeProjectPath(await realpath(input));
  } catch (error) {
    // The source falls back to the path as given whenever realpath fails.
    if (isFileError(error)) return normalizeProjectPath(input);
    throw error;
  }
}

function normalizeProjectPath(input: string): string {
  if (process.platform === "darwin") return input.normalize("NFC");
  return input;
}

function encode(input: string): string {
  const replaced = input.replace(/[^a-zA-Z0-9]/g, "-");
  if (replaced.length <= PROJECT_DIR_LENGTH_CAP) {
    return replaced;
  }
  return `${replaced.slice(0, PROJECT_DIR_LENGTH_CAP)}-${hashSuffix(input)}`;
}

function hashSuffix(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/** Real paths of a run: its config dir, its session dir and its run dir. */
export interface RunLocation {
  configDir: string;
  sessionDir: string;
  runDir: string;
  /** The session the run was found in, which the state check asks about. */
  sessionId: string;
}

export interface LocateRunInput {
  configDirs: string[];
  cwd: string;
  sessionId: string;
  runId: string;
}

/**
 * Finds `<config>/projects/<project>/<session>/subagents/workflows/<runId>`. The agent's current
 * session comes first: in each config dir, the cwd's slug, then every other project dir. Then,
 * config dir by config dir, the other sessions under the cwd's slug: a `/clear` or a restart gives
 * the agent a new session id, while its earlier cards still name runs of the session it left. The
 * first match wins.
 */
export async function locateRun(input: LocateRunInput): Promise<RunLocation | null> {
  const validIds = SESSION_ID_PATTERN.test(input.sessionId) && RUN_ID_PATTERN.test(input.runId);
  if (!validIds) return null;
  const slug = await projectSlug(input.cwd);
  for (const configDir of input.configDirs) {
    const found = await locateInConfigDir({ configDir, slug, input });
    if (found !== null) return found;
  }
  for (const configDir of input.configDirs) {
    const found = await locateInOtherSessions({ configDir, slug, input });
    if (found !== null) return found;
  }
  return null;
}

interface ConfigDirSearch {
  configDir: string;
  slug: string;
  input: LocateRunInput;
}

async function locateInConfigDir(search: ConfigDirSearch): Promise<RunLocation | null> {
  const { configDir, slug, input } = search;
  const projectsDir = join(configDir, "projects");
  const candidate = (project: string): RunCandidate => ({
    configDir,
    sessionDir: join(projectsDir, project, input.sessionId),
    sessionId: input.sessionId,
    runId: input.runId,
  });
  const atSlug = await runLocation(candidate(slug));
  if (atSlug !== null) return atSlug;
  // Claude Code keeps a resumed session in the project dir where it started.
  for (const project of await listNames(projectsDir)) {
    if (project === slug) continue;
    const found = await runLocation(candidate(project));
    if (found !== null) return found;
  }
  return null;
}

/**
 * The other sessions under the cwd's slug in one config dir. Only names in the session id format
 * count: the project dir also holds `<session>.jsonl` transcripts and `memory/`.
 */
async function locateInOtherSessions(search: ConfigDirSearch): Promise<RunLocation | null> {
  const { configDir, slug, input } = search;
  const projectDir = join(configDir, "projects", slug);
  for (const name of await listNames(projectDir)) {
    if (name === input.sessionId || !SESSION_ID_PATTERN.test(name)) continue;
    const found = await runLocation({
      configDir,
      sessionDir: join(projectDir, name),
      sessionId: name,
      runId: input.runId,
    });
    if (found !== null) return found;
  }
  return null;
}

interface RunCandidate {
  configDir: string;
  sessionDir: string;
  sessionId: string;
  runId: string;
}

async function runLocation(candidate: RunCandidate): Promise<RunLocation | null> {
  let runDir: string;
  try {
    runDir = await realpath(join(candidate.sessionDir, "subagents", "workflows", candidate.runId));
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  const configDir = await realpath(candidate.configDir);
  const sessionDir = await realpath(candidate.sessionDir);
  const contained = isInside(configDir, sessionDir) && isInside(configDir, runDir);
  if (!contained) return null;
  if (!(await isDirectory(runDir))) return null;
  return { configDir, sessionDir, runDir, sessionId: candidate.sessionId };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}
