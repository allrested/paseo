import type { PaneContextValue } from "@/panels/pane-context";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export interface AgentBesidePaneContextInput {
  serverId: string;
  /** The agent's own workspace, not the workspace of the surface beside it. */
  workspaceId: string;
  agentId: string;
  /** The area's tab id, which no workspace tab has. */
  tabId: string;
  close(): void;
  openInWorkspace(target: WorkspaceTabTarget): void;
  openFile(request: WorkspaceFileOpenRequest): void;
}

const ignore = () => undefined;

/**
 * The pane context of an agent shown in the side area. What the pane would open as a tab goes to the
 * agent's workspace, closing the tab closes the area, and what only a tab has (its target, its
 * state, the import sheet) is ignored. There is no side pane to open into.
 */
export function buildAgentBesidePaneContext(input: AgentBesidePaneContextInput): PaneContextValue {
  return {
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    // The full session in both layouts: a "sheet" pane shows an agent without its composer.
    host: "main",
    tabId: input.tabId,
    target: { kind: "agent", agentId: input.agentId },
    openTab: input.openInWorkspace,
    openPreferredTarget: (target) => input.openInWorkspace(target),
    closeCurrentTab: input.close,
    retargetCurrentTab: ignore,
    setCurrentTabState: ignore,
    openFileInWorkspace: input.openFile,
    openImportSheet: ignore,
  };
}
