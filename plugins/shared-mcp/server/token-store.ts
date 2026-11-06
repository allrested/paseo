import { randomBytes, randomUUID } from "node:crypto";
import { link, mkdir, open, rm, writeFile, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const TOKEN_FILE_MODE = 0o600;
// link() fails with one of these on filesystems without hard links: exFAT, some FUSE and network
// mounts, some container volume drivers.
const NO_HARD_LINK_CODES = new Set(["EPERM", "ENOTSUP", "ENOSYS"]);

export class InvalidTokenFileError extends Error {
  readonly file: string;

  constructor(file: string) {
    super(`${file} does not hold a 64-character hex token; delete it to create a new one`);
    this.name = "InvalidTokenFileError";
    this.file = file;
  }
}

function errnoCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

async function openIfPresent(file: string): Promise<FileHandle | null> {
  try {
    return await open(file, "r");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  }
}

// A token copied in or restored from a backup can arrive readable by others. Tighten it the way
// the daemon's private-files.ts does: skip Windows and ignore filesystems that refuse chmod.
async function restrictMode(handle: FileHandle): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  const { mode } = await handle.stat();
  if ((mode & 0o077) !== 0) {
    await handle.chmod(TOKEN_FILE_MODE).catch(() => {});
  }
}

// Null means nothing readable sits at the path, which includes a symlink to a missing target.
async function readToken(file: string): Promise<string | null> {
  const handle = await openIfPresent(file);
  if (handle === null) {
    return null;
  }
  try {
    const token = (await handle.readFile("utf8")).trim();
    if (!TOKEN_PATTERN.test(token)) {
      throw new InvalidTokenFileError(file);
    }
    await restrictMode(handle);
    return token;
  } finally {
    await handle.close();
  }
}

async function createExclusive(file: string, token: string): Promise<boolean> {
  try {
    await writeFile(file, `${token}\n`, { flag: "wx", mode: TOKEN_FILE_MODE });
    return true;
  } catch (error) {
    if (errnoCode(error) === "EEXIST") {
      return false;
    }
    throw error;
  }
}

// link() fails when the target exists, so racing callers all keep the token that linked first,
// and a reader never sees a half-written file. Without hard links, an exclusive create stands in;
// a reader can then catch the file half-written, which the wiring avoids by sharing one promise.
async function placeToken(tempFile: string, file: string, token: string): Promise<boolean> {
  try {
    await link(tempFile, file);
    return true;
  } catch (error) {
    const code = errnoCode(error);
    if (code === "EEXIST") {
      return false;
    }
    if (code !== undefined && NO_HARD_LINK_CODES.has(code)) {
      return createExclusive(file, token);
    }
    throw error;
  }
}

async function createTokenIfAbsent(file: string): Promise<string | null> {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const tempFile = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempFile, `${token}\n`, { mode: TOKEN_FILE_MODE });
    return (await placeToken(tempFile, file, token)) ? token : null;
  } finally {
    await rm(tempFile, { force: true });
  }
}

// One token per daemon home. Servers adopted as external and agents launched before a daemon
// restart still hold it, so it is read back on every start instead of being replaced.
export async function loadOrCreateToken(file: string): Promise<string> {
  const existing = await readToken(file);
  if (existing !== null) {
    return existing;
  }
  await mkdir(dirname(file), { recursive: true });
  const created = await createTokenIfAbsent(file);
  if (created !== null) {
    return created;
  }
  // Another caller linked its token first, so one more read finds it. A second miss means the
  // name is taken by something unreadable, such as a dangling symlink: fail instead of looping.
  const raced = await readToken(file);
  if (raced === null) {
    throw new InvalidTokenFileError(file);
  }
  return raced;
}
