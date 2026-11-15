import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { GitError, gitText } from "./git.js";

/** The checkout a folder belongs to. */
export interface WorkTree {
  /** The checkout's top folder, with links resolved. */
  top: string;
  /** Where the repository keeps its objects. */
  objects: string;
  /** The checkout's own index file; it may not exist yet. */
  index: string;
}

/** The checkout `folder` is in, or null outside one and in a bare repository. */
export async function findWorkTree(folder: string): Promise<WorkTree | null> {
  let answer: string;
  try {
    answer = await gitText(
      ["rev-parse", "--show-toplevel", "--git-common-dir", "--git-path", "index"],
      { cwd: folder },
    );
  } catch (error) {
    // Not a repository, no work tree, or a folder that is gone.
    if (error instanceof GitError || (error as NodeJS.ErrnoException).code === "ENOENT")
      return null;
    throw error;
  }
  const [top, common, index] = answer.split("\n");
  if (!top || !common || !index) return null;
  return {
    top: await realpath(top),
    // Git answers both paths relative to the folder it ran in.
    objects: resolve(folder, common, "objects"),
    index: resolve(folder, index),
  };
}
