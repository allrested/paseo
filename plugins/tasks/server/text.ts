import { SOURCE_NAME, requestName } from "../shared/contracts.js";
import type { Issue, TaskImage } from "./issue.js";

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

/**
 * Takes the pictures a tracker keeps behind its sign-in out of a Markdown text. The page cannot
 * load them by their link, so each is left as its name and listed to be read through the daemon.
 * `pattern` is global; `pick` says what a match is to the tracker.
 */
export function takeImages(
  markdown: string,
  pattern: RegExp,
  pick: (match: string[]) => TaskImage,
): { text: string; images: TaskImage[] } {
  const images: TaskImage[] = [];
  const text = markdown.replaceAll(pattern, (...found: unknown[]) => {
    // A replacer gets the match and its groups, then where it was found and the whole text.
    const match = found.slice(
      0,
      found.findIndex((part) => typeof part === "number"),
    );
    const image = pick(match.filter((part): part is string => typeof part === "string"));
    if (!images.some((each) => each.id === image.id)) images.push(image);
    return `(image: ${image.name})`;
  });
  return { text, images };
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
