// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedSessionHosts } from "@/test/seed-session";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useFollowMovedAgents } from "./use-follow-moved-agents";

const serverId = "server-a";
const workspaceKey = "server-a:workspace";

function makeAgent(overrides: Partial<Agent> & Pick<Agent, "id">): Agent {
  return {
    serverId,
    provider: "claude",
    status: "idle",
    createdAt: new Date("2026-11-05T00:00:00.000Z"),
    updatedAt: new Date("2026-11-05T00:00:00.000Z"),
    lastUserMessageAt: null,
    lastActivityAt: new Date("2026-11-05T00:00:00.000Z"),
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: overrides.id,
    cwd: "/repo",
    model: null,
    parentAgentId: null,
    labels: {},
    archivedAt: null,
    turn: { phase: "idle", cancellationRequestId: null },
    ...overrides,
  };
}

function agentTabTargets(): string[] {
  return useWorkspaceLayoutStore
    .getState()
    .getWorkspaceTabs(workspaceKey)
    .flatMap((tab) => (tab.target.kind === "agent" ? [tab.target.agentId] : []));
}

/** What the workspace screen's tab reconcile does to a tab whose agent is not active. */
function closeTabsOnInactiveAgents(): void {
  const active = useSessionStore.getState().sessions[serverId]?.agents;
  const layout = useWorkspaceLayoutStore.getState();
  for (const tab of layout.getWorkspaceTabs(workspaceKey)) {
    if (tab.target.kind === "agent" && !active?.has(tab.target.agentId)) {
      layout.closeTab(workspaceKey, tab.tabId);
    }
  }
}

/** The hook sits above the screen's reconcile layout effect, as in workspace-screen.tsx. */
function WorkspaceScreenOrder() {
  useFollowMovedAgents(serverId, workspaceKey);
  useLayoutEffect(closeTabsOnInactiveAgents, []);
  return null;
}

beforeEach(() => {
  useSessionStore.setState((state) => ({ ...state, sessions: {} }));
  seedSessionHosts([serverId]);
  useWorkspaceLayoutStore.setState({
    layoutMode: "split-panes",
    layoutByWorkspace: {},
    sheetsByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
  });
});

afterEach(() => seedSessionHosts([]));

describe("useFollowMovedAgents", () => {
  it("retargets a moved subagent's tab before the screen closes tabs on inactive agents", () => {
    const store = useSessionStore.getState();
    store.updateSessionServerInfo(serverId, {
      serverId,
      hostname: "host",
      version: "0.16.0",
      features: { agentMove: true },
    });
    // The app was closed during the move: it opens with the agent list already loaded.
    store.setAgents(
      serverId,
      new Map([
        ["parent", makeAgent({ id: "parent" })],
        [
          "new",
          makeAgent({
            id: "new",
            parentAgentId: "parent",
            labels: { "paseo.moved-from-agent-id": "old" },
          }),
        ],
      ]),
    );
    useWorkspaceLayoutStore.getState().openTab({
      workspaceKey,
      target: { kind: "agent", agentId: "old" },
      intent: "reveal",
    });

    render(<WorkspaceScreenOrder />);

    expect(agentTabTargets()).toEqual(["new"]);
  });
});
