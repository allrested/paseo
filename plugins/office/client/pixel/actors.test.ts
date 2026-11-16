import { describe, expect, it } from "vitest";
import type { ActivityStep } from "../../shared/contracts.js";
import type { WorldSession } from "../world/world-api.js";
import type { WorldMemory } from "../world/adapter.js";
import {
  BREAK_MS,
  LONG_REST_MS,
  NO_BREAKS,
  NO_RESTS,
  NO_VISITS,
  TURN_MS,
  breaksAfter,
  castOf,
  nextBreakEnd,
  restWishes,
  restsAfter,
  standingOf,
  trayOf,
  visitsAfter,
  visitsSwept,
  type Leisure,
} from "./actors.js";

function session(id: string, patch: Partial<WorldSession> = {}): WorldSession {
  return {
    id,
    name: id,
    title: id,
    dir: "team",
    git: { repo: "team" },
    status: "work",
    agent: "claude",
    lastPrompt: "",
    stuck: false,
    subs: [],
    ...patch,
  };
}

const step = (kind: ActivityStep["kind"], patch: Partial<ActivityStep> = {}): ActivityStep => ({
  kind,
  key: `${kind}-1`,
  ...patch,
});

describe("standingOf", () => {
  it("sends each kind of work to its place", () => {
    const at = (kind: ActivityStep["kind"]) => standingOf(session("a"), step(kind), false, false);
    expect(at("read")).toEqual({ place: "library", icon: "read", screen: "code" });
    expect(at("search")).toEqual({ place: "library", icon: "search", screen: "code" });
    // (a skill is opened at the library, with the book that reading has)
    expect(at("skill")).toEqual({ place: "library", icon: "read", screen: "code" });
    expect(at("command")).toEqual({ place: "racks", icon: "command", screen: "code" });
    expect(at("test")).toEqual({ place: "racks", icon: "test", screen: "code" });
    expect(at("plan")).toEqual({ place: "board", icon: "plan", screen: "code" });
    expect(at("subagent")).toEqual({ place: "board", icon: "subagent", screen: "code" });
    expect(at("push")).toEqual({ place: "pad", icon: "ship", screen: "code" });
    expect(at("deploy")).toEqual({ place: "pad", icon: "ship", screen: "code" });
    for (const kind of ["edit", "write", "commit", "web", "tool"] as const) {
      expect(at(kind).place).toBeNull();
      expect(at(kind).icon).not.toBeNull();
    }
  });

  it("shows how a test run ended, at the racks", () => {
    expect(standingOf(session("a"), step("test", { result: "passed" }), false, false)).toEqual({
      place: "racks",
      icon: "passed",
      screen: "code",
    });
    expect(standingOf(session("a"), step("test", { result: "failed" }), false, false).icon).toBe(
      "failed",
    );
  });

  it("types at the desk when the agent works at no tool call", () => {
    expect(standingOf(session("a"), undefined, false, false)).toEqual({
      place: null,
      icon: null,
      screen: "code",
    });
  });

  it("keeps whoever needs the user at the desk, an error before a question", () => {
    const reading = step("read");
    expect(standingOf(session("a", { status: "wait" }), reading, false, false)).toEqual({
      place: null,
      icon: "wait",
      screen: "wait",
    });
    expect(standingOf(session("a", { status: "wait", stuck: true }), reading, true, false)).toEqual(
      {
        place: null,
        icon: "fail",
        screen: "fail",
      },
    );
  });

  it("rests at the desk with the screen off, but for a break", () => {
    const resting = session("a", { status: "rest" });
    expect(standingOf(resting, undefined, false, false)).toEqual({
      place: null,
      icon: null,
      screen: "off",
    });
    expect(standingOf(resting, undefined, true, false)).toEqual({
      place: "coffee",
      icon: "coffee",
      screen: "off",
    });
  });

  it("calls whoever rests to the whiteboard for a stand-up, and nobody else", () => {
    const resting = session("a", { status: "rest" });
    const atBoard = { place: "board", icon: null, screen: "off" };
    expect(standingOf(resting, undefined, false, true)).toEqual(atBoard);
    expect(standingOf(resting, undefined, true, true)).toEqual(atBoard);
    expect(standingOf(session("a"), step("read"), false, true).place).toBe("library");
    expect(standingOf(session("a"), undefined, false, true).place).toBeNull();
    expect(standingOf(session("a", { status: "wait" }), undefined, false, true).place).toBeNull();
    expect(
      standingOf(session("a", { status: "rest", stuck: true }), undefined, false, true).place,
    ).toBeNull();
  });
});

