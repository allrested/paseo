import type { Dirent } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SkillInfo, SkillsResult } from "../shared/contracts.js";
import { errorMessage } from "./errors.js";
import { workspaceSkillFolders, type SkillFolder } from "./paths.js";

/** Skills read from one folder, by folder name; a folder with more is cut. */
export const SKILLS_PER_FOLDER = 100;
/** What is read of a SKILL.md: the front matter is at its top. */
export const SKILL_HEAD_BYTES = 8192;
export const DESCRIPTION_MAX = 300;
const NAME_MAX = 80;

/** A skill as its folder has it, before the folders are merged. */
export interface FoundSkill {
  name: string;
  description: string | null;
}

export interface SkillFiles {
  /** The names of a folder's entries that are folders, links to one included; [] when it is missing. */
  folders(path: string): Promise<string[]>;
  /** The first `bytes` of a file as text; null when it is missing. */
  head(path: string, bytes: number): Promise<string | null>;
}

export interface SkillsPorts {
  files: SkillFiles;
  hostFolders: readonly SkillFolder[];
  /** The workspaces the office knows now. */
  workspaceIds(): readonly string[];
  /** A workspace's folder; null when it has none. */
  workspaceFolder(workspaceId: string): Promise<string | null>;
  now(): number;
  log(message: string): void;
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function unquote(value: string): string {
  const first = value.at(0);
  if (value.length >= 2 && (first === '"' || first === "'") && value.at(-1) === first) {
    return value.slice(1, -1);
  }
  return value;
}

/** A key's value in front matter: one line, or the indented lines of a `>` or `|` block. */
function frontValue(lines: readonly string[], key: string): string | null {
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  const line = lines[index];
  if (line === undefined) return null;
  const value = line.slice(key.length + 1).trim();
  if (value !== "" && !/^[>|][+-]?$/.test(value)) return unquote(value);
  const block: string[] = [];
  for (const next of lines.slice(index + 1)) {
    if (next.trim() !== "" && !/^\s/.test(next)) break;
    block.push(next.trim());
  }
  const joined = block.filter((part) => part !== "").join(" ");
  return joined === "" ? null : joined;
}

const FRONT_MATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** A SKILL.md's name and description, from its front matter; the folder names one without. */
export function parseSkill(folderName: string, text: string): FoundSkill {
  const front = FRONT_MATTER.exec(text)?.[1];
  if (front === undefined) return { name: folderName, description: null };
  const lines = front.split(/\r?\n/);
  const name = frontValue(lines, "name")?.trim();
  const description = frontValue(lines, "description")?.replace(/\s+/g, " ").trim();
  return {
    name: name ? cut(name, NAME_MAX) : folderName,
    description: description ? cut(description, DESCRIPTION_MAX) : null,
  };
}

/** A folder's skills: its folders that hold a SKILL.md, by name, hidden ones left out. */
export async function readSkillFolder(files: SkillFiles, path: string): Promise<FoundSkill[]> {
  const names = (await files.folders(path)).filter((name) => !name.startsWith(".")).sort();
  const found: FoundSkill[] = [];
  for (const name of names) {
    if (found.length >= SKILLS_PER_FOLDER) break;
    const text = await files.head(join(path, name, "SKILL.md"), SKILL_HEAD_BYTES);
    if (text !== null) found.push(parseSkill(name, text));
  }
  return found;
}

/** One row per name, with every folder it is in; the first description found is kept. */
export function mergeSkills(
  groups: readonly { label: string; skills: readonly FoundSkill[] }[],
): SkillInfo[] {
  const byName = new Map<string, SkillInfo>();
  for (const group of groups) {
    for (const skill of group.skills) {
      const known = byName.get(skill.name);
      if (known === undefined) {
        byName.set(skill.name, {
          name: skill.name,
          description: skill.description,
          folders: [group.label],
        });
        continue;
      }
      if (!known.folders.includes(group.label)) known.folders.push(group.label);
      known.description ??= skill.description;
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function readFolders(ports: SkillsPorts, folders: readonly SkillFolder[]) {
  const groups: { label: string; skills: FoundSkill[] }[] = [];
  for (const folder of folders) {
    try {
      groups.push({ label: folder.label, skills: await readSkillFolder(ports.files, folder.path) });
    } catch (error) {
      ports.log(`[office] skills in ${folder.path} not read: ${errorMessage(error)}`);
    }
  }
  return mergeSkills(groups);
}

/** The host's skills and every workspace's. A folder or a workspace that fails is left out. */
export async function readSkills(ports: SkillsPorts): Promise<SkillsResult> {
  const host = await readFolders(ports, ports.hostFolders);
  const workspaces: Record<string, SkillInfo[]> = {};
  for (const workspaceId of ports.workspaceIds()) {
    let folder: string | null;
    try {
      folder = await ports.workspaceFolder(workspaceId);
    } catch (error) {
      ports.log(`[office] skills of workspace ${workspaceId} not read: ${errorMessage(error)}`);
      continue;
    }
    if (folder !== null)
      workspaces[workspaceId] = await readFolders(ports, workspaceSkillFolders(folder));
  }
  return { host, workspaces, readAt: new Date(ports.now()).toISOString() };
}

function isMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = Reflect.get(error, "code");
  return code === "ENOENT" || code === "ENOTDIR";
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** The files on the daemon's own disk. */
export const nodeSkillFiles: SkillFiles = {
  async folders(path) {
    let entries: Dirent[];
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const names: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) names.push(entry.name);
      else if (entry.isSymbolicLink() && (await isFolder(join(path, entry.name)))) {
        names.push(entry.name);
      }
    }
    return names;
  },
  async head(path, bytes) {
    let handle;
    try {
      handle = await open(path, "r");
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  },
};
