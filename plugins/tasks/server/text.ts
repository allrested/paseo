import { SOURCE_NAME } from "../shared/contracts.js";
import type { Issue } from "./issue.js";

const DESCRIPTION_MAX = 20_000;

function description(issue: Issue): string {
  const text = issue.description.trim();
  if (!text) return "No description.";
  if (text.length <= DESCRIPTION_MAX) return text;
  const left = text.length - DESCRIPTION_MAX;
  return `${text.slice(0, DESCRIPTION_MAX)}\n[Cut here. ${left} more characters are on the task's page.]`;
}

/** The whole task as the text an agent gets. */
export function issueText(issue: Issue): string {
  return [
    `${SOURCE_NAME[issue.source]} issue ${issue.key}: ${issue.title}`,
    `URL: ${issue.url}`,
    `Status: ${issue.status}`,
    ...issue.details.map(([name, value]) => `${name}: ${value}`),
    "",
    description(issue),
  ].join("\n");
}