describe("breaksAfter", () => {
  const resting = [session("a", { status: "rest" }), session("b", { status: "rest" })];

  it("starts a break when a turn ends", () => {
    const breaks = breaksAfter(NO_BREAKS, [{ sess: "a", type: "stop" }], resting, 1_000);
    expect([...breaks]).toEqual([["a", 1_000 + BREAK_MS]]);
    expect(nextBreakEnd(breaks)).toBe(1_000 + BREAK_MS);
  });

  it("ends a break when its time is up, the agent works again or it left", () => {
    const started = breaksAfter(
      NO_BREAKS,
      [
        { sess: "a", type: "stop" },
        { sess: "b", type: "stop" },
      ],
      resting,
      0,
    );
    expect(breaksAfter(started, [], resting, BREAK_MS).size).toBe(0);
    const working = [session("a"), session("b", { status: "rest" })];
    expect([...breaksAfter(started, [], working, 1).keys()]).toEqual(["b"]);
    expect([...breaksAfter(started, [], [session("a", { status: "rest" })], 1).keys()]).toEqual([
      "a",
    ]);
  });

  it("gives no break to an agent that stopped on an error", () => {
    const stuck = [session("a", { status: "rest", stuck: true })];
    expect(breaksAfter(NO_BREAKS, [{ sess: "a", type: "stop" }], stuck, 0).size).toBe(0);
  });

  it("returns the map it was given when nothing changed", () => {
    const started = breaksAfter(NO_BREAKS, [{ sess: "a", type: "stop" }], resting, 0);
    expect(breaksAfter(started, [{ sess: "b", type: "read" }], resting, 5)).toBe(started);
    expect(breaksAfter(NO_BREAKS, [], resting, 5)).toBe(NO_BREAKS);
    expect(nextBreakEnd(NO_BREAKS)).toBeNull();
  });
});

describe("castOf", () => {
  it("lines people up at a place in desk order", () => {
    const sessions = [session("a"), session("b"), session("c", { status: "rest" }), session("d")];
    const steps = new Map([
      ["a", step("read")],
      ["b", step("edit")],
      ["d", step("search")],
    ]);
    const cast = castOf({ sessions, overflow: 0, steps }, NO_BREAKS, false);
    expect(cast.map((member) => [member.id, member.standing.place, member.spot])).toEqual([
      ["a", "library", 0],
      ["b", null, 0],
      ["c", null, 0],
      ["d", "library", 1],
    ]);
  });

  it("lines a stand-up up at the whiteboard beside whoever plans there", () => {
    const sessions = [
      session("a", { status: "rest" }),
      session("b"),
      session("c", { status: "rest" }),
    ];
    const steps = new Map([["b", step("plan")]]);
    const cast = castOf({ sessions, overflow: 0, steps }, NO_BREAKS, true);
    expect(cast.map((member) => [member.id, member.standing.place, member.spot])).toEqual([
      ["a", "board", 0],
      ["b", "board", 1],
      ["c", "board", 2],
    ]);
  });
});

describe("trayOf", () => {
  it("stacks more paper as a context fills, and flags one that is nearly full", () => {
    expect(trayOf(null)).toEqual({ sheets: 0, flag: false });
    expect(trayOf(0)).toEqual({ sheets: 0, flag: false });
    expect(trayOf(0.1)).toEqual({ sheets: 1, flag: false });
    expect(trayOf(0.5)).toEqual({ sheets: 2, flag: false });
    expect(trayOf(0.84)).toEqual({ sheets: 3, flag: false });
    expect(trayOf(0.85)).toEqual({ sheets: 3, flag: true });
    expect(trayOf(1)).toEqual({ sheets: 3, flag: true });
  });
});

