import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { linkedWorkspacesRpc, type LinkedWorkspace, type TaskRow } from "../shared/contracts.js";

/** How often the trackers are asked how the linked tasks stand. */
export const REFRESH_MS = 5 * 60_000;
const QUERY_KEY = ["tasks", "linked"] as const;

/**
 * The workspaces started on a task, each with how its task stands. Every sidebar row, the list
 * and a task's page read one answer: a plugin's components on a host share its query client.
 */
export function useLinkedWorkspaces() {
  const read = useRpc(linkedWorkspacesRpc);
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => read({}),
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
  });
}

/** Reads the linked workspaces again, after something Paseo did changed how a task stands. */
export function useRefreshLinked(): () => void {
  const client = useQueryClient();
  return useCallback(() => void client.invalidateQueries({ queryKey: QUERY_KEY }), [client]);
}

/** The workspaces started on one task. One from before the task's id was kept is told by its key. */
export function workspacesOf(
  linked: readonly LinkedWorkspace[],
  task: Pick<TaskRow, "id" | "key">,
): LinkedWorkspace[] {
  return linked.filter((each) =>
    each.taskId === undefined ? each.key === task.key : each.taskId === task.id,
  );
}
