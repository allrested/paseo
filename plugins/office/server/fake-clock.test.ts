import { expect, test } from "vitest";
import { createFakeClock } from "./fake-clock.js";

test("runs due timers in time order and moves now to each", () => {
  const clock = createFakeClock(1000);
  const ran: string[] = [];
  clock.setTimeout(() => ran.push(`b@${clock.now()}`), 20);
  clock.setTimeout(() => ran.push(`a@${clock.now()}`), 10);
  const cancel = clock.setTimeout(() => ran.push("never"), 15);
  cancel();
  clock.advance(15);
  expect(ran).toEqual(["a@1010"]);
  expect(clock.now()).toBe(1015);
  clock.advance(5);
  expect(ran).toEqual(["a@1010", "b@1020"]);
  expect(clock.pending()).toBe(0);
});

test("a timer scheduled by a running timer runs in the same advance when due", () => {
  const clock = createFakeClock();
  const ran: number[] = [];
  clock.setTimeout(() => {
    ran.push(clock.now());
    clock.setTimeout(() => ran.push(clock.now()), 5);
  }, 5);
  clock.advance(10);
  expect(ran).toEqual([5, 10]);
});
