import { stateLabel } from "./agent-card.js";
import { agentTitle, dotTone, type DotTone, type OfficeRoom } from "./model.js";

/** The choice that wakes no agent. */
export const NOBODY = "";
/** The search field shows from this many agents: more than eight. */
export const SEARCH_FROM = 9;

export interface PickerRow {
  agentId: string;
  title: string;
  /** The agent's room and its state, in the agent card's words: "shop-api · Idle". */
  detail: string;
  tone: DotTone;
}

export interface PickerGroup {
  label: "This room" | "Other rooms";
  rows: PickerRow[];
}

function rowsOf(room: OfficeRoom, wanted: string): PickerRow[] {
  const inRoom = room.name.toLowerCase().includes(wanted);
  return room.rows
    .filter(({ agent }) => inRoom || agentTitle(agent).toLowerCase().includes(wanted))
    .map(({ agent }) => ({
      agentId: agent.id,
      title: agentTitle(agent),
      detail: `${room.name} · ${stateLabel(agent)}`,
      tone: dotTone(agent),
    }));
}

/**
 * The agents a post on this room's board can wake: the room's own first, then every other
 * room's in the office's order. A query keeps the agents whose title or room has it.
 */
export function pickerGroups(
  rooms: readonly OfficeRoom[],
  roomId: string,
  query: string,
): PickerGroup[] {
  const wanted = query.trim().toLowerCase();
  const own = rooms.filter((room) => room.id === roomId).flatMap((room) => rowsOf(room, wanted));
  const others = rooms.filter((room) => room.id !== roomId).flatMap((room) => rowsOf(room, wanted));
  const groups: PickerGroup[] = [];
  if (own.length > 0) groups.push({ label: "This room", rows: own });
  if (others.length > 0) groups.push({ label: "Other rooms", rows: others });
  return groups;
}

/** With this many agents the page has a search field. */
export function showsSearch(rooms: readonly OfficeRoom[]): boolean {
  return rooms.reduce((sum, room) => sum + room.rows.length, 0) >= SEARCH_FROM;
}

function titleOf(to: string, rooms: readonly OfficeRoom[]): string | null {
  for (const room of rooms) {
    const row = room.rows.find((candidate) => candidate.agent.id === to);
    if (row) return agentTitle(row.agent);
  }
  return null;
}

/** The choice to keep: nobody once the chosen agent has left the office. */
export function keptChoice(to: string, rooms: readonly OfficeRoom[]): string {
  return to !== NOBODY && titleOf(to, rooms) !== null ? to : NOBODY;
}

/** What the form says is chosen: the agent's title, or "Nobody". */
export function choiceLabel(to: string, rooms: readonly OfficeRoom[]): string {
  return (to === NOBODY ? null : titleOf(to, rooms)) ?? "Nobody";
}

/**
 * What a close of the sheet does. The host draws its sheet three ways. On the web's wide layout it
 * is a dialog that stays open until told: Escape, its close button and a press beside it only ask,
 * so from the page a close goes back to the form. A phone's sheet is swiped away before it says
 * so, and a tablet's is dismissed by Android's Back before it says so: there the sheet has already
 * left, and the close closes.
 */
export function closeStep(picking: boolean, sheetLeavesFirst: boolean): "back" | "close" {
  return picking && !sheetLeavesFirst ? "back" : "close";
}

/** The host's sheet has already left when it reports a close: everywhere but the web's wide dialog. */
export function sheetLeavesFirstOn(compact: boolean, platform: "ios" | "android" | "web"): boolean {
  return compact || platform !== "web";
}
