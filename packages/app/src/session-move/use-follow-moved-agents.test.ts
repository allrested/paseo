import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedSessionHosts } from "@/test/seed-session";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { retargetAgentTabs, retargetStaleAgentTabs } from "./use-follow-moved-agents";

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

function openAgentTab(agentId: string): string {
  const tabId = useWorkspaceLayoutStore.getState().openTab({
    workspaceKey,
    target: { kind: "agent", agentId },
    intent: "reveal",
  });
  if (!tabId) throw new Error(`Could not open a tab for ${agentId}`);
  return tabId;
}

function agentTabTargets(): string[] {
  return useWorkspaceLayoutStore
    .getState()
    .getWorkspaceTabs(workspaceKey)
    .flatMap((tab) => (tab.target.kind === "agent" ? [tab.target.agentId] : []));
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

describe("retargetAgentTabs", () => {
  it("points the moved agent's tab at the new agent", () => {
    openAgentTab("old");
    retargetAgentTabs(workspaceKey, "old", "new");
    expect(agentTabTargets()).toEqual(["new"]);
  });

  it("closes the stale tab when the new agent already has a tab", () => {
    const staleTabId = openAgentTab("old");
    const destinationTabId = openAgentTab("new");
    retargetAgentTabs(workspaceKey, "old", "new");
    expect(agentTabTargets()).toEqual(["new"]);
    const tabIds = useWorkspaceLayoutStore
      .getState()
      .getWorkspaceTabs(workspaceKey)
      .map((tab) => tab.tabId);
    expect(tabIds).toContain(destinationTabId);
    expect(tabIds).not.toContain(staleTabId);
  });
});

describe("retargetStaleAgentTabs", () => {
  it("follows an archived agent that is only in the details map", () => {
    expect(useSessionStore.getState().sessions[serverId]).toBeDefined();
    const store = useSessionStore.getState();
    store.setAgents(serverId, new Map([["new", makeAgent({ id: "new" })]]));
    store.setAgentDetails(
      serverId,
      new Map([
        [
          "old",
          makeAgent({
            id: "old",
            archivedAt: new Date("2026-11-05T01:00:00.000Z"),
            labels: { "paseo.moved-to-agent-id": "new" },
          }),
        ],
      ]),
    );
    openAgentTab("old");

    retargetStaleAgentTabs(serverId, workspaceKey);

    expect(agentTabTargets()).toEqual(["new"]);
  });

  it("leaves tabs on agents that were not moved", () => {
    useSessionStore.getState().setAgents(serverId, new Map([["a", makeAgent({ id: "a" })]]));
    openAgentTab("a");
    retargetStaleAgentTabs(serverId, workspaceKey);
    expect(agentTabTargets()).toEqual(["a"]);
  });
});
