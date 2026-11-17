import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginSettingsState } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, expect, test } from "vitest";
import { notesReadRpc } from "../shared/contracts.js";
import type { officeHostSettings } from "../shared/settings.js";
import { nodeNotesFs, readMonthNotes, readNotes } from "./notes-files.js";

type SettingsState = PluginSettingsState<typeof officeHostSettings.schema>;

// 30 November in UTC, 1 December at 01:30 in Riyadh.
const MIDNIGHT_IN_RIYADH = Date.parse("2026-11-30T22:30:00Z");
// 1 December at 07:00 in Riyadh: before the 8:00 run has written December's first entry.
const BEFORE_THE_RUN = Date.parse("2026-12-01T04:00:00Z");

let root = "";
let dir = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "office-notes-"));
  dir = join(root, "docs");
  await mkdir(join(dir, "sub"), { recursive: true });
  await writeFile(join(dir, "daily-standup-202609.md"), "SEP");
  await writeFile(join(dir, "daily-standup-202611.md"), "NOV");
  await writeFile(join(dir, "notes.md"), "OTHER");
  await writeFile(join(dir, "sub", "daily-standup-202610.md"), "OCT");
  await writeFile(join(dir, "daily-standup-202608.md.bak"), "AUG BACKUP");
  await writeFile(join(dir, "old-daily-standup-202607.md"), "JUL COPY");
  await writeFile(join(root, "secret.md"), "SECRET");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function ready(notesFolder: string, notesTimeZone: string): SettingsState {
  return {
    status: "ready",
    revision: "1",
    values: {
      agentTools: true,
      notesFolder,
      notesTimeZone,
      jiraProjects: "",
      sentryOrg: "",
      sentryProjects: "",
      sentryUrl: "https://sentry.io",
    },
  };
}

function ports(state: SettingsState, now: number) {
  return {
    settings: { read: async () => state },
    hostTimeZone: "Asia/Riyadh",
    now: () => now,
    fs: nodeNotesFs,
  };
}

test("a month's file, and the months on each side that have a file", async () => {
  expect(await readNotes(dir, "202611", nodeNotesFs)).toEqual({
    month: "202611",
    text: "NOV",
    previous: "202609",
    next: null,
  });
  expect(await readNotes(dir, "202609", nodeNotesFs)).toEqual({
    month: "202609",
    text: "SEP",
    previous: null,
    next: "202611",
  });
});

test("the first of a month with no file yet: no text, previous on", async () => {
  expect(await readNotes(dir, "202612", nodeNotesFs)).toEqual({
    month: "202612",
    text: null,
    previous: "202611",
    next: null,
  });
});

test("only monthly notes directly in the folder count", async () => {
  expect(await readNotes(dir, "202610", nodeNotesFs)).toEqual({
    month: "202610",
    text: null,
    previous: "202609",
    next: "202611",
  });
  // A backup and a copy of older months are not months of their own.
  expect((await readNotes(dir, "202609", nodeNotesFs)).previous).toBeNull();
});

test("a month that is not six digits is refused by the contract", () => {
  expect(notesReadRpc.input.safeParse({ month: "../../etc" }).success).toBe(false);
  expect(notesReadRpc.input.safeParse({ month: "2026-11" }).success).toBe(false);
  expect(notesReadRpc.input.safeParse({ month: "2026111" }).success).toBe(false);
  expect(notesReadRpc.input.safeParse({ month: "202611" }).success).toBe(true);
  expect(notesReadRpc.input.safeParse({}).success).toBe(true);
});

test("a month that leads out of the folder reads nothing", async () => {
  expect((await readNotes(dir, "202611/../../secret", nodeNotesFs)).text).toBeNull();
});

test("no folder: the folder is not set, and nothing is read", async () => {
  expect(await readMonthNotes(ports(ready("", ""), MIDNIGHT_IN_RIYADH), undefined)).toEqual({
    folderSet: false,
    month: "202612",
    text: null,
    previous: null,
    next: null,
  });
  expect(
    (await readMonthNotes(ports(ready("  ", ""), MIDNIGHT_IN_RIYADH), "202611")).folderSet,
  ).toBe(false);
});

test("this month is the notes time zone's, else the host's", async () => {
  expect(await readMonthNotes(ports(ready(dir, "UTC"), MIDNIGHT_IN_RIYADH), undefined)).toEqual({
    folderSet: true,
    month: "202611",
    text: "NOV",
    previous: "202609",
    next: null,
  });
  expect((await readMonthNotes(ports(ready(dir, " "), MIDNIGHT_IN_RIYADH), undefined)).month).toBe(
    "202612",
  );
});

test("the first of the month before 8:00: no file yet, and the previous month is on", async () => {
  expect(await readMonthNotes(ports(ready(dir, ""), BEFORE_THE_RUN), undefined)).toEqual({
    folderSet: true,
    month: "202612",
    text: null,
    previous: "202611",
    next: null,
  });
});

test("a month asked for is read as asked, in a folder given with spaces around it", async () => {
  expect(await readMonthNotes(ports(ready(` ${dir} `, ""), BEFORE_THE_RUN), "202609")).toEqual({
    folderSet: true,
    month: "202609",
    text: "SEP",
    previous: null,
    next: "202611",
  });
});

test("a folder that is not an absolute path is refused", async () => {
  await expect(readMonthNotes(ports(ready("docs", ""), BEFORE_THE_RUN), "202611")).rejects.toThrow(
    "The notes folder must be an absolute path: docs",
  );
});

test("settings that cannot be read are an error", async () => {
  const invalid: SettingsState = { status: "invalid", revision: "1", error: "Bad settings file" };
  await expect(readMonthNotes(ports(invalid, BEFORE_THE_RUN), "202611")).rejects.toThrow(
    "Bad settings file",
  );
});
