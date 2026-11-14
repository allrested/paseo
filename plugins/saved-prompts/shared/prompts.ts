// Finding a saved prompt by what the user typed: after "/prompt", or in the picker's search.
import type { Prompt } from "./settings.js";

const PREVIEW_LENGTH = 80;

export type Found =
  | { status: "found"; prompt: Prompt }
  | { status: "several"; names: string[] }
  | { status: "none" };

function key(text: string): string {
  return text.trim().toLowerCase();
}

/** The prompt of that name, or the only one whose name starts with it. */
export function findPrompt(prompts: readonly Prompt[], name: string): Found {
  const wanted = key(name);
  if (wanted === "") return { status: "none" };
  const exact = prompts.find((prompt) => key(prompt.name) === wanted);
  if (exact) return { status: "found", prompt: exact };
  const starting = prompts.filter((prompt) => key(prompt.name).startsWith(wanted));
  const [only] = starting;
  if (only === undefined) return { status: "none" };
  if (starting.length === 1) return { status: "found", prompt: only };
  return { status: "several", names: starting.map((prompt) => prompt.name) };
}

/** Prompts whose name holds the query, then those that only mention it in their text. */
export function filterPrompts(prompts: readonly Prompt[], query: string): Prompt[] {
  const wanted = key(query);
  if (wanted === "") return [...prompts];
  const byName = prompts.filter((prompt) => key(prompt.name).includes(wanted));
  const byText = prompts.filter(
    (prompt) => !byName.includes(prompt) && prompt.text.toLowerCase().includes(wanted),
  );
  return [...byName, ...byText];
}

export function nameTaken(prompts: readonly Prompt[], name: string): boolean {
  const wanted = key(name);
  return prompts.some((prompt) => key(prompt.name) === wanted);
}

/** One line that tells a prompt from its neighbours in a list. */
export function preview(text: string): string {
  const line =
    text
      .split("\n")
      .map((each) => each.trim())
      .find((each) => each !== "") ?? "";
  return line.length > PREVIEW_LENGTH ? `${line.slice(0, PREVIEW_LENGTH - 1)}…` : line;
}
