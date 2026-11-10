import type { SyncStatus } from "../shared/rpc.js";

export interface SkillLine {
  /** What the skill's folders are, for the row's hint. */
  state: string;
  /** Folders that failed, or why the whole sync failed. */
  error: string | null;
}

export function describeSkill(status: SyncStatus | undefined, id: string): SkillLine {
  if (status === undefined || status.status === "pending")
    return { state: "Not synced yet", error: null };
  if (status.status === "failed") return { state: "Not synced", error: status.error };
  const skill = status.skills.find((candidate) => candidate.id === id);
  if (skill === undefined) return { state: "Not synced yet", error: null };
  const parts: string[] = [];
  const errors: string[] = [];
  const installed = skill.folders.filter((folder) => folder.state === "installed");
  if (installed.length === skill.folders.length) {
    parts.push(`Installed in ${status.skillsDirectory}`);
  } else if (skill.folders.every((folder) => folder.state === "off")) {
    parts.push("Off");
  } else if (installed.length > 0) {
    parts.push(`Installed: ${installed.map((folder) => folder.folder).join(", ")}`);
  }
  for (const folder of skill.folders) {
    if (folder.state === "skipped") parts.push(`Skipped ${folder.folder}: ${folder.reason}`);
    if (folder.state === "error") errors.push(`${folder.folder}: ${folder.error}`);
  }
  return { state: parts.join(". "), error: errors.length > 0 ? errors.join("\n") : null };
}
