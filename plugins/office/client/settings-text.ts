import { failureText } from "./action-button.js";
import type { StripCard } from "./attention-strip.js";

/**
 * What the host could not do with the office's settings, one sentence each. Only the schedules:
 * a refused save or a failed switch shows on the settings screen as it happens.
 */
export function settingsProblems(
  notesError: string | null,
  incidentsError: string | null,
): string[] {
  const problems: string[] = [];
  if (notesError !== null) problems.push(failureText("Schedule the stand-up notes", notesError));
  if (incidentsError !== null) {
    problems.push(failureText("Schedule the incidents check", incidentsError));
  }
  return problems;
}

/** The strip's Settings card, while a schedule could not follow the settings. */
export function settingsEntry(problems: readonly string[], onOpen: () => void): StripCard | null {
  if (problems.length === 0) return null;
  const text = problems.length === 1 ? "1 problem" : `${problems.length} problems`;
  return { title: "Settings", note: { text, tone: "danger" }, onOpen };
}
