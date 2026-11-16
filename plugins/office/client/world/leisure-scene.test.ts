// Paseo's lively floor as it moves the people (paseo-leisure.js); its decisions are in
// leisure.test.ts. The upstream modules it imports draw on a canvas or WebGL as they load, which a
// test has not: each is stood in with the little the floor reads, and a person is the fields
// upstream's restroom visit (people/workers.js visitWc and wcTick) sets on them.
import { beforeEach, expect, test, vi } from "vitest";
import { leisureNow, updateLeisure } from "../../vendor/my-office/src/office/paseo-leisure.js";

const h = vi.hoisted(() => ({
  sessions: new Map<string, { id: string; status: string }>(),
  workers: new Map<string, Record<string, unknown>>(),
  stations: { coffee: [], dining: [], wc: [] as { x: number; z: number; by: unknown }[] },
}));

vi.mock("../../vendor/my-office/src/office/core/env.js", () => ({
  PRO: true,
  nowMs: () => 0,
  // At 23:00 nobody starts an activity of their own.
  officeNow: () => new Date(2026, 10, 17, 23),
  rand: (from: number) => from,
  reduceMotion: false,
  replay: { on: false },
}));
vi.mock("../../vendor/my-office/src/office/world/props/aquarium.js", () => ({ AQ: null }));
vi.mock("../../vendor/my-office/src/office/world/props/arcade.js", () => ({ ARC: null }));
vi.mock("../../vendor/my-office/src/office/world/furniture/coffee.js", () => ({
  STEAM_AT: { x: 0, z: 0 },
}));
vi.mock("../../vendor/my-office/src/office/interact/props.js", () => ({
  brewCoffee() {},
  feedFish() {},
}));
vi.mock("../../vendor/my-office/src/office/people/navigation.js", () => ({
  STATIONS: h.stations,
  standBy() {},
  wayTo() {},
}));
vi.mock("../../vendor/my-office/src/office/people/breaks.js", () => ({ COFFEE_Q: [] }));
vi.mock("../../vendor/my-office/src/office/people/workers.js", () => ({
  sessions: h.sessions,
  workers: h.workers,
}));
vi.mock("../../vendor/my-office/src/office/people/errands.js", () => ({
  asleep: () => false,
  quip() {},
}));
vi.mock("../../vendor/my-office/src/office/people/gatherings.js", () => ({
  gatheringNow: () => null,
}));
vi.mock("../../vendor/my-office/src/office/people/billiards.js", () => ({
  bilState: () => ({}),
  billiards: () => false,
}));
vi.mock("../../vendor/my-office/src/office/people/foosball.js", () => ({
  foosState: () => null,
  foosball: () => false,
}));
vi.mock("../../vendor/my-office/src/office/people/gaming.js", () => ({
  tvMatch: () => false,
  tvState: () => ({}),
}));
vi.mock("../../vendor/my-office/src/office/people/karaoke.js", () => ({
  karaoke: () => false,
  ktvState: () => ({}),
}));
vi.mock("../../vendor/my-office/src/i18n/index.js", () => ({ t: (key: string) => key }));

interface Person {
  id: string;
  inStall: object | null;
  wcBusy: boolean;
  station: string;
  want: object | null;
  root: { visible: boolean };
  goHomeAndRest: ReturnType<typeof vi.fn>;
  visitWc(): boolean;
}

/** Someone at their desk, at rest; visitWc() takes them into a stall, door shut. */
function person(id: string): Person {
  const stall = { x: 1, z: 2, by: null as unknown };
  h.stations.wc = [stall];
  const someone = {
    id,
    inStall: null as object | null,
    wcBusy: false,
    station: "desk",
    spot: null as object | null,
    phase: "idle",
    pos: { x: 1, y: 2 },
    root: { visible: true, matrixWorldAutoUpdate: true },
    want: null,
    anim: "sleep",
    after: null,
    chore: null,
    onArrive: null,
    path: [],
    pose: "sit",
    leaving: false,
    hush() {},
    goHomeAndRest: vi.fn(),
    visitWc() {
      Object.assign(someone, { wcBusy: true, station: "wc", spot: stall, inStall: stall });
      Object.assign(someone.root, { visible: false, matrixWorldAutoUpdate: false });
      stall.by = someone;
      return true;
    },
  };
  h.workers.set(id, someone);
  h.sessions.set(id, { id, status: "rest" });
  return someone;
}

/** A prompt came in: the session works, and the person has the work to walk to. */
function prompt(someone: Person) {
  h.sessions.set(someone.id, { id: someone.id, status: "work" });
  someone.want = { station: "desk", anim: "type" };
}

beforeEach(() => {
  h.sessions.clear();
  h.workers.clear();
});

test("a prompt calls someone out of upstream's own restroom visit at once, to the work", () => {
  const someone = person("a");
  someone.visitWc(); // upstream's goHomeAndRest rolled a visit
  prompt(someone);

  updateLeisure();

  expect(someone.inStall).toBeNull();
  expect(someone.wcBusy).toBe(false);
  expect(someone.root.visible).toBe(true);
  // Straight to the work, as upstream's wcTick goes on when someone wants them.
  expect(someone.want).not.toBeNull();
  expect(someone.goHomeAndRest).not.toHaveBeenCalled();
});

test("a question for the user calls someone off the sink at once, to the desk", () => {
  const someone = person("a");
  someone.visitWc();
  Object.assign(someone, { inStall: null, station: "sink" }); // washing hands
  h.sessions.set("a", { id: "a", status: "wait" });

  updateLeisure();

  expect(someone.wcBusy).toBe(false);
  expect(someone.goHomeAndRest).toHaveBeenCalledOnce();
});

test("someone at rest finishes their restroom visit", () => {
  const someone = person("a");
  someone.visitWc();

  updateLeisure();

  expect(someone.inStall).not.toBeNull();
  expect(someone.wcBusy).toBe(true);
  expect(someone.goHomeAndRest).not.toHaveBeenCalled();
});

test("a prompt calls someone out of the lively floor's restroom visit straight to the work", () => {
  const someone = person("a");
  expect(leisureNow("a", "wc")).toEqual(["a"]);
  prompt(someone);

  updateLeisure();

  expect(someone.inStall).toBeNull();
  expect(someone.wcBusy).toBe(false);
  expect(someone.goHomeAndRest).not.toHaveBeenCalled();
});
