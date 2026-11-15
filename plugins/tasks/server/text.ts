import { SOURCE_NAME, requestName } from "../shared/contracts.js";
import type { Issue } from "./issue.js";

const DESCRIPTION_MAX = 20_000;

function description(issue: Issue): string {
  const text = issue.description.trim();
  if (!text) return "No description.";
  if (text.length <= DESCRIPTION_MAX) return text;
  const left = text.length - DESCRIPTION_MAX;
  return `${text.slice(0, DESCRIPTION_MAX)}\n[Cut here. ${left} more characters are on the task's page.]`;
}

/**
 * The words of a query for a tracker's text match. Its operators (quotes, `-`, `~`, `*`, `:` and
 * the rest) are dropped, so what the user typed cannot change the query.
 */
export function searchWords(query: string): string {
  return query
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** The whole task as the text an agent gets. */
export function issueText(issue: Issue): string {
  return [
    `${SOURCE_NAME[issue.source]} ${issue.kind === "mr" ? requestName(issue.source) : "issue"} ${issue.key}: ${issue.title}`,
    `URL: ${issue.url}`,
    `Status: ${issue.status}`,
    ...issue.details.map(([name, value]) => `${name}: ${value}`),
    "",
    description(issue),
  ].join("\n");
}
