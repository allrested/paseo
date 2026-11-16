import { expect, test } from "vitest";
import {
  KINDS,
  LEISURE,
  PAIR,
  called,
  createPlan,
  daytime,
} from "../../vendor/my-office/src/office/paseo-leisure-plan.js";

const ALL = Object.fromEntries(KINDS.map((kind) => [kind, true]));
const only = (...kinds: string[]) =>
  Object.fromEntries(KINDS.map((kind) => [kind, kinds.includes(kind)]));
const agent = (id: string, patch = {}) => ({ id, resting: true, idle: true, ...patch });
/** A plan whose random numbers are these, in turn; the last one repeats. */
function planWith(...numbers: number[]) {
  let next = 0;
  return createPlan(() => {
    const value = numbers[Math.min(next, numbers.length - 1)] ?? 0;
    next += 1;
    return value;
  });
}
/** What step() is asked at second `now` of a morning with one agent asleep at its desk. */
const at = (now: number, patch = {}) => ({
  now,
  wall: now * 1000,
  hour: 10,
  quiet: false,
  agents: [agent("a")],
  open: ALL,
  ...patch,
});

test("daytime is 08:00 to 21:00", () => {
  expect([7, 8, 12, 20, 21, 23, 0].map(daytime)).toEqual([
    false,
    true,
    true,
    true,
    false,
    false,
    false,
  ]);
  expect(LEISURE.gap).toEqual([30, 90]);
  expect(LEISURE.longRest).toBe(7200);
  expect(LEISURE.longGap).toEqual([600, 1200]);
  expect(LEISURE.nap).toEqual([180, 360]);
  expect(LEISURE.arcade).toEqual([60, 180]);
  expect(LEISURE.cup).toEqual([120, 240]);
});

test("someone asleep at the desk gets up after a gap of 30 to 90 seconds", () => {
  const short = planWith(0);
  expect(short.step(at(0))).toBeNull();
  expect(short.step(at(29))).toBeNull();
  // Alone, so no game for two: the first of what is left.
  expect(short.step(at(30))).toEqual({ id: "a", kind: "karaoke" });

  const long = planWith(1, 0);
  expect(long.step(at(0))).toBeNull();
  expect(long.step(at(89))).toBeNull();
  expect(long.step(at(90))).toEqual({ id: "a", kind: "karaoke" });
});

test("a new gap starts when the agent is back at its desk", () => {
  const plan = planWith(0);
  plan.step(at(0));
  expect(plan.step(at(30))).toEqual({ id: "a", kind: "karaoke" });
  plan.started(["a"], "karaoke");
  expect(plan.step(at(200, { agents: [agent("a", { idle: false })] }))).toBeNull();
  // Back and asleep at 300: due at 330.
  expect(plan.step(at(300))).toBeNull();
  expect(plan.step(at(329))).toBeNull();
  expect(plan.step(at(330))).not.toBeNull();
});

test("after two hours of rest the gap is 10 to 20 minutes", () => {
  const plan = planWith(0);
  plan.step(at(0));
  plan.started(["a"], "fish");
  plan.step(at(7190, { agents: [agent("a", { idle: false })] }));
  plan.step(at(7200));
  expect(plan.of("a")?.nextAt).toBe(7200 + 600);

  const slow = planWith(1);
  slow.step(at(0));
  slow.started(["a"], "fish");
  slow.step(at(7190, { agents: [agent("a", { idle: false })] }));
  slow.step(at(7200));
  expect(slow.of("a")?.nextAt).toBe(7200 + 1200);
});

test("the activity is one of what is possible now, and never the agent's last", () => {
  const plan = planWith(0);
  plan.step(at(0, { open: only("fish", "arcade") }));
  expect(plan.step(at(30, { open: only("fish", "arcade") }))).toEqual({ id: "a", kind: "fish" });
  plan.started(["a"], "fish");
  plan.step(at(100, { agents: [agent("a", { idle: false })], open: only("fish", "arcade") }));
  plan.step(at(200, { open: only("fish", "arcade") }));
  // The first of the list again by the dice, but fish was the last: the arcade.
  expect(plan.step(at(230, { open: only("fish", "arcade") }))).toEqual({
    id: "a",
    kind: "arcade",
  });
  plan.started(["a"], "arcade");
  plan.step(at(300, { agents: [agent("a", { idle: false })] }));
  plan.step(at(400, { open: only("arcade") }));
  // Nothing but its last activity is possible: it stays, and asks again a gap later.
  expect(plan.step(at(430, { open: only("arcade") }))).toBeNull();
  expect(plan.of("a")?.nextAt).toBe(460);
});

