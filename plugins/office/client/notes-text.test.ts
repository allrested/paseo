import { expect, test } from "vitest";
import type { NotesState } from "../shared/contracts.js";
import { monthTitle, notesLine, splitNewest, todayZone } from "./notes-text.js";

const NOW = Date.parse("2026-11-16T09:00:00Z");
const idle: NotesState = {
  folderSet: true,
  writing: false,
  writtenAt: null,
  failedAgentId: null,
  problem: null,
  scheduleError: null,
};

test("the line follows the writer", () => {
  expect(notesLine(undefined, NOW, "UTC")).toBeNull();
  expect(notesLine({ ...idle, folderSet: false }, NOW, "UTC")).toBeNull();
  expect(notesLine({ ...idle, writing: true }, NOW, "UTC")).toBe("Writing today's entry…");
  expect(
    notesLine(
      { ...idle, writtenAt: Date.parse("2026-11-16T05:03:00Z") },
      Date.parse("2026-11-16T09:00:00Z"),
      "Asia/Riyadh",
    ),
  ).toBe("Today's entry written at 08:03");
  expect(notesLine({ ...idle, writtenAt: Date.parse("2026-11-15T05:00:00Z") }, NOW, "UTC")).toBe(
    "No entry today yet",
  );
  expect(notesLine({ ...idle, failedAgentId: "a", problem: "Rate limited" }, NOW, "UTC")).toBe(
    "The writer stopped: Rate limited",
  );
});

test("today is the day in the zone given", () => {
  // 22:30 on the 15th in UTC is already the 16th in Riyadh.
  const writtenAt = Date.parse("2026-11-15T22:30:00Z");
  expect(notesLine({ ...idle, writtenAt }, NOW, "Asia/Riyadh")).toBe(
    "Today's entry written at 01:30",
  );
  expect(notesLine({ ...idle, writtenAt }, NOW, "UTC")).toBe("No entry today yet");
});

test("an entry written earlier today, then a writer that stopped, shows the stop", () => {
  const writtenAt = Date.parse("2026-11-16T05:03:00Z");
  expect(
    notesLine({ ...idle, writtenAt, failedAgentId: "a", problem: "Rate limited" }, NOW, "UTC"),
  ).toBe("The writer stopped: Rate limited");
});

test("every reason the writer gives reads as one sentence", () => {
  const stopped = (problem: string) =>
    notesLine({ ...idle, failedAgentId: "a", problem }, NOW, "UTC");
  // The writer's own words for a failed turn without a message are not said twice.
  expect(stopped("The writer stopped on an error")).toBe("The writer stopped on an error");
  expect(stopped("it was closed before it finished")).toBe(
    "The writer stopped: it was closed before it finished",
  );
  // No writer started: the folder, or the start itself, was refused.
  const unstarted = (problem: string) => notesLine({ ...idle, problem }, NOW, "UTC");
  expect(unstarted("The notes folder /n is not a folder")).toBe(
    "The writer could not start: The notes folder /n is not a folder",
  );
  expect(unstarted("No provider is ready")).toBe(
    "The writer could not start: No provider is ready",
  );
});

test("the newest entry starts at the last ## header", () => {
  const text =
    "# T\n\n## Contents\n\n---\n\n## 15 November 2026\n\nA\n\n---\n\n## 16 November 2026\n\nB\n";
  expect(splitNewest(text).newest.startsWith("## 16 November 2026")).toBe(true);
  expect(splitNewest(text).before).toBe(
    "# T\n\n## Contents\n\n---\n\n## 15 November 2026\n\nA\n\n---\n\n",
  );
  expect(splitNewest("no headers").newest).toBe("no headers");
  expect(splitNewest("no headers").before).toBe("");
  // A deeper header is part of its entry.
  expect(splitNewest("## 16 November 2026\n\n### Done\n").newest).toBe(
    "## 16 November 2026\n\n### Done\n",
  );
});

test("a month reads as its name and year", () => {
  expect(monthTitle("202611")).toBe("November 2026");
  expect(monthTitle("202701")).toBe("January 2027");
});

test("today is judged in the notes time zone when it names one, else in this device's", () => {
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  expect(todayZone(" Asia/Riyadh ")).toBe("Asia/Riyadh");
  expect(todayZone("")).toBe(device);
  // The settings keep a zone the schedule refused; the line still shows.
  expect(todayZone("Mars/Base")).toBe(device);
});
