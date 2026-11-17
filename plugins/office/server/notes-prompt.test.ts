import { expect, test } from "vitest";
import { notesDay, notesFileName, notesPrompt } from "./notes-prompt.js";

test("the day is the notes time zone's", () => {
  // 2026-11-15T22:30:00Z is 16 November in Riyadh and 15 November in UTC
  expect(notesDay(Date.parse("2026-11-15T22:30:00Z"), "Asia/Riyadh")).toEqual({
    month: "202611",
    header: "16 November 2026",
  });
  expect(notesDay(Date.parse("2026-11-15T22:30:00Z"), "UTC").header).toBe("15 November 2026");
});

test("a single-digit day has two digits", () => {
  expect(notesDay(Date.parse("2026-12-01T09:00:00Z"), "UTC")).toEqual({
    month: "202612",
    header: "01 December 2026",
  });
});

test("the month's file is named after it", () => {
  expect(notesFileName("202611")).toBe("daily-standup-202611.md");
});

test("the prompt names the day, the file and carries the report", () => {
  const text = notesPrompt({
    header: "16 November 2026",
    fileName: "daily-standup-202611.md",
    report: "REPORT",
  });
  expect(text).toContain("for 16 November 2026.");
  expect(text).toContain("Edit only daily-standup-202611.md. Do not commit.");
  expect(text.endsWith("REPORT")).toBe(true);
});

test("the prompt is the writer's instructions, a blank line, then the report", () => {
  const text = notesPrompt({
    header: "16 November 2026",
    fileName: "daily-standup-202611.md",
    report: "REPORT",
  });
  expect(text).toBe(
    [
      `Write today's stand-up note under the "Standup Notes" rules of this folder's CLAUDE.md, for 16 November 2026.`,
      "If the entry for 16 November 2026 is already in daily-standup-202611.md, bring it up to date in place: keep what is still true and keep the Contents list right.",
      "Edit only daily-standup-202611.md. Do not commit.",
      "",
      "The office's stand-up report, for what the agents did and what blocks them:",
      "",
      "REPORT",
    ].join("\n"),
  );
});
