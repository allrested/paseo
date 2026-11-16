// Who is where in the 2D office, from what the office knows of each agent. Nothing here is
// remembered but a coffee break, when each person came to rest and the janitor's round: the rest
// follows the agent's state, the time and whether a stand-up is on, so an office opened in the
// middle of a turn shows everyone where they are.
import type { ActivityKind, ActivityStep } from "../../shared/contracts.js";
import { NEARLY_FULL } from "../context-text.js";
import type { WorldMemory, WorldPeople } from "../world/adapter.js";
import type { WorldEvent, WorldSession } from "../world/world-api.js";
import type { IconKind } from "./art.js";
import type { PlaceKind } from "./floor-plan.js";

/** What a desk's screen shows. */
export type ScreenState = "off" | "code" | "wait" | "fail";

export interface Standing {
  /** The place the person is at, or walks to; null at the desk. */
  place: PlaceKind | null;
  /** What the person is at, over the head; null when the screen says it all. */
  icon: IconKind | null;
  screen: ScreenState;
}

const WORK: Readonly<Record<ActivityKind, { place: PlaceKind | null; icon: IconKind }>> = {
  read: { place: "library", icon: "read" },
  search: { place: "library", icon: "search" },
  // A skill is opened at the library, as in my-office.
  skill: { place: "library", icon: "read" },
  edit: { place: null, icon: "edit" },
  write: { place: null, icon: "edit" },
  commit: { place: null, icon: "commit" },
  web: { place: null, icon: "web" },
  tool: { place: null, icon: "tool" },
  command: { place: "racks", icon: "command" },
  test: { place: "racks", icon: "test" },
  plan: { place: "board", icon: "plan" },
  subagent: { place: "board", icon: "subagent" },
  // The pad is for a deploy that succeeded (standingOf): a push is shipped from the desk.
  push: { place: null, icon: "ship" },
  deploy: { place: "racks", icon: "ship" },
};

/** Where a resting person spends a turn of the lively floor: the places the lounge draws. */
export type RestPlace = "sofa" | "coffee" | "plant";

/**
 * Where a person is and what shows over the head. Whoever needs the user is at the desk, where
 * the card opens: an error first, then a question. Work goes where its tool call belongs, and a
 * rest is at the desk with the screen off, but for the break after a turn and for a turn in the
 * lounge (`rest`). A stand-up calls whoever rests to the whiteboard, from a break too; nobody
 * leaves work for it.
 */
export function standingOf(
  session: Pick<WorldSession, "status" | "stuck">,
  step: ActivityStep | undefined,
  onBreak: boolean,
  meeting: boolean,
  rest: RestPlace | null = null,
): Standing {
  if (session.stuck) return { place: null, icon: "fail", screen: "fail" };
  if (session.status === "wait") return { place: null, icon: "wait", screen: "wait" };
  if (session.status === "rest") {
    if (meeting) return { place: "board", icon: null, screen: "off" };
    if (onBreak || rest === "coffee") return { place: "coffee", icon: "coffee", screen: "off" };
    return { place: rest, icon: null, screen: "off" };
  }
  if (step === undefined) return { place: null, icon: null, screen: "code" };
  // A deploy that succeeded stands at the pad, where its rocket flies.
  if (step.kind === "deploy" && step.result === "passed") {
    return { place: "pad", icon: "ship", screen: "code" };
  }
  const work = WORK[step.kind];
  // A test run or a deploy that ended shows how, where it ran.
  return { place: work.place, icon: step.result ?? work.icon, screen: "code" };
}

/**
 * A turn that ended is followed by this long away for a coffee. The walk there is part of it,
 * and takes up to half of it from the far end of a long floor.
 */
export const BREAK_MS = 30_000;

/** When each person on a break goes back to the desk, by agent id. */
export type Breaks = ReadonlyMap<string, number>;

export const NO_BREAKS: Breaks = new Map();

/**
 * The breaks after these events at `now`: a turn that ended starts one, and one ends when its
 * time is up, its agent works again or the agent left. The same map comes back when nothing
 * changed.
 */
export function breaksAfter(
  breaks: Breaks,
  events: readonly WorldEvent[],
  sessions: readonly WorldSession[],
  now: number,
): Breaks {
  const resting = new Set(
    sessions
      .filter((session) => session.status === "rest" && !session.stuck)
      .map((session) => session.id),
  );
  const next = new Map<string, number>();
  for (const [id, until] of breaks) if (until > now && resting.has(id)) next.set(id, until);
  for (const event of events) {
    if (event.type === "stop" && resting.has(event.sess)) next.set(event.sess, now + BREAK_MS);
  }
  const same =
    next.size === breaks.size && [...next].every(([id, until]) => breaks.get(id) === until);
  return same ? breaks : next;
}

/** When the first break ends; null when nobody is on one. */
export function nextBreakEnd(breaks: Breaks): number | null {
  let first: number | null = null;
  for (const until of breaks.values()) if (first === null || until < first) first = until;
  return first;
}

/** The lively floor's hours, by the device's clock: from 08:00 to 21:00. */
export const DAY_FROM = 8;
export const DAY_TO = 21;
/** A resting person is at one place, or at the desk, for this long. */
export const TURN_MS = 180_000;
/** After this long at rest a person mostly stays at the desk. */
export const LONG_REST_MS = 2 * 60 * 60 * 1000;
/** One turn in this many is spent away from the desk; after a long rest, one in this many. */
const AWAY_EVERY = 2;
const AWAY_EVERY_LONG = 6;
const REST_PLACES: readonly RestPlace[] = ["sofa", "coffee", "plant"];
/** How many rest at each place at once: a spot each. */
const REST_ROOM: Readonly<Record<RestPlace, number>> = { sofa: 2, coffee: 1, plant: 1 };

