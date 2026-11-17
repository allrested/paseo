import type { OfficeModel, OfficeRoom, OfficeRow } from "../shared/model.js";
import { matchesQuery, tabOf, type ListTab } from "./list-text.js";

export const NO_AGENTS = "No agents yet.";

export interface SessionRow {
  row: OfficeRow;
  room: OfficeRoom;
}

const GROUP_ORDER: Record<Exclude<ListTab, "all">, number> = {
  attention: 0,
  working: 1,
  resting: 2,
};

/** When the agent last changed: its turn's end, else its last prompt, else its start. */
function changedAt(row: OfficeRow): number {
  const { agent } = row;
  const at = Date.parse(agent.idleSince ?? agent.promptedAt ?? agent.createdAt);
  return Number.isFinite(at) ? at : 0;
}

function byGroupThenNewest(left: SessionRow, right: SessionRow): number {
  return (
    GROUP_ORDER[tabOf(left.row)] - GROUP_ORDER[tabOf(right.row)] ||
    changedAt(right.row) - changedAt(left.row)
  );
}

/**
 * The Sessions panel's one list, across rooms: Needs you, then Working, then Resting, the newest
 * change first in each. A sub-agent follows its parent, indented, when the parent is shown; a
 * sub-agent whose parent the filter dropped stands on its own in its own place.
 */
export function sessionRows(model: OfficeModel, tab: ListTab, query: string): SessionRow[] {
  const matching: SessionRow[] = [];
  for (const room of model.rooms) {
    for (const row of room.rows) {
      if ((tab === "all" || tabOf(row) === tab) && matchesQuery(row, room, query)) {
        matching.push({ row, room });
      }
    }
  }
  matching.sort(byGroupThenNewest);
  const kept = new Set(matching.map(({ row }) => row.agent.id));
  const children = new Map<string, SessionRow[]>();
  const tops: SessionRow[] = [];
  for (const entry of matching) {
    const { agent } = entry.row;
    const parent = agent.parentAgentId;
    // The model's depth is per room; this list spans rooms, and a sub-agent in its own worktree
    // sits in another room than its parent.
    if (parent !== null && parent !== agent.id && kept.has(parent)) {
      const child = { ...entry, row: { ...entry.row, depth: 1 as const } };
      children.set(parent, [...(children.get(parent) ?? []), child]);
    } else {
      tops.push(entry.row.depth === 0 ? entry : { ...entry, row: { ...entry.row, depth: 0 } });
    }
  }
  const shown: SessionRow[] = [];
  const seen = new Set<string>();
  function visit(entry: SessionRow): void {
    if (seen.has(entry.row.agent.id)) return;
    seen.add(entry.row.agent.id);
    shown.push(entry);
    for (const child of children.get(entry.row.agent.id) ?? []) visit(child);
  }
  for (const entry of tops) visit(entry);
  // A parent chain that loops has no top row; its rows stand on their own rather than vanish.
  for (const entry of matching) visit({ ...entry, row: { ...entry.row, depth: 0 } });
  return shown;
}
