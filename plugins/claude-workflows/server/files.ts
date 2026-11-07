import { readdir } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

// ENOENT and ENOTDIR: the path, or a directory on it, does not exist. ESRCH: a /proc entry whose
// process exited while it was being read.
const MISSING_CODES: ReadonlySet<string> = new Set(["ENOENT", "ENOTDIR", "ESRCH"]);

const ERRNO_CODE = /^E[A-Z]+$/;

/** The errno code a failed file operation carries, or null for any other error. */
function errnoCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (!("code" in error)) return null;
  const { code } = error;
  if (typeof code !== "string") return null;
  return ERRNO_CODE.test(code) ? code : null;
}

/** Whether a file operation failed because its path, or a /proc entry, is gone. */
export function isMissing(error: unknown): boolean {
  const code = errnoCode(error);
  return code !== null && MISSING_CODES.has(code);
}

/** Whether a file operation failed with an errno code, as opposed to a bug. */
export function isFileError(error: unknown): boolean {
  return errnoCode(error) !== null;
}

/** The names in a directory; none when the directory does not exist. */
export async function listNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

/** The value of a JSON text, or undefined when the text is not complete JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

/** Whether `child` lies below `parent`. Both are absolute; `parent` itself does not count. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  const escapes = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  return rel !== "" && !escapes;
}