test("a game for two needs a second agent asleep at a desk", () => {
  const pair = only(...PAIR);
  const alone = planWith(0);
  alone.step(at(0, { open: pair }));
  expect(alone.step(at(30, { open: pair }))).toBeNull();

  const two = planWith(0);
  const both = { agents: [agent("a"), agent("b")], open: ALL };
  two.step(at(0, both));
  expect(two.step(at(30, both))).toEqual({ id: "a", kind: "pool" });
  // A second agent who is away from its desk does not count.
  const away = planWith(0);
  const one = { agents: [agent("a"), agent("b", { idle: false })], open: pair };
  away.step(at(0, one));
  expect(away.step(at(30, one))).toBeNull();
});

test("a game picks its own players: they are the ones who went", () => {
  const plan = planWith(0);
  const three = { agents: [agent("a"), agent("b"), agent("c")], open: ALL };
  plan.step(at(0, three));
  expect(plan.step(at(30, three))?.kind).toBe("pool");
  plan.started(["b", "c"], "pool");
  expect(plan.of("b")?.last).toBe("pool");
  expect(plan.of("c")?.idle).toBe(false);
  expect(plan.of("a")?.last).toBeNull();
  // The one whose gap was over is asked again; the table is taken now.
  const taken = {
    agents: [agent("a"), agent("b", { idle: false }), agent("c", { idle: false })],
    open: { ...ALL, pool: false },
  };
  expect(plan.step(at(31, taken))).toEqual({ id: "a", kind: "karaoke" });
});

test("an activity that could not start is asked again a gap later", () => {
  const plan = planWith(0);
  plan.step(at(0));
  expect(plan.step(at(30))).not.toBeNull();
  plan.declined("a", 30, 30_000);
  expect(plan.step(at(59))).toBeNull();
  expect(plan.step(at(60))).not.toBeNull();
});

test("nothing starts at night, in a gathering or with motion reduced", () => {
  for (const patch of [{ hour: 21 }, { hour: 7 }, { quiet: true }]) {
    const plan = planWith(0);
    plan.step(at(0, patch));
    expect(plan.step(at(30, patch))).toBeNull();
    // The gap starts over, so the floor does not get up as one when it may again.
    expect(plan.of("a")?.nextAt).toBe(60);
    expect(plan.step(at(59))).toBeNull();
    expect(plan.step(at(60))).toEqual({ id: "a", kind: "karaoke" });
  }
});

test("an agent at work is not asked, and its rest starts over when it rests again", () => {
  const plan = planWith(0);
  const working = { agents: [agent("a", { resting: false, idle: false })] };
  plan.step(at(0));
  expect(plan.step(at(30, working))).toBeNull();
  expect(plan.of("a")?.restFrom).toBeNull();
  // Two hours later it rests again: a short gap, not the long one.
  plan.step(at(7300));
  expect(plan.of("a")?.restFrom).toBe(7_300_000);
  expect(plan.of("a")?.nextAt).toBe(7330);
});

test("work calls someone away from an activity", () => {
  const free = { want: null };
  expect(called({ status: "rest" }, free)).toBe(false);
  expect(called({ status: "work" }, free)).toBe(true);
  expect(called({ status: "wait" }, free)).toBe(true);
  expect(called({ status: "rest", bg: [{ desc: "a server" }] }, free)).toBe(true);
  expect(called({ status: "rest" }, { want: { type: "prompt" } })).toBe(true);
  expect(called(undefined, free)).toBe(true);
});

test("an agent that left the office is forgotten", () => {
  const plan = planWith(0);
  plan.step(at(0));
  expect(plan.of("a")).toBeDefined();
  plan.step(at(1, { agents: [] }));
  expect(plan.of("a")).toBeUndefined();
});
