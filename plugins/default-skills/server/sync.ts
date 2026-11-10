import { createHash, type Hash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { SkillEntry } from "../shared/catalog.js";
import type { FolderStatus, SkillStatus, SyncStatus } from "../shared/rpc.js";

export const SKIPPED_REASON = "a folder with this name exists";

export interface SyncInput {
  /** `vendor/` in the plugin directory: `<skill id>/<folder>/` for every catalog folder. */
  vendorDirectory: string;
  /** The main Claude config folder's `skills/`. */
  skillsDirectory: string;
  recordFile: string;
  skills: readonly SkillEntry[];
  /** On or off per skill id; a missing id counts as off. */
  switches: Readonly<Record<string, boolean>>;
}

const RecordSchema = z.object({
  version: z.literal(1),
  /** Folders the plugin created, with the content hash it wrote. */
  folders: z.record(z.string(), z.object({ skill: z.string(), hash: z.string() })),
});

type OwnershipRecord = z.output<typeof RecordSchema>;
type OwnedFolders = OwnershipRecord["folders"];

/**
 * Makes the skills folder match the switches. A folder counts as the plugin's only while the record
 * names it and its content still hashes to what the plugin wrote, so a folder the user made or
 * edited is never replaced or removed. Resolves for every failure: it runs inside the daemon.
 */
export async function syncSkills(input: SyncInput): Promise<SyncStatus> {
  try {
    const owned = await readRecord(input.recordFile);
    if (owned === null) {
      return {
        status: "failed",
        error: `${input.recordFile} is not valid. Fix it, or delete it: every installed folder then counts as yours.`,
      };
    }
    const next: OwnedFolders = {};
    const skills: SkillStatus[] = [];
    for (const skill of input.skills) {
      const folders: FolderStatus[] = [];
      for (const folder of skill.folders) {
        folders.push(
          await syncFolder({ input, skill, folder, owned: owned[folder] ?? null, next }),
        );
      }
      skills.push({ id: skill.id, folders });
    }
    const listed = new Set(input.skills.flatMap((skill) => skill.folders));
    for (const [folder, entry] of Object.entries(owned)) {
      if (listed.has(folder)) continue;
      // Dropped from the catalog: remove the plugin's copy, keep the record entry if that fails.
      try {
        await removeIfOwned(join(input.skillsDirectory, folder), entry.hash);
      } catch {
        next[folder] = entry;
      }
    }
    const recordError = await writeRecord(input.recordFile, next).then(
      () => null,
      (error: unknown) => `Saving ${input.recordFile} failed: ${describeError(error)}`,
    );
    return { status: "done", skillsDirectory: input.skillsDirectory, skills, recordError };
  } catch (error) {
    return { status: "failed", error: describeError(error) };
  }
}

interface FolderSync {
  input: SyncInput;
  skill: SkillEntry;
  folder: string;
  owned: OwnedFolders[string] | null;
  /** The record being built; the folder's entry goes here while the plugin still owns it. */
  next: OwnedFolders;
}

async function syncFolder({
  input,
  skill,
  folder,
  owned,
  next,
}: FolderSync): Promise<FolderStatus> {
  const target = join(input.skillsDirectory, folder);
  try {
    const onDisk = await hashTree(target);
    const ours = owned !== null && onDisk !== null && onDisk.hash === owned.hash;
    if (input.switches[skill.id] !== true) {
      if (ours) await rm(target, { recursive: true, force: true });
      return { folder, state: "off" };
    }
    if (onDisk !== null && !ours) return { folder, state: "skipped", reason: SKIPPED_REASON };
    const source = join(input.vendorDirectory, skill.id, folder);
    const vendored = await hashTree(source);
    if (vendored === null) throw new Error(`${source} is missing`);
    if (vendored.hash === NOT_PLAIN) throw new Error(`${source} holds a link or a special file`);
    if (onDisk === null) {
      await install(source, target);
    } else if (onDisk.hash !== vendored.hash) {
      await replace(source, target);
    }
    next[folder] = { skill: skill.id, hash: vendored.hash };
    return { folder, state: "installed" };
  } catch (error) {
    if (owned !== null) next[folder] = owned;
    return { folder, state: "error", error: describeError(error) };
  }
}

async function install(source: string, target: string): Promise<void> {
  const staging = await stage(source, target);
  await rename(staging, target);
}

async function replace(source: string, target: string): Promise<void> {
  const staging = await stage(source, target);
  const retired = `${siblingPrefix(target)}old`;
  await rm(retired, { recursive: true, force: true });
  await rename(target, retired);
  await rename(staging, target);
  await rm(retired, { recursive: true, force: true });
}

// A sibling of the target, so the final rename stays on one filesystem.
async function stage(source: string, target: string): Promise<string> {
  await mkdir(dirname(target), { recursive: true });
  const staging = `${siblingPrefix(target)}new`;
  await rm(staging, { recursive: true, force: true });
  try {
    await cp(source, staging, { recursive: true, errorOnExist: true, force: false });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return staging;
}

function siblingPrefix(target: string): string {
  const name = target.slice(dirname(target).length + 1);
  return join(dirname(target), `.${name}.default-skills-${process.pid}-`);
}

async function removeIfOwned(target: string, hash: string): Promise<void> {
  const onDisk = await hashTree(target);
  if (onDisk !== null && onDisk.hash === hash) await rm(target, { recursive: true, force: true });
}

interface TreeHash {
  hash: string;
}

/** Never a sha256 digest, so a folder with this hash never matches a recorded one. */
const NOT_PLAIN = "not-a-plain-folder";

/**
 * A hash of the folder's file names and contents, or NOT_PLAIN when it is not a directory or holds
 * a link or another special file. Null when nothing is there.
 */
async function hashTree(root: string): Promise<TreeHash | null> {
  const info = await lstat(root).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  });
  if (info === null) return null;
  if (!info.isDirectory()) return { hash: NOT_PLAIN };
  const hash = createHash("sha256");
  if (!(await hashDirectory(root, "", hash))) return { hash: NOT_PLAIN };
  return { hash: hash.digest("hex") };
}

/** False as soon as an entry is neither a file nor a directory. */
async function hashDirectory(root: string, relative: string, hash: Hash): Promise<boolean> {
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  entries.sort((left, right) => compareNames(left.name, right.name));
  for (const entry of entries) {
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      hash.update(`d\0${path}\0`);
      if (!(await hashDirectory(root, path, hash))) return false;
    } else if (entry.isFile()) {
      const content = await readFile(join(root, path));
      hash.update(`f\0${path}\0${content.length}\0`);
      hash.update(content);
    } else {
      return false;
    }
  }
  return true;
}

// Code unit order, the same on every machine and locale.
function compareNames(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** The folders the record names; an empty set when there is no record, null when it is invalid. */
async function readRecord(recordFile: string): Promise<OwnedFolders | null> {
  let text: string;
  try {
    text = await readFile(recordFile, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return {};
    throw error;
  }
  try {
    const parsed = RecordSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data.folders : null;
  } catch {
    return null;
  }
}

// Through a temp file, so a reader never sees half a record.
async function writeRecord(recordFile: string, folders: OwnedFolders): Promise<void> {
  await mkdir(dirname(recordFile), { recursive: true, mode: 0o700 });
  const temp = `${recordFile}.${process.pid}.tmp`;
  await rm(temp, { force: true });
  const record: OwnershipRecord = { version: 1, folders };
  await writeFile(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temp, recordFile);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
