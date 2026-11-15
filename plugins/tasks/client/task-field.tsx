import { useCallback, useMemo } from "react";
import { useNewWorkspace, useRpc } from "@getpaseo/plugin/client";
import { Combobox, type ComboboxSearchEvent } from "@getpaseo/plugin/client/ui";
import { CONNECTIONS_SCREEN, searchTasksRpc } from "../shared/contracts.js";
import { TASK_KEY, TASK_URL, fieldItems, type FieldItem } from "./picker.js";
import { reason } from "./reason.js";

/**
 * The New workspace screen's Task field: the open tasks of whoever connected the trackers. A pick
 * names the new branch after the task and leaves the task's key and link on the workspace.
 */
export function createTaskField(openSettings: (id: string) => void) {
  return function TaskField() {
    const newWorkspace = useNewWorkspace();
    const searchTasks = useRpc(searchTasksRpc);
    const key = newWorkspace.metadata[TASK_KEY];
    const value = useMemo(() => (typeof key === "string" ? { id: key, label: key } : null), [key]);
    const chosen = value !== null;
    const search = useCallback(
      async ({ query }: ComboboxSearchEvent) => {
        // The list shows a failed search's message as it is.
        const found = await searchTasks({ query }).catch((error: unknown) => {
          throw new Error(reason(error));
        });
        return fieldItems({ ...found, query, chosen });
      },
      [searchTasks, chosen],
    );
    const select = useCallback(
      async ({ item }: { item: FieldItem }) => {
        if (item.kind === "setup") {
          openSettings(CONNECTIONS_SCREEN);
          return;
        }
        if (item.kind === "none") {
          await newWorkspace.setBranch(null);
          await newWorkspace.setMetadata({ [TASK_KEY]: null, [TASK_URL]: null });
          return;
        }
        await newWorkspace.setBranch(item.branch);
        await newWorkspace.setMetadata({ [TASK_KEY]: item.key, [TASK_URL]: item.url });
      },
      [newWorkspace],
    );
    return (
      <Combobox title="Task" icon="CircleDot" value={value} search={search} onSelect={select} />
    );
  };
}
