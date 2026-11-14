import { useEffect, useLayoutEffect } from "react";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { getMovedFromAgentId, getMovedFromAgentIds } from "@getpaseo/protocol/agent-labels";
import type { Agent } from "@/stores/session-store";
import { findSessionAgent, resolveMovedAgentId } from "./resolve-moved-agent";

/**
 * Points every tab of `fromAgentId` at `toAgentId`. When the destination already has its own tab,
 * the stale tab closes and the destination takes focus instead, so the agent never shows twice.
 */
export function retargetAgentTabs(
  workspaceKey: string,
  fromAgentId: string,
  toAgentId: string,
): void {
  const layout = useWorkspaceLayoutStore.getState();
  const tabs = layout.getWorkspaceTabs(workspaceKey);
  const staleTabs = tabs.filter(
    (tab) => tab.target.kind === "agent" && tab.target.agentId === fromAgentId,
  );
  if (staleTabs.length === 0) return;
  const destinationTab = tabs.find(
    (tab) => tab.target.kind === "agent" && tab.target.agentId === toAgentId,
  );
  for (const tab of staleTabs) {
    if (destinationTab) {
      layout.closeTab(workspaceKey, tab.tabId);
    } else {
      layout.replaceTab(workspaceKey, tab.tabId, { kind: "agent", agentId: toAgentId });
    }
  }
  if (destinationTab) layout.focusTab(workspaceKey, destinationTab.tabId);
}

/**
 * The live agent whose session was moved from `agentId`, read from the active agents' moved-from
 * links. The list of every agent in the chain covers a client that was away for several moves; a
 * host older than that list sends only the last link.
 */
function findLiveSuccessor(agents: Map<string, Agent>, agentId: string): string | null {
  // The agent moved straight from it wins over one that only lists it further back, which is
  // what tells two live agents of one chain apart after one of them was unarchived by hand.
  let listedBy: string | null = null;
  for (const agent of agents.values()) {
    if (agent.archivedAt) continue;
    if (getMovedFromAgentId(agent.labels) === agentId) return agent.id;
    if (listedBy === null && getMovedFromAgentIds(agent.labels).includes(agentId)) {
      listedBy = agent.id;
    }
  }
  return listedBy;
}

/**
 * Retargets the tabs whose agent was archived by a move, e.g. one made while the app was away.
 * After such a move the session holds no record of the archived agent, so the live agent's
 * moved-from link is what names it.
 */
export function retargetStaleAgentTabs(serverId: string, workspaceKey: string): void {
  const session = useSessionStore.getState().sessions[serverId];
  if (!session) return;
  const getAgent = (id: string) => findSessionAgent(session, id);
  const liveSuccessorOf = (id: string) => findLiveSuccessor(session.agents, id);
  for (const tab of useWorkspaceLayoutStore.getState().getWorkspaceTabs(workspaceKey)) {
    if (tab.target.kind !== "agent") continue;
    const movedTo = resolveMovedAgentId(tab.target.agentId, getAgent, liveSuccessorOf);
    if (movedTo) retargetAgentTabs(workspaceKey, tab.target.agentId, movedTo);
  }
}

/**
 * Keeps a workspace's agent tabs on the live end of a move: on the host's `agent.moved` event, and
 * from the moved-to labels whenever the agent list or the workspace layout changes, which covers
 * moves that happened while the app was away.
 */
export function useFollowMovedAgents(serverId: string, workspaceKey: string | null): void {
  const client = useHostRuntimeClient(serverId);
  const supportsAgentMove = useHostFeature(serverId, "agentMove");

  useEffect(() => {
    if (!client || !supportsAgentMove || !workspaceKey) return;
    // Its own request: an older host rejects a subscription list holding an event it does not know.
    const observation = client.observeEvents(["agent.moved"]);
    observation.subscribe({
      snapshot: () => {},
      update: (message) => {
        if (message.type !== "agent.moved") return;
        retargetAgentTabs(workspaceKey, message.payload.fromAgentId, message.payload.toAgentId);
      },
    });
    return () => {
      void observation
        .release()
        .catch((error) => console.warn("[SessionMove] Failed to release agent.moved feed", error));
    };
  }, [client, supportsAgentMove, workspaceKey]);

  // A layout effect, and the hook sits above the screen's tab reconcile: a tab on an agent that was
  // moved while the app was away has to be retargeted before the reconcile closes it as archived.
  useLayoutEffect(() => {
    if (!supportsAgentMove || !workspaceKey) return;
    retargetStaleAgentTabs(serverId, workspaceKey);
    // Store subscriptions rather than selectors: the workspace screen must not re-render on every
    // agent update just to run this check.
    const unsubscribeAgents = useSessionStore.subscribe(
      (state) => state.sessions[serverId]?.agents,
      () => retargetStaleAgentTabs(serverId, workspaceKey),
    );
    // A tab on an archived agent heals once its panel fetches the agent into the details map.
    const unsubscribeAgentDetails = useSessionStore.subscribe(
      (state) => state.sessions[serverId]?.agentDetails,
      () => retargetStaleAgentTabs(serverId, workspaceKey),
    );
    const unsubscribeLayout = useWorkspaceLayoutStore.subscribe((state, previous) => {
      if (state.layoutByWorkspace[workspaceKey] === previous.layoutByWorkspace[workspaceKey]) {
        return;
      }
      retargetStaleAgentTabs(serverId, workspaceKey);
    });
    return () => {
      unsubscribeAgents();
      unsubscribeAgentDetails();
      unsubscribeLayout();
    };
  }, [serverId, supportsAgentMove, workspaceKey]);
}
