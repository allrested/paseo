import type { Stats } from "node:fs";
import { lstat, readlink, symlink } from "node:fs/promises";
import { join } from "node:path";
import { errorCode } from "./errors.js";

/** What an account shares with the main profile, each through an absolute symbolic link. */
export const SHARED_ENTRIES = [
  "settings.json",
  "CLAUDE.md",
  "skills",
  "plugins",
  "commands",
  "agents",
] as const;

export type SetupAction = "link" | "linked" | "keep" | "absent";

export interface SetupStep {
  entry: string;
  action: SetupAction;
  /** The main profile's entry, which the link points at. */
  target: string;
}

export async function planSetupLink(
  mainDirectory: string,
  accountDirectory: string,
): Promise<SetupStep[]> {
  const steps: SetupStep[] = [];
  for (const entry of SHARED_ENTRIES) {
    const target = join(mainDirectory, entry);
    steps.push({ entry, target, action: await planEntry(target, join(accountDirectory, entry)) });
  }
  return steps;
}

async function planEntry(target: string, path: string): Promise<SetupAction> {
  if ((await lstatOrNull(target)) === null) return "absent";
  const current = await lstatOrNull(path);
  if (current === null) return "link";
  if (current.isSymbolicLink() && (await readlink(path)) === target) return "linked";
  return "keep";
}

/** Creates the planned links. A path that appeared since the plan is kept, never replaced. */
export async function applySetupLink(
  steps: readonly SetupStep[],
  accountDirectory: string,
): Promise<SetupStep[]> {
  const applied: SetupStep[] = [];
  for (const step of steps) {
    if (step.action === "link") {
      applied.push({
        ...step,
        action: await link(step.target, join(accountDirectory, step.entry)),
      });
    } else {
      applied.push(step);
    }
  }
  return applied;
}

async function link(target: string, path: string): Promise<SetupAction> {
  try {
    await symlink(target, path);
    return "linked";
  } catch (error) {
    if (errorCode(error) === "EEXIST") return "keep";
    throw error;
  }
}

export function setupProblems(steps: readonly SetupStep[]): string[] {
  const problems: string[] = [];
  for (const { entry, action } of steps) {
    if (action === "keep") {
      problems.push(
        `${entry} exists in this account's directory, so the main account's ${entry} is not shared`,
      );
    }
    if (action === "link") {
      problems.push(`${entry} is not shared yet. Add the account again to share it.`);
    }
  }
  return problems;
}

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}
