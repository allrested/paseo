import { useCallback, useEffect, useMemo } from "react";
import { useNewWorkspace, useRpc } from "@getpaseo/plugin/client";
import { Combobox, useToast, type ComboboxSearchEvent } from "@getpaseo/plugin/client/ui";
import { CONNECTIONS_SCREEN, searchTasksRpc } from "../shared/contracts.js";
import { nextTask, useNextTask } from "./next-task.js";
import { TASK_KEY, TASK_URL, fieldItems, type FieldItem } from "./picker.js";
import { reason } from "./reason.js";

/**
 * The New workspace screen's Task field: the open tasks of whoever connected the trackers. A pick
 * names the new branch after the task and leaves the task's key and link on the workspace. A task
 * picked on its page for the next workspace is taken as if it were picked here.
 */
export function createTaskField(openSettings: (id: string) => void) {
  return function TaskField() {
    const newWorkspace = useNewWorkspace();
    const searchTasks = useRpc(searchTasksRpc);
    const { setBranch, setMetadata } = newWorkspace;
    const toast = useToast();
    const next = useNextTask();
    useEffect(() => {
      if (next === null) return;
      // Taken once: a second New workspace after this one starts empty.
      nextTask.set(null);
      setBranch(next.branch)
        .then(() => setMetadata({ [TASK_KEY]: next.key, [TASK_URL]: next.url }))
        .catch((error: unknown) => toast.error(`${next.key} could not be used: ${reason(error)}`));
    }, [next, setBranch, setMetadata, toast]);
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
