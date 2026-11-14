// One edit of the settings screen, applied to the list as it is now. The prompt is found by the
// name it had when it was opened, so a save from another device cannot make this one land on a
// neighbour.
import { savedPromptsSettings, type Prompt, type SavedPrompts } from "../shared/settings.js";

export interface Edit {
  /** The prompt's name when it was opened; null for a new one. */
  original: string | null;
  name: string;
  text: string;
}

export type Applied = { ok: true; values: SavedPrompts } | { ok: false; error: string };

const GONE = "This prompt was renamed or deleted on another device. Discard, then open it again";

export function applyEdit(prompts: readonly Prompt[], edit: Edit): Applied {
  const next = [...prompts];
  const entry = { name: edit.name, text: edit.text };
  if (edit.original === null) {
    next.push(entry);
  } else {
    const index = next.findIndex((prompt) => prompt.name === edit.original);
    if (index === -1) return { ok: false, error: GONE };
    next[index] = entry;
  }
  const parsed = savedPromptsSettings.schema.safeParse({ prompts: next });
  if (parsed.success) return { ok: true, values: parsed.data };
  return { ok: false, error: parsed.error.issues[0]?.message ?? "The prompt cannot be saved" };
}

export function removePrompt(prompts: readonly Prompt[], original: string): SavedPrompts {
  return { prompts: prompts.filter((prompt) => prompt.name !== original) };
}
