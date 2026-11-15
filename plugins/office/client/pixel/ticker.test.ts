import { describe, expect, it } from "vitest";
import { createTicker, type TickerTimers } from "./ticker.js";

function fakeTimers() {
  let run: (() => void) | null = null;
  const timers: TickerTimers = {
    set: (callback) => {
      run = callback;
      return 1;
    },
    clear: () => {
      run = null;
    },
  };
  return { timers, running: () => run !== null, tick: () => run?.() };
}

describe("createTicker", () => {
  it("counts only while somebody listens", () => {
    const clock = fakeTimers();
    const ticker = createTicker(250, clock.timers);
    expect(clock.running()).toBe(false);
    let heard = 0;
    const stopFirst = ticker.subscribe(() => {
      heard += 1;
    });
    const stopSecond = ticker.subscribe(() => undefined);
    clock.tick();
    clock.tick();
    expect(ticker.frame()).toBe(2);
    expect(heard).toBe(2);
    stopFirst();
    expect(clock.running()).toBe(true);
    stopSecond();
    expect(clock.running()).toBe(false);
  });

  it("starts again for a new listener and keeps its count", () => {
    const clock = fakeTimers();
    const ticker = createTicker(250, clock.timers);
    ticker.subscribe(() => undefined)();
    const stop = ticker.subscribe(() => undefined);
    clock.tick();
    expect(ticker.frame()).toBe(1);
    stop();
    stop();
    expect(clock.running()).toBe(false);
  });
});
