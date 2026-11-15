// What a viewer says about a file it does not show.
import { PluginFileDeletedError } from "@getpaseo/plugin/client";

const MIB = 1024 * 1024;

/** A table holds every cell in memory, and a phone is a host too. */
export const TABLE_MAX_BYTES = 10 * MIB;
/** A notebook carries its pictures inside it, so it is larger than its text. */
export const NOTEBOOK_MAX_BYTES = 20 * MIB;

/** "3.4 MB": a file's size, for a sentence. */
export function sizeLabel(bytes: number): string {
  return `${(bytes / MIB).toFixed(1)} MB`;
}

/** Why a file over a viewer's limit is not read. */
export function tooLarge(what: string, size: number, limit: number): string {
  return `This file is ${sizeLabel(size)}, and ${what} is shown up to ${sizeLabel(limit)}. Open it with another viewer from the tab's menu.`;
}

/** Why a read failed, for the reader. */
export function readProblem(error: Error): string {
  if (error instanceof PluginFileDeletedError) return "This file was deleted.";
  return `Unable to read the file: ${error.message}`;
}

const NUMBER = new Intl.NumberFormat("en-US");

/** "1,204": a count with its thousands apart. */
export function counted(value: number): string {
  return NUMBER.format(value);
}