/** When each resting person came to rest, by agent id. */
export type Rests = ReadonlyMap<string, number>;

export const NO_RESTS: Rests = new Map();

/**
 * Since when each person rests, at `now`: someone newly at rest starts now, and someone who
 * works, waits, stopped on an error or left is dropped. The same map comes back when nothing
 * changed.
 */
export function restsAfter(rests: Rests, sessions: readonly WorldSession[], now: number): Rests {
  const next = new Map<string, number>();
  for (const session of sessions) {
    if (session.status === "rest" && !session.stuck) {
      next.set(session.id, rests.get(session.id) ?? now);
    }
  }
  const same = next.size === rests.size && [...next].every(([id, at]) => rests.get(id) === at);
  return same ? rests : next;
}

/** What the lively floor goes by: the time, since when each person rests, and the room. */
export interface Leisure {
  now: number;
  rests: Rests;
  /** The room is wide enough for a sofa. */
  sofa: boolean;
}

/** The same number for an id on every device. */
function hashOf(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619) >>> 0;
  }
  return hash;
}

/**
 * Where a resting person would be in the turn `now` falls in, best first; none for the desk.
 * It follows from the id and the time alone, so every device shows the same floor. By day a
 * person is away every other turn, each time at the next place, so never at one place two turns
 * running; after a long rest, one turn in six. At night everyone stays at the desk.
 */
export function restWishes(id: string, { now, rests, sofa }: Leisure): RestPlace[] {
  const hour = new Date(now).getHours();
  if (hour < DAY_FROM || hour >= DAY_TO) return [];
  const since = rests.get(id);
  const long = since !== undefined && now - since >= LONG_REST_MS;
  const every = long ? AWAY_EVERY_LONG : AWAY_EVERY;
  const turn = Math.floor(now / TURN_MS) + hashOf(id);
  if (turn % every !== 0) return [];
  const places = sofa ? REST_PLACES : REST_PLACES.filter((place) => place !== "sofa");
  const first = Math.floor(turn / every) % places.length;
  return [...places.slice(first), ...places.slice(0, first)];
}

export interface CastMember {
  id: string;
  name: string;
  standing: Standing;
  /** The person's place in line at the place; 0 at the desk. */
  spot: number;
}

/**
 * Everyone with a desk, in desk order, each with a place in line where they stand. `meeting`:
 * a stand-up is on. `leisure`: the lively floor, where whoever rests takes turns in the lounge,
 * one person a spot; null (motion reduced) keeps them at their desks. A break after a turn and a
 * stand-up come before it.
 */
export function castOf(
  people: WorldPeople,
  breaks: Breaks,
  meeting: boolean,
  leisure: Leisure | null = null,
): CastMember[] {
  const lines = new Map<PlaceKind, number>();
  const resting = new Map<RestPlace, number>();
  const restOf = (session: WorldSession): RestPlace | null => {
    if (leisure === null || meeting || breaks.has(session.id)) return null;
    if (session.status !== "rest" || session.stuck) return null;
    const place = restWishes(session.id, leisure).find(
      (wish) => (resting.get(wish) ?? 0) < REST_ROOM[wish],
    );
    if (place === undefined) return null;
    resting.set(place, (resting.get(place) ?? 0) + 1);
    return place;
  };
  return people.sessions.map((session) => {
    const standing = standingOf(
      session,
      people.steps.get(session.id),
      breaks.has(session.id),
      meeting,
      restOf(session),
    );
    let spot = 0;
    if (standing.place !== null) {
      spot = lines.get(standing.place) ?? 0;
      lines.set(standing.place, spot + 1);
    }
    return { id: session.id, name: session.name, standing, spot };
  });
}

/** The paper in a desk's tray: more of it with a fuller context, and a flag when nearly full. */
export interface Tray {
  sheets: 0 | 1 | 2 | 3;
  flag: boolean;
}

export function trayOf(full: number | null): Tray {
  if (full === null || full < 0.02) return { sheets: 0, flag: false };
  if (full < 1 / 3) return { sheets: 1, flag: false };
  if (full < 2 / 3) return { sheets: 2, flag: false };
  return { sheets: 3, flag: full >= NEARLY_FULL / 100 };
}

/** A desk the janitor is due at, and how full its context was before it emptied. */
export interface Visit {
  agentId: string;
  from: number;
}

/** The desks the janitor is due at, in the order they were called. */
export type Visits = readonly Visit[];

export const NO_VISITS: Visits = [];

/**
 * The janitor's round after these events: a context that emptied calls the janitor to that desk,
 * once, and a desk whose person left is dropped. `before` is what was known of each person
 * before the events: the tray stays as full as it was until the janitor has swept. The same list
 * comes back when nothing changed.
 */
export function visitsAfter(
  visits: Visits,
  events: readonly WorldEvent[],
  before: WorldMemory | null,
  seated: ReadonlySet<string>,
): Visits {
  const next = visits.filter((visit) => seated.has(visit.agentId));
  for (const event of events) {
    if (event.type !== "compact" || !seated.has(event.sess)) continue;
    if (next.some((visit) => visit.agentId === event.sess)) continue;
    next.push({ agentId: event.sess, from: before?.get(event.sess)?.full ?? 0 });
  }
  const same =
    next.length === visits.length && next.every((visit, index) => visit === visits[index]);
  return same ? visits : next;
}

/** The round once the janitor has swept at a desk. */
export function visitsSwept(visits: Visits, agentId: string): Visits {
  return visits.some((visit) => visit.agentId === agentId)
    ? visits.filter((visit) => visit.agentId !== agentId)
    : visits;
}
