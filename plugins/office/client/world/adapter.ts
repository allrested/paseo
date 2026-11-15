import { agentTitle, attentionReason, type OfficeModel, type OfficeRow } from "../model.js";
import type { OfficeAgent } from "../../shared/contracts.js";
import { relativeLuminance } from "../scene/palette.js";
import type { WorldBoardRow, WorldColors, WorldEvent, WorldSession } from "./world-api.js";

/** Desks of each floor plan of the vendored scene; who does not fit stays in the list view. */
export const PLAN_DESKS = { pro: 12, cozy: 9 } as const;
export type WorldPlan = keyof typeof PLAN_DESKS;

export interface WorldPeople {
  sessions: WorldSession[];
  /** Agents without a desk on this plan. */
  overflow: number;
}

function statusOf(agent: OfficeAgent): WorldSession["status"] {
  if (agent.permissions.length > 0) return "wait";
  if (agent.status === "running" || agent.status === "initializing") return "work";
  return "rest";
}

function markOf(provider: string): WorldSession["agent"] {
  const id = provider.toLowerCase();
  if (id.includes("codex")) return "codex";
  if (id.includes("gemini") || id.includes("antigravity")) return "gemini";
  return "claude";
}

/** Who needs the user comes first when the desks run out, then who works, then who rests. */
function rank(session: WorldSession): number {
  if (session.status === "wait" || session.stuck) return 0;
  return session.status === "work" ? 1 : 2;
}

function toSession(row: OfficeRow, team: string): WorldSession {
  const { agent } = row;
  const title = agentTitle(agent);
  return {
    id: agent.id,
    name: title,
    title,
    dir: team,
    git: { repo: team },
    status: statusOf(agent),
    agent: markOf(agent.provider),
    lastPrompt: "",
    stuck: attentionReason(agent) === "error",
    subs: [],
  };
}

/** The office's agents as the scene's people: a room is a team, seated together. */
export function worldPeople(model: OfficeModel, plan: WorldPlan): WorldPeople {
  const all = model.rooms.flatMap((room) => room.rows.map((row) => toSession(row, room.name)));
  const desks = PLAN_DESKS[plan];
  if (all.length <= desks) return { sessions: all, overflow: 0 };
  const order = new Map(all.map((session, index) => [session.id, index]));
  const seated = [...all]
    .sort((a, b) => rank(a) - rank(b) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .slice(0, desks)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { sessions: seated, overflow: all.length - desks };
}

function boardState(session: WorldSession): WorldBoardRow["state"] {
  if (session.status === "wait") return "wait";
  return session.status === "work" ? "doing" : "done";
}

function boardText(session: WorldSession, activity: string | null): string {
  if (session.stuck) return "Stopped on an error";
  if (session.status === "wait") return "Waiting for your answer";
  if (session.status === "work") return activity ?? "Working";
  return "Resting";
}

/** The whiteboard's rows: the people at a desk, who needs the user first. */
export function worldBoardRows(
  model: OfficeModel,
  sessions: readonly WorldSession[],
): WorldBoardRow[] {
  const activity = new Map(
    model.rooms.flatMap((room) => room.rows.map((row) => [row.agent.id, row.activity] as const)),
  );
  return [...sessions]
    .sort((a, b) => rank(a) - rank(b))
    .map((session) => ({
      id: session.id,
      name: session.name,
      text: boardText(session, activity.get(session.id) ?? null),
      state: boardState(session),
    }));
}

/** What the scene writes after "Error:" over someone whose turn failed; Paseo knows no more. */
const FAILED = "the agent stopped";

/** What the scene was last told about each person. */
export type WorldMemory = ReadonlyMap<string, { status: WorldSession["status"]; stuck: boolean }>;

export function rememberPeople(sessions: readonly WorldSession[]): WorldMemory {
  return new Map(
    sessions.map((session) => [session.id, { status: session.status, stuck: session.stuck }]),
  );
}

/**
 * What changed since the scene was last told, as things its people do: a turn that starts is a
 * prompt carried to the desk, one that ends is reported and followed by a rest, an error is a
 * failure. Someone new walks in by being in the list; nothing is said about them.
 */
export function worldEvents(
  before: WorldMemory | null,
  sessions: readonly WorldSession[],
): WorldEvent[] {
  if (before === null) return [];
  const events: WorldEvent[] = [];
  for (const session of sessions) {
    const was = before.get(session.id);
    if (was === undefined) continue;
    if (session.stuck && !was.stuck) {
      events.push({ sess: session.id, type: "fail", label: FAILED });
    } else if (was.status === "rest" && session.status === "work") {
      events.push({ sess: session.id, type: "prompt", label: "" });
    } else if (was.status !== "rest" && session.status === "rest" && !session.stuck) {
      events.push({ sess: session.id, type: "stop", label: "" });
    }
  }
  return events;
}

/** The team name of a room, as the scene knows it; null for a room that is not there. */
export function teamOfRoom(model: OfficeModel, roomId: string | null): string | null {
  if (roomId === null) return null;
  return model.rooms.find((room) => room.id === roomId)?.name ?? null;
}

export interface BoardChoice {
  /** The team whose chip was chosen; null for the whiteboard, which belongs to no team. */
  project: string | null;
  /** The workspace tab's room. */
  focusRoomId: string | null;
  selectedAgentId: string | null;
}

/**
 * The room whose board a tap in the scene opens. The scene has one whiteboard for every team, so
 * a tap on it opens the nearest room the surface knows: the tab's, the chosen agent's, or the
 * lobby, which the model puts first.
 */
export function boardRoom(model: OfficeModel, choice: BoardChoice): string | null {
  if (choice.project !== null) {
    return model.rooms.find((room) => room.name === choice.project)?.id ?? null;
  }
  const selected =
    choice.selectedAgentId === null ? undefined : model.roomOfAgent.get(choice.selectedAgentId);
  for (const id of [choice.focusRoomId, selected]) {
    if (id != null && model.rooms.some((room) => room.id === id)) return id;
  }
  return model.rooms[0]?.id ?? null;
}

/** A dark theme draws the office by night. */
export function isDarkTheme(colors: Pick<WorldColors, "surface0">): boolean {
  return relativeLuminance(colors.surface0) < 0.4;
}
