import type { AgentAddress } from "./addresses.js";
export const PARENT_SERVER_ID_LABEL = "paseo.parent-server-id";
export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";
const OPEN_AGENT_TAB_LABEL_PREFIX = "paseo.open-agent-tab.";

export function getOpenAgentTabLabel(clientId: string): string {
  return `${OPEN_AGENT_TAB_LABEL_PREFIX}${clientId}`;
}

export function isOpenAgentTabLabel(label: string): boolean {
  return label.startsWith(OPEN_AGENT_TAB_LABEL_PREFIX);
}

export interface AgentLabelSource {
  labels?: Record<string, unknown> | null;
}

export function getParentAgentIdFromLabels(labels: Record<string, unknown> | null | undefined) {
  const parentAgentId = labels?.[PARENT_AGENT_ID_LABEL];
  return typeof parentAgentId === "string" && parentAgentId.trim().length > 0
    ? parentAgentId.trim()
    : null;
}

export function isDelegatedAgent(agent: AgentLabelSource): boolean {
  return getParentAgentIdFromLabels(agent.labels) !== null;
}

export function hasOpenAgentTab(labels: Record<string, unknown> | null | undefined): boolean {
  return Object.entries(labels ?? {}).some(
    ([label, value]) => isOpenAgentTabLabel(label) && value === "true",
  );
}

// Absent parent server label means the same host.
export function getParentAddressFromLabels(
  labels: Record<string, unknown> | null | undefined,
  serverId: string,
): AgentAddress | null {
  const agentId = getParentAgentIdFromLabels(labels);
  if (!agentId) return null;
  const parentServerId = labels?.[PARENT_SERVER_ID_LABEL];
  return {
    serverId:
      typeof parentServerId === "string" && parentServerId.trim()
        ? parentServerId.trim()
        : serverId,
    agentId,
  };
}
export function parentAddressLabels(parent: AgentAddress): Record<string, string> {
  return { [PARENT_AGENT_ID_LABEL]: parent.agentId, [PARENT_SERVER_ID_LABEL]: parent.serverId };
}

export const MOVED_FROM_AGENT_ID_LABEL = "paseo.moved-from-agent-id";
export const MOVED_TO_AGENT_ID_LABEL = "paseo.moved-to-agent-id";
/**
 * Fork delta (session move): every agent the session was moved from, nearest first, comma
 * separated. The moved-from label names only the last one, and a client that was away for two
 * moves holds no record of the agents in between.
 */
export const MOVED_FROM_AGENT_IDS_LABEL = "paseo.moved-from-agent-ids";

function readLabel(labels: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = labels?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function getMovedFromAgentId(labels: Record<string, unknown> | null | undefined) {
  return readLabel(labels, MOVED_FROM_AGENT_ID_LABEL);
}

export function getMovedFromAgentIds(labels: Record<string, unknown> | null | undefined): string[] {
  const value = readLabel(labels, MOVED_FROM_AGENT_IDS_LABEL);
  if (!value) return [];
  return value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export function getMovedToAgentId(labels: Record<string, unknown> | null | undefined) {
  return readLabel(labels, MOVED_TO_AGENT_ID_LABEL);
}
