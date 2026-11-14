// What the composer's Prompts list shows for a search.
import type { ComboboxItem } from "@getpaseo/plugin/client/ui";
import { filterPrompts, nameTaken, preview } from "../shared/prompts.js";
import type { Prompt } from "../shared/settings.js";

export type PickerItem = ComboboxItem &
  (
    | { kind: "prompt"; text: string }
    /** Keeps the composer's text under the name typed in the search. */
    | { kind: "save"; name: string }
    /** The empty list's one row; picking it puts the cursor in the composer. */
    | { kind: "write" }
  );

interface PickerInput {
  prompts: readonly Prompt[];
  query: string;
  /** The composer's text. */
  draft: string;
}

export function pickerItems({ prompts, query, draft }: PickerInput): PickerItem[] {
  const name = query.trim();
  const hasDraft = draft.trim() !== "";
  const items: PickerItem[] = filterPrompts(prompts, query).map((prompt) => ({
    id: `prompt:${prompt.name}`,
    kind: "prompt",
    label: prompt.name,
    description: preview(prompt.text),
    text: prompt.text,
  }));
  if (name !== "" && hasDraft && !nameTaken(prompts, name)) {
    items.push({
      id: "save",
      kind: "save",
      label: `Save as "${name}"`,
      description: preview(draft),
      name,
    });
  }
  if (prompts.length === 0 && items.length === 0) {
    items.push({
      id: "write",
      kind: "write",
      label: "No saved prompts yet",
      description: hasDraft
        ? "Type a name here to keep the composer's text"
        : "Write one in the composer, then name it here to keep it",
    });
  }
  return items;
}
