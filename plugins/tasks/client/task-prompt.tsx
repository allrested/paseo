import { useCallback } from "react";
import { useComposer, useRpc } from "@getpaseo/plugin/client";
import { Action } from "@getpaseo/plugin/client/ui";
import { taskPromptRpc } from "../shared/contracts.js";
import { usePickedTask } from "./picked-task.js";
import { reason } from "./reason.js";

/**
 * The New workspace composer's Task prompt: puts the saved template, filled with the picked
 * task, at the cursor. The user reads it and sends it; the control never does.
 */
export function TaskPrompt() {
  const composer = useComposer();
  const id = usePickedTask();
  const fill = useRpc(taskPromptRpc);
  const insert = useCallback(async () => {
    if (id === null) return;
    // The host shows a rejected press as it is.
    const { text } = await fill({ id }).catch((error: unknown) => {
      throw new Error(reason(error));
    });
    composer.insertText(text);
    await composer.focus();
  }, [composer, fill, id]);
  // A workspace's own composers know no pick; an item that renders nothing takes no room.
  if (composer.context !== "new-workspace" || id === null) return null;
  return <Action title="Task prompt" icon="ClipboardList" onPress={insert} />;
}
