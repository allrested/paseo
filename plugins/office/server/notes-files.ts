// The stand-up notes as the notes card reads them: one month's file from the notes folder.

import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { PluginSettingsState } from "@getpaseo/plugin/server";
import type { z } from "zod";
import type { notesReadRpc } from "../shared/contracts.js";
import type { officeHostSettings } from "../shared/settings.js";
import { notesDay, notesFileName } from "./notes-prompt.js";

/** A month's notes, `daily-standup-YYYYMM.md`; no other name is read. */
const NOTES_FILE = /^daily-standup-(\d{6})\.md$/;

export interface NotesFs {
  /** The names directly in the folder. */
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
}

export const nodeNotesFs: NotesFs = {
  readdir: (path) => readdir(path),
  readFile: (path) => readFile(path, "utf8"),
};

export interface NotesMonth {
  month: string;
  /** The file's text; null when the month has no file. */
  text: string | null;
  /** The nearest earlier and later months that have a file; null where none. */
  previous: string | null;
  next: string | null;
}

/**
 * `month`'s notes in `folder`. Only the monthly files directly in the folder count, and only a
 * file the listing has is read, so a month cannot lead out of the folder.
 */
export async function readNotes(folder: string, month: string, fs: NotesFs): Promise<NotesMonth> {
  const months: string[] = [];
  for (const name of await fs.readdir(folder)) {
    const found = NOTES_FILE.exec(name)?.[1];
    if (found !== undefined) months.push(found);
  }
  months.sort();
  const text = months.includes(month)
    ? await fs.readFile(join(folder, notesFileName(month)))
    : null;
  return {
    month,
    text,
    previous: months.findLast((other) => other < month) ?? null,
    next: months.find((other) => other > month) ?? null,
  };
}

export interface NotesFilesPorts {
  settings: { read(): Promise<PluginSettingsState<typeof officeHostSettings.schema>> };
  /** The zone of "this month" when the settings name none. */
  hostTimeZone: string;
  now(): number;
  fs: NotesFs;
}

/**
 * What `notesReadRpc` answers: `month`, else this month in the notes time zone. A folder or a time
 * zone of only spaces counts as empty, as for the 8:00 schedule.
 */
export async function readMonthNotes(
  ports: NotesFilesPorts,
  month: string | undefined,
): Promise<z.output<typeof notesReadRpc.output>> {
  const state = await ports.settings.read();
  if (state.status !== "ready")
    throw new Error(`The office's settings are invalid: ${state.error}`);
  const folder = state.values.notesFolder.trim();
  const timeZone = state.values.notesTimeZone.trim() || ports.hostTimeZone;
  const shown = month ?? notesDay(ports.now(), timeZone).month;
  if (folder === "") {
    return { folderSet: false, month: shown, text: null, previous: null, next: null };
  }
  if (!isAbsolute(folder)) throw new Error(`The notes folder must be an absolute path: ${folder}`);
  return { folderSet: true, ...(await readNotes(folder, shown, ports.fs)) };
}
