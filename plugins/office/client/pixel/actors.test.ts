import { describe, expect, it } from "vitest";
import type { ActivityStep } from "../../shared/contracts.js";
import type { WorldSession } from "../world/world-api.js";
import type { WorldMemory } from "../world/adapter.js";
import {
  BREAK_MS,
  NO_BREAKS,
  NO_VISITS,
  breaksAfter,
  castOf,
  nextBreakEnd,
  standingOf,
  trayOf,
  visitsAfter,
  visitsSwept,
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

describe("the janitor's round", () => {
  const told = (full: number | null) => ({
    status: "rest" as const,
    stuck: false,
    step: null,
    testing: false,
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
