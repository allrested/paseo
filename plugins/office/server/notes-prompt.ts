// What the stand-up writer is told: the day it writes for, the month's file, and the prompt.

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface NotesDay {
  /** `YYYYMM`, the month whose file holds the entry. */
  month: string;
  /** `DD Month YYYY`, the entry's header: `01 December 2026`. */
  header: string;
}

/** The day at `now` in `timeZone`, the notes time zone, which may not be the host's. */
export function notesDay(now: number, timeZone: string): NotesDay {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  const monthNumber = String(MONTHS.indexOf(values.month) + 1).padStart(2, "0");
  return {
    month: `${values.year}${monthNumber}`,
    header: `${values.day} ${values.month} ${values.year}`,
  };
}

export function notesFileName(month: string): string {
  return `daily-standup-${month}.md`;
}

export interface NotesPromptInput {
  header: string;
  fileName: string;
  report: string;
}

export function notesPrompt(input: NotesPromptInput): string {
  const { header, fileName, report } = input;
  return [
    `Write today's stand-up note under the "Standup Notes" rules of this folder's CLAUDE.md, for ${header}.`,
    `If the entry for ${header} is already in ${fileName}, bring it up to date in place: keep what is still true and keep the Contents list right.`,
    `Edit only ${fileName}. Do not commit.`,
    "",
    "The office's stand-up report, for what the agents did and what blocks them:",
    "",
    report,
  ].join("\n");
}