describe("the lively floor", () => {
  /** A time of 16 November 2026 by the device's clock; a turn starts on every third minute. */
  const at = (hour: number, minute = 0) => new Date(2026, 10, 16, hour, minute).getTime();
  const floor = (now: number, patch: Partial<Leisure> = {}): Leisure => ({
    now,
    rests: NO_RESTS,
    sofa: true,
    ...patch,
  });
  const ids = Array.from({ length: 40 }, (_, index) => `agent-${index}`);
  const resting = (list: readonly string[]) => ({
    sessions: list.map((id) => session(id, { status: "rest" })),
    overflow: 0,
    steps: new Map<string, ActivityStep>(),
  });
  const placeOf = (id: string, leisure: Leisure) => restWishes(id, leisure)[0] ?? null;

  it("keeps since when each person rests, and drops who works or left", () => {
    const first = restsAfter(NO_RESTS, [session("a", { status: "rest" }), session("b")], 1_000);
    expect([...first]).toEqual([["a", 1_000]]);
    const both = [session("a", { status: "rest" }), session("b", { status: "rest" })];
    const second = restsAfter(first, both, 5_000);
    expect([...second]).toEqual([
      ["a", 1_000],
      ["b", 5_000],
    ]);
    // Nothing changed: the same map, so nothing draws again.
    expect(restsAfter(second, both, 9_000)).toBe(second);
    expect([...restsAfter(second, [session("b", { status: "rest", stuck: true })], 9_000)]).toEqual(
      [],
    );
    expect(restsAfter(NO_RESTS, [session("a")], 1_000)).toBe(NO_RESTS);
  });

  it("sends a resting person to the lounge every other turn by day, each time somewhere else", () => {
    for (const id of ids) {
      const turns = Array.from({ length: 12 }, (_, turn) =>
        placeOf(id, floor(at(10) + turn * TURN_MS)),
      );
      // Away and at the desk in turn: never at one place two turns running.
      turns.forEach((place, turn) => {
        expect(place === null).toBe((turns[0] === null) === (turn % 2 === 0));
      });
      const away = turns.filter((place) => place !== null);
      expect(away).toHaveLength(6);
      away.forEach((place, index) => {
        if (index > 0) expect(place).not.toBe(away[index - 1]);
      });
      expect(new Set(away)).toEqual(new Set(["sofa", "coffee", "plant"]));
    }
    // The whole of a turn is one answer, on every device.
    expect(placeOf("agent-1", floor(at(10, 0) + 1))).toBe(placeOf("agent-1", floor(at(10, 3) - 1)));
  });

  it("offers the other places when the first is taken, and none on the sofa of a room without one", () => {
    const id = ids.find((one) => placeOf(one, floor(at(10))) === "sofa") ?? "";
    expect(restWishes(id, floor(at(10)))).toEqual(["sofa", "coffee", "plant"]);
    for (const one of ids) {
      for (let turn = 0; turn < 6; turn += 1) {
        expect(restWishes(one, floor(at(10) + turn * TURN_MS, { sofa: false }))).not.toContain(
          "sofa",
        );
      }
    }
  });

  it("keeps everyone at the desk at night", () => {
    for (const hour of [21, 23, 0, 3, 7]) {
      for (let turn = 0; turn < 4; turn += 1) {
        for (const id of ids) {
          expect(restWishes(id, floor(at(hour) + turn * TURN_MS))).toEqual([]);
        }
      }
    }
    expect(ids.some((id) => restWishes(id, floor(at(8))).length > 0)).toBe(true);
    expect(ids.some((id) => restWishes(id, floor(at(20, 57))).length > 0)).toBe(true);
  });

  it("mostly keeps someone who has rested two hours at the desk", () => {
    const now = at(14);
    const count = (rests: ReadonlyMap<string, number>) =>
      Array.from({ length: 12 }, (_, turn) =>
        placeOf("agent-3", floor(now + turn * TURN_MS, { rests })),
      ).filter((place) => place !== null).length;
    expect(count(new Map([["agent-3", now - LONG_REST_MS + 13 * TURN_MS]]))).toBe(6);
    expect(count(new Map([["agent-3", now - LONG_REST_MS]]))).toBe(2);
  });

  it("puts one person on a spot: two on the sofa, one at the machine, one at the plant", () => {
    for (let turn = 0; turn < 6; turn += 1) {
      const cast = castOf(resting(ids), NO_BREAKS, false, floor(at(11) + turn * TURN_MS));
      const taken = cast.map((member) => `${member.standing.place}:${member.spot}`);
      const away = taken.filter((key) => !key.startsWith("null"));
      expect(new Set(away).size).toBe(away.length);
      expect(away.toSorted()).toEqual(["coffee:0", "plant:0", "sofa:0", "sofa:1"]);
    }
    // Without a sofa: the machine and the plant.
    const narrow = castOf(resting(ids), NO_BREAKS, false, floor(at(11), { sofa: false }));
    expect(
      narrow
        .map((member) => member.standing.place)
        .filter((place) => place !== null)
        .toSorted(),
    ).toEqual(["coffee", "plant"]);
  });

  it("shows a nap on the sofa and a look at the plant with the screen off, and a cup at the machine", () => {
    const rest = session("a", { status: "rest" });
    expect(standingOf(rest, undefined, false, false, "sofa")).toEqual({
      place: "sofa",
      icon: null,
      screen: "off",
    });
    expect(standingOf(rest, undefined, false, false, "plant")).toEqual({
      place: "plant",
      icon: null,
      screen: "off",
    });
    expect(standingOf(rest, undefined, false, false, "coffee")).toEqual({
      place: "coffee",
      icon: "coffee",
      screen: "off",
    });
  });

  it("lets a break, a stand-up and work come first", () => {
    const id = ids.find((one) => placeOf(one, floor(at(10))) === "sofa") ?? "";
    const leisure = floor(at(10));
    const one = (patch: Partial<WorldSession>, steps = new Map<string, ActivityStep>()) => ({
      sessions: [session(id, patch)],
      overflow: 0,
      steps,
    });
    const placeIn = (cast: ReturnType<typeof castOf>) => cast[0]?.standing.place;
    expect(placeIn(castOf(one({ status: "rest" }), NO_BREAKS, false, leisure))).toBe("sofa");
    // The coffee after a turn.
    const onBreak = new Map([[id, at(10) + BREAK_MS]]);
    expect(placeIn(castOf(one({ status: "rest" }), onBreak, false, leisure))).toBe("coffee");
    // A stand-up at the whiteboard.
    expect(placeIn(castOf(one({ status: "rest" }), NO_BREAKS, true, leisure))).toBe("board");
    // Work, a question and an error.
    const reading = new Map([[id, step("read")]]);
    expect(placeIn(castOf(one({ status: "work" }, reading), NO_BREAKS, false, leisure))).toBe(
      "library",
    );
    expect(placeIn(castOf(one({ status: "work" }), NO_BREAKS, false, leisure))).toBeNull();
    expect(placeIn(castOf(one({ status: "wait" }), NO_BREAKS, false, leisure))).toBeNull();
    expect(
      placeIn(castOf(one({ status: "rest", stuck: true }), NO_BREAKS, false, leisure)),
    ).toBeNull();
  });

  it("keeps everyone at the desk with motion reduced", () => {
    const cast = castOf(resting(ids), NO_BREAKS, false, null);
    expect(cast.every((member) => member.standing.place === null)).toBe(true);
    expect(castOf(resting(ids), NO_BREAKS, false).every((m) => m.standing.place === null)).toBe(
      true,
    );
  });
});

