import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { git } from "./git.js";

/** One working folder's store. */
export interface Shadow {
  /** The bare repository that holds the history. */
  gitDir: string;
  /** Its object directory: snapshots write here, never to the person's repository. */
  objects: string;
  /** The snapshot index: the folder as the last snapshot saw it. */
  snapIndex: string;
  /** A folder for short-lived index files. */
  scratch: string;
}

const FOLDER_FILE = "folder.json";

function keyOf(top: string): string {
  return createHash("sha256").update(top).digest("hex").slice(0, 24);
}

function shadowAt(root: string, top: string): Shadow {
  const home = join(root, keyOf(top));
  const gitDir = join(home, "git");
  return {
    gitDir,
    objects: join(gitDir, "objects"),
    snapIndex: join(home, "snap.index"),
    scratch: home,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The store of the checkout at `top`, made when it is missing. */
export async function openShadow(root: string, top: string): Promise<Shadow> {
  const shadow = shadowAt(root, top);
  if (await exists(join(shadow.gitDir, "HEAD"))) return shadow;
  await mkdir(shadow.scratch, { recursive: true, mode: 0o700 });
  await git(["init", "--quiet", "--bare", shadow.gitDir]);
  // The folder's path is what tells a store whose folder is gone from one still in use.
  await writeFile(join(shadow.scratch, FOLDER_FILE), JSON.stringify({ version: 1, folder: top }), {
    mode: 0o600,
  });
  return shadow;
}

/** The store of the checkout at `top` when one was made, else null: reading makes none. */
export async function findShadow(root: string, top: string): Promise<Shadow | null> {
  const shadow = shadowAt(root, top);
  return (await exists(join(shadow.gitDir, "HEAD"))) ? shadow : null;
}

async function folderOf(home: string): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(home, FOLDER_FILE), "utf8"));
    const folder = (parsed as { folder?: unknown } | null)?.folder;
    return typeof folder === "string" ? folder : null;
  } catch {
    return null;
  }
}

/** Removes the stores of folders that no longer exist. Answers how many went. */
export async function removeOrphans(root: string): Promise<number> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    const home = join(root, name);
    const folder = await folderOf(home);
    // A store without its folder file is not one of ours to judge.
    if (folder === null || (await exists(folder))) continue;
    await rm(home, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}
