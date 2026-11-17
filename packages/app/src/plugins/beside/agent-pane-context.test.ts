import { describe, expect, it, vi } from "vitest";
import type { WorkspaceFileOpenRequest } from "@/workspace/file-open";
import { buildAgentBesidePaneContext } from "./agent-pane-context";

function build() {
  const input = {
    serverId: "host",
    workspaceId: "shop-api",
    agentId: "agent-1",
    tabId: "beside:host:office:office",
    close: vi.fn(),
    openInWorkspace: vi.fn(),
    openFile: vi.fn(),
  };
  return { input, context: buildAgentBesidePaneContext(input) };
}

describe("buildAgentBesidePaneContext", () => {
  it("is the agent's pane in its own workspace, under the area's tab id, with no side pane", () => {
    const { context } = build();

    expect(context).toMatchObject({
      serverId: "host",
      workspaceId: "shop-api",
      tabId: "beside:host:office:office",
      target: { kind: "agent", agentId: "agent-1" },
    });
    expect(context.openTargetToSide).toBeUndefined();
  });

  it("renders as a workspace tab does, so the session keeps its composer in the sheet too", () => {
    expect(build().context.host).toBe("main");
  });

  it("sends tabs and preferred targets to the agent's workspace", () => {
    const { input, context } = build();
    const file = { kind: "file", path: "src/app.ts" } as const;

    context.openTab(file);
    context.openPreferredTarget({ kind: "changes_tree" }, "chatFiles");

    expect(input.openInWorkspace.mock.calls).toEqual([[file], [{ kind: "changes_tree" }]]);
  });

  it("opens files through the given opener", () => {
    const { input, context } = build();
    const request: WorkspaceFileOpenRequest = {
      location: { path: "src/app.ts", lineStart: 4 },
      disposition: "preferred",
    };

    context.openFileInWorkspace(request);

    expect(input.openFile).toHaveBeenCalledWith(request);
  });

  it("closes the area when the pane closes its tab, and ignores what only a tab can do", () => {
    const { input, context } = build();

    context.closeCurrentTab();
    context.retargetCurrentTab({ kind: "agent", agentId: "agent-2" });
    context.setCurrentTabState({ scroll: 3 });
    context.openImportSheet();

    expect(input.close).toHaveBeenCalledTimes(1);
    expect(input.openInWorkspace).not.toHaveBeenCalled();
    expect(input.openFile).not.toHaveBeenCalled();
  });
});
