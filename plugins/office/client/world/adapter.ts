import { agentTitle, attentionReason, type OfficeModel, type OfficeRow } from "../model.js";
import type {
  ActivityKind,
  ActivityStep,
  OfficeAgent,
  TestResult,
} from "../../shared/contracts.js";
import { relativeLuminance } from "../scene/palette.js";
import type {
  WorldBoardRow,
  WorldColors,
  WorldEvent,
  WorldEventType,
  WorldSession,
} from "./world-api.js";

/** Desks of each floor plan of the vendored scene; who does not fit stays in the list view. */
export const PLAN_DESKS = { pro: 12, cozy: 9 } as const;
export type WorldPlan = keyof typeof PLAN_DESKS;

export interface WorldPeople {
  sessions: WorldSession[];
  /** Agents without a desk on this plan. */
  overflow: number;
  /** The tool call each seated agent is at, for the ones at one. */
  steps: ReadonlyMap<string, ActivityStep>;
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
  const rows = model.rooms.flatMap((room) => room.rows.map((row) => ({ row, team: room.name })));
  const all = rows.map(({ row, team }) => toSession(row, team));
  const desks = PLAN_DESKS[plan];
  const order = new Map(all.map((session, index) => [session.id, index]));
  const seated =
    all.length <= desks
      ? all
      : [...all]
          .sort((a, b) => rank(a) - rank(b) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
          .slice(0, desks)
          .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const atDesk = new Set(seated.map((session) => session.id));
  const steps = new Map<string, ActivityStep>();
  for (const { row } of rows) {
    if (row.step !== null && atDesk.has(row.agent.id)) steps.set(row.agent.id, row.step);
  }
  return { sessions: seated, overflow: all.length - seated.length, steps };
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

/** A kind of work, as the scene names it: each has a place the person walks to. */
const STEP_EVENT: Readonly<Record<ActivityKind, WorldEventType>> = {
  read: "read",
  search: "grep",
  edit: "edit",
  write: "write",
  command: "bash",
  web: "web",
  tool: "mcp",
  subagent: "agent",
  plan: "plan",
  test: "test",
  commit: "commit",
  push: "push",
  deploy: "deploy",
};

const RESULT_EVENT: Readonly<Record<TestResult, WorldEventType>> = {
  passed: "testok",
  failed: "testfail",
};

/** What the scene was last told about a person. */
interface Told {
  status: WorldSession["status"];
  stuck: boolean;
  /** The key of the step the person was sent to; null when at none. */
  step: string | null;
  /** That step is a test run, and the scene has not been told how it ended. */
  testing: boolean;
}
export type WorldMemory = ReadonlyMap<string, Told>;

export interface WorldChanges {
  events: WorldEvent[];
  /** What the scene knows once it has the events. */
  memory: WorldMemory;
}

/** A turn that starts, one that ends, a new error; none for someone seen for the first time. */
function turnEvent(session: WorldSession, was: Told | undefined): WorldEventType | null {
  if (was === undefined) return null;
  if (session.stuck && !was.stuck) return "fail";
  if (was.status === "rest" && session.status === "work") return "prompt";
  return was.status !== "rest" && session.status === "rest" && !session.stuck ? "stop" : null;
}

function stepEvents(
  session: WorldSession,
  step: ActivityStep | undefined,
  was: Told | undefined,
): { events: WorldEventType[]; step: string | null; testing: boolean } {
  const events: WorldEventType[] = [];
  let told = was?.step ?? null;
  let testing = was?.testing ?? false;
  if (testing && step?.key !== told) {
    // The run's end was never seen: its lamp on the test board goes out.
    events.push("testend");
    testing = false;
  }
  if (step === undefined) return { events, step: null, testing };
  if (testing) {
    if (step.result !== undefined) {
      events.push(RESULT_EVENT[step.result]);
      testing = false;
    }
  } else if (session.status === "work" && step.key !== told) {
    told = step.key;
    testing = step.kind === "test" && step.result === undefined;
    events.push(step.result === undefined ? STEP_EVENT[step.kind] : RESULT_EVENT[step.result]);
  }
  return { events, step: told, testing };
}

/**
 * What changed since the scene was last told, as things its people do. A turn that starts is a
 * prompt carried to the desk, one that ends is reported and followed by a rest, an error is a
 * failure. A new tool call of an agent at work sends the person to that work's place, and that
 * is said at once, so an office just opened shows what everyone is at. A call seen while its
 * agent waits for the user is told once the agent works again: the approval is often for it.
 * A test run is told twice, when it starts and when it ends.
 */
export function worldChanges(before: WorldMemory | null, people: WorldPeople): WorldChanges {
  const events: WorldEvent[] = [];
  const memory = new Map<string, Told>();
  for (const session of people.sessions) {
    const was = before?.get(session.id);
    const turn = turnEvent(session, was);
    if (turn !== null) events.push({ sess: session.id, type: turn });
    const steps = stepEvents(session, people.steps.get(session.id), was);
    for (const type of steps.events) events.push({ sess: session.id, type });
    memory.set(session.id, {
      status: session.status,
      stuck: session.stuck,
      step: steps.step,
      testing: steps.testing,
    });
  }
  return { events, memory };
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
