import type { OfficeAgent } from "../shared/contracts.js";

/** On a sub-agent: its number among its parent's sub-agents. Never changes once written. */
export const NUMBER_KEY = "office.subagent.number";
/** On a parent: the number its next sub-agent gets, so an archived one's number is not reused. */
export const NEXT_KEY = "office.subagent.next";

export interface NumberedAgent {
  id: string;
  parentAgentId: string | null;
  createdAt: string;
  number?: number;
  next?: number;
}

export interface NumberWrite {
  agentId: string;
  patch: Record<string, number>;
}

/** A stored number: a positive integer, else unset. */
export function storedNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function byCreation(left: NumberedAgent, right: NumberedAgent): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

/**
 * The metadata to write so every shown sub-agent of a shown parent has a number: a new one gets
 * the larger of the parent's next and one more than its highest numbered child, in creation
 * order. The parent's next follows. The sub-agents' writes come before their parent's.
 */
export function planNumbers(agents: readonly NumberedAgent[]): NumberWrite[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const children = new Map<string, NumberedAgent[]>();
  for (const agent of agents) {
    const parent = agent.parentAgentId;
    if (parent === null || parent === agent.id || !byId.has(parent)) continue;
    children.set(parent, [...(children.get(parent) ?? []), agent]);
  }
  const writes: NumberWrite[] = [];
  for (const [parentId, own] of children) {
    const parent = byId.get(parentId);
    if (parent === undefined) continue;
    let highest = 0;
    for (const child of own)
      if (child.number !== undefined) highest = Math.max(highest, child.number);
    let next = Math.max(parent.next ?? 1, highest + 1);
    for (const child of [...own].sort(byCreation)) {
      if (child.number !== undefined) continue;
      writes.push({ agentId: child.id, patch: { [NUMBER_KEY]: next } });
      next += 1;
    }
    if (next !== parent.next) writes.push({ agentId: parentId, patch: { [NEXT_KEY]: next } });
  }
  return writes;
}

// As client/model.ts agentTitle names an agent without a name of the office's.
function ownTitle(agent: OfficeAgent): string {
  const title = agent.title?.trim();
  return title ? title : `Agent ${agent.id.slice(0, 8)}`;
}

/** `<parent's office name>-<number>` for each numbered sub-agent of a shown parent, by id. */
export function officeNames(agents: readonly OfficeAgent[]): Map<string, string> {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const names = new Map<string, string>();
  const nameOf = (agent: OfficeAgent, seen: Set<string>): string | null => {
    const known = names.get(agent.id);
    if (known !== undefined) return known;
    const parentId = agent.parentAgentId;
    if (agent.number === undefined || parentId === null || seen.has(parentId)) return null;
    const parent = byId.get(parentId);
    if (parent === undefined) return null;
    seen.add(agent.id);
    const name = `${nameOf(parent, seen) ?? ownTitle(parent)}-${agent.number}`;
    names.set(agent.id, name);
    return name;
  };
  for (const agent of agents) nameOf(agent, new Set());
  return names;
}
