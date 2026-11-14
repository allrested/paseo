import { useCallback } from "react";
import { useComposer, useRpc } from "@getpaseo/plugin/client";
import { Combobox, useToast, type ComboboxSearchEvent } from "@getpaseo/plugin/client/ui";
import { pickerItems, type PickerItem } from "./picker.js";
import { appendPrompt, promptsRpc, stored } from "./store.js";

/**
 * The composer's Prompts list. Each opening reads the saved list, so a prompt saved on another
 * device is there; picking one puts it at the cursor and leaves the sending to the user.
 */
export function PromptsControl() {
  const composer = useComposer();
  const read = useRpc(promptsRpc.read);
  const write = useRpc(promptsRpc.write);
  const toast = useToast();
  const draft = composer.prompt;
  const search = useCallback(
    async ({ query }: ComboboxSearchEvent) => {
      const { prompts } = stored(await read({}));
      return pickerItems({ prompts, query, draft });
    },
    [read, draft],
  );
  const select = useCallback(
    async ({ item }: { item: PickerItem }) => {
      if (item.kind === "save") {
        await appendPrompt({ read: () => read({}), write, name: item.name, text: draft });
        toast.show(`Saved as "${item.name}"`);
        return;
      }
      if (item.kind === "prompt") composer.insertText(item.text);
      await composer.focus();
    },
    [composer, draft, read, toast, write],
  );
  return (
    <Combobox title="Prompts" icon="Bookmark" value={null} search={search} onSelect={select} />
  );
}