describe("the janitor's round", () => {
  const told = (full: number | null) => ({
    status: "rest" as const,
    stuck: false,
    step: null,
    running: null,
    full,
  });
  const before: WorldMemory = new Map([
    ["a", told(0.9)],
    ["b", told(0.6)],
    ["c", told(null)],
  ]);
  const seated = new Set(["a", "b", "c"]);
  const compact = (sess: string) => ({ sess, type: "compact" as const });

  it("calls the janitor to a desk whose context emptied, with the tray as full as it was", () => {
    const visits = visitsAfter(NO_VISITS, [compact("b"), compact("a")], before, seated);
    expect(visits).toEqual([
      { agentId: "b", from: 0.6 },
      { agentId: "a", from: 0.9 },
    ]);
  });

  it("is one visit for a desk that is called twice before the janitor came", () => {
    const first = visitsAfter(NO_VISITS, [compact("a")], before, seated);
    expect(visitsAfter(first, [compact("a")], new Map([["a", told(0.1)]]), seated)).toBe(first);
  });

  it("ignores other events, people without a desk and a memory that knows nothing", () => {
    expect(visitsAfter(NO_VISITS, [{ sess: "a", type: "stop" }], before, seated)).toBe(NO_VISITS);
    expect(visitsAfter(NO_VISITS, [compact("z")], before, seated)).toBe(NO_VISITS);
    expect(visitsAfter(NO_VISITS, [compact("c")], null, seated)).toEqual([
      { agentId: "c", from: 0 },
    ]);
  });

  it("drops a desk whose person left, and a desk that was swept", () => {
    const visits = visitsAfter(NO_VISITS, [compact("a"), compact("b")], before, seated);
    expect(visitsAfter(visits, [], before, new Set(["b"]))).toEqual([{ agentId: "b", from: 0.6 }]);
    expect(visitsSwept(visits, "a")).toEqual([{ agentId: "b", from: 0.6 }]);
    expect(visitsSwept(visits, "z")).toBe(visits);
  });
});
