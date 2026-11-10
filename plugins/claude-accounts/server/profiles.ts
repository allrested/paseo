import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { AccountNameSchema, MAIN_PROVIDER, accountProvider } from "../shared/settings.js";
import { errorCode } from "./errors.js";

export interface ProfilePaths {
  home: string;
  /** The main profile: the daemon's CLAUDE_CONFIG_DIR when set, else ~/.claude. */
  mainDirectory: string;
  /** The daemon launches the main profile with CLAUDE_CONFIG_DIR set. */
  mainViaEnv: boolean;
  /** The accounts Add account wrote into: `<PASEO_HOME>/claude-accounts/added.json`. */
  recordFile: string;
}

export interface Profile {
  /** The account name; null for the main profile. */
  name: string | null;
  provider: string;
  directory: string;
  main: boolean;
  /** Launched with CLAUDE_CONFIG_DIR, so Claude Code keeps its config file in the directory. */
  viaEnv: boolean;
  /** `.credentials.json` exists in the directory. */
  credentials: boolean;
  /** Add account created or adopted it on this host. */
  added: boolean;
}

export interface Profiles {
  main: Profile;
  /** Sorted by name. */
  accounts: Profile[];
}

const ACCOUNT_PREFIX = ".claude-";

// Mirrors resolvePaseoHome (packages/server/src/server/paseo-home.ts) and claudeConfigDir
// (packages/server/src/server/agent/providers/claude/project-dir.ts), which a plugin bundle cannot
// import. Built-ins run in the daemon process, so `env` is the daemon's env.
export function profilePaths(env: NodeJS.ProcessEnv, home: string): ProfilePaths {
  const configDir = env.CLAUDE_CONFIG_DIR;
  const paseoHome = resolve(expandHome(env.PASEO_HOME ?? "~/.paseo", home));
  return {
    home,
    mainDirectory: resolve(configDir ?? join(home, ".claude")),
    mainViaEnv: configDir !== undefined,
    recordFile: join(paseoHome, "claude-accounts", "added.json"),
  };
}

function expandHome(input: string, home: string): string {
  if (input === "~") return home;
  return input.startsWith("~/") ? join(home, input.slice(2)) : input;
}

export function accountDirectory(home: string, name: string): string {
  return join(home, `${ACCOUNT_PREFIX}${name}`);
}

/**
 * The directory is the main profile's, through a symbolic link or spelled another way. Real paths
 * decide it, because the plugin never writes into the main profile.
 */
export async function isMainDirectory(paths: ProfilePaths, directory: string): Promise<boolean> {
  return (await realDirectory(directory)) === (await realDirectory(paths.mainDirectory));
}

export async function discoverProfiles(
  paths: ProfilePaths,
  added: readonly string[],
): Promise<Profiles> {
  const main: Profile = {
    name: null,
    provider: MAIN_PROVIDER,
    directory: paths.mainDirectory,
    main: true,
    viaEnv: paths.mainViaEnv,
    credentials: await hasCredentials(paths.mainDirectory),
    added: false,
  };
  const entries = (await readdir(paths.home))
    .filter((entry) => entry.startsWith(ACCOUNT_PREFIX))
    .sort((left, right) => left.localeCompare(right, "en"));
  const accounts: Profile[] = [];
  for (const entry of entries) {
    const name = entry.slice(ACCOUNT_PREFIX.length);
    const directory = join(paths.home, entry);
    if (!AccountNameSchema.safeParse(name).success) continue;
    if (!(await isDirectory(directory)) || (await isMainDirectory(paths, directory))) continue;
    accounts.push({
      name,
      provider: accountProvider(name),
      directory,
      main: false,
      viaEnv: true,
      credentials: await hasCredentials(directory),
      added: added.includes(name),
    });
  }
  return { main, accounts };
}

export function hasCredentials(directory: string): Promise<boolean> {
  return isFile(join(directory, ".credentials.json"));
}

/**
 * Claude Code's global config file for a profile: `.config.json` in the profile directory when it
 * exists, else `.claude.json` in CLAUDE_CONFIG_DIR, or in the home for a profile launched without
 * the variable.
 */
export async function claudeConfigFile(
  profile: Pick<Profile, "directory" | "viaEnv">,
  home: string,
): Promise<string> {
  const legacy = join(profile.directory, ".config.json");
  if (await isFile(legacy)) return legacy;
  return join(profile.viaEnv ? profile.directory : home, ".claude.json");
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

// Follows symbolic links, so a linked account directory counts.
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

// A missing path keeps its own spelling, so two missing paths match only when spelled the same.
async function realDirectory(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (isMissing(error)) return resolve(path);
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

const AddedRecordSchema = z.object({
  version: z.literal(1),
  names: z.array(AccountNameSchema),
});

export async function readAddedAccounts(recordFile: string): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(recordFile, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
  const record = AddedRecordSchema.safeParse(parseJson(text));
  if (!record.success) {
    throw new Error(`${recordFile} is not valid. Fix it, or delete it and add the accounts again.`);
  }
  return record.data.names;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Adds a name to the record. Calls must not overlap with each other or with
 * `forgetAddedAccount`: they share the temp file and the read before the write. Add and Remove,
 * the only callers, run one at a time.
 */
export async function recordAddedAccount(recordFile: string, name: string): Promise<void> {
  const names = await readAddedAccounts(recordFile);
  if (names.includes(name)) return;
  await writeAddedAccounts(
    recordFile,
    [...names, name].sort((left, right) => left.localeCompare(right, "en")),
  );
}

/** Drops a name from the record. The same no-overlap rule as `recordAddedAccount` applies. */
export async function forgetAddedAccount(recordFile: string, name: string): Promise<void> {
  const names = await readAddedAccounts(recordFile);
  if (!names.includes(name)) return;
  await writeAddedAccounts(
    recordFile,
    names.filter((candidate) => candidate !== name),
  );
}

// Through a temp file, with mode 0600, so a reader never sees half a record.
async function writeAddedAccounts(recordFile: string, next: readonly string[]): Promise<void> {
  await mkdir(dirname(recordFile), { recursive: true, mode: 0o700 });
  const temp = `${recordFile}.${process.pid}.tmp`;
  await rm(temp, { force: true });
  await writeFile(temp, `${JSON.stringify({ version: 1, names: next }, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temp, recordFile);
}
