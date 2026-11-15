import { useEffect } from "react";
import type { PluginWorkspaceRowBadgeItemProps } from "@getpaseo/plugin/client";
import { WorkspaceRowBadge } from "@getpaseo/plugin/client/ui";
import type { LinkedWorkspace, Phase } from "../shared/contracts.js";
import { useLinkedWorkspaces } from "./linked.js";

const TONE: Record<Phase, "muted" | "info" | "success"> = {
  todo: "muted",
  doing: "info",
  done: "success",
};

// The workspaces one more read was asked for. A row the host's list leaves out would otherwise
// ask on every answer.
const asked = new Set<string>();

/** For tests: one test's rows must not count as asked in the next. */
export function forgetAsked(): void {
  asked.clear();
}

/** GitLab's key starts with the project's path: the row is narrow and names the project itself. */
function shortKey(key: string): string {
  return key.replace(/^.+(?=[#!]\d+$)/, "");
}

function label(link: LinkedWorkspace, key: string, joint: string): string {
  return link.status === undefined ? key : `${key}${joint}${link.status}`;
}

/** Under a workspace's name in the sidebar: the task it was started on, and how the task stands. */
export function TaskBadge({ workspaceId }: PluginWorkspaceRowBadgeItemProps) {
  const { data, refetch } = useLinkedWorkspaces();
  useEffect(() => {
    // The answer lists every workspace the host had: one that is not in it was made since.
    if (data === undefined || data.workspaceIds.includes(workspaceId)) return;
    if (asked.has(workspaceId)) return;
    asked.add(workspaceId);
    void refetch({ cancelRefetch: false });
  }, [data, workspaceId, refetch]);
  const link = data?.linked.find((each) => each.workspaceId === workspaceId);
  if (link === undefined) return null;
  return (
    <WorkspaceRowBadge
      icon="CircleDot"
      label={label(link, shortKey(link.key), " · ")}
      tone={link.phase === undefined ? "muted" : TONE[link.phase]}
      accessibilityLabel={`Task ${label(link, link.key, ", ")}`}
    />
  );
}
