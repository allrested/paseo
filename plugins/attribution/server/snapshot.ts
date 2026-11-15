import { access, constants, copyFile, lstat, rm } from "node:fs/promises";
import { join } from "node:path";
import { git, gitText } from "./git.js";
import type { Shadow } from "./shadow.js";
import type { WorkTree } from "./work-tree.js";

/** A file larger than this is not tracked. */
export const FILE_MAX_BYTES = 1024 * 1024;
/** A snapshot that finds more changed paths than this is given up: an unignored build folder. */
export const SNAPSHOT_MAX_PATHS = 20_000;

/** A snapshot that was not taken, for a reason that is no fault. */
export class SnapshotSkipped extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SnapshotSkipped";
  }
}

/**
 * Git reads the checkout's config, ignore rules and filters from the folder it runs in, and
 * writes to the shadow's index and objects. The repository's objects are only read.
 */
export function snapshotEnv(workTree: WorkTree, shadow: Shadow): Record<string, string> {
  return {
    GIT_INDEX_FILE: shadow.snapIndex,
    GIT_OBJECT_DIRECTORY: shadow.objects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: workTree.objects,
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const LIST = ["ls-files", "-z", "--others", "--modified", "--deleted", "--exclude-standard"];

/** The paths that differ from the snapshot index, each once. */
async function changedPaths(workTree: WorkTree, shadow: Shadow): Promise<string[]> {
  const options = { cwd: workTree.top, env: snapshotEnv(workTree, shadow) };
  let listed: Buffer;
  if (await fileExists(shadow.snapIndex)) {
    listed = await git(LIST, options);
  } else {
    // The repository's index already knows which files are unchanged: starting from a copy
    // spares hashing the whole checkout.
    if (await fileExists(workTree.index)) await copyFile(workTree.index, shadow.snapIndex);
    try {
      listed = await git(LIST, options);
    } catch {
      // A split or sparse index does not survive the copy. Start from the last commit instead;
      // a repository without one starts empty.
      await rm(shadow.snapIndex, { force: true });
      await git(["read-tree", "HEAD"], options).catch(() => undefined);
      listed = await git(LIST, options);
    }
  }
  return Array.from(new Set(listed.toString("utf8").split("\0").filter(Boolean)));
}

/** Whether the snapshot takes the path as it is on disk now. */
async function takes(top: string, path: string): Promise<boolean> {
  // An untracked folder with its own repository is listed with a trailing slash.
  if (path.endsWith("/")) return false;
  const full = join(top, path);
  const found = await lstat(full).catch(() => null);
  // Gone, or a folder where a file was: the index drops the entry.
  if (found === null || found.isDirectory()) return true;
  if (found.isSymbolicLink()) return true;
  if (!found.isFile() || found.size > FILE_MAX_BYTES) return false;
  // One unreadable file would fail the whole update.
  return access(full, constants.R_OK).then(
    () => true,
    () => false,
  );
}

/**
 * Writes the checkout's state as a tree in the shadow store and answers its id. Ignored files
 * stay out, and so do files over the size limit.
 */
export async function snapshot(workTree: WorkTree, shadow: Shadow): Promise<string> {
  const options = { cwd: workTree.top, env: snapshotEnv(workTree, shadow) };
  const paths = await changedPaths(workTree, shadow);
  if (paths.length > SNAPSHOT_MAX_PATHS) {
    throw new SnapshotSkipped(`${paths.length} changed paths, more than ${SNAPSHOT_MAX_PATHS}`);
  }
  const taken: string[] = [];
  for (const path of paths) {
    if (await takes(workTree.top, path)) taken.push(path);
  }
  if (taken.length > 0) {
    await git(["update-index", "-z", "--add", "--remove", "--replace", "--stdin"], {
      ...options,
      input: `${taken.join("\0")}\0`,
    });
  }
  return gitText(["write-tree"], options);
}
