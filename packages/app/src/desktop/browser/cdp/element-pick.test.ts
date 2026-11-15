import { describe, expect, test } from "vitest";
import type { CdpBrowserElementSelection } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import { createElementPick, type ElementPickState } from "./element-pick";

const SELECTION: CdpBrowserElementSelection = {
  url: "https://shop.test/cart",
  selector: "#buy",
  tag: "button",
  text: "Buy",
  outerHTML: '<button id="buy">Buy</button>',
  computedStyles: {},
  boundingRect: { x: 0, y: 0, width: 80, height: 32 },
  reactSource: null,
  parentChain: [],
  children: [],
};

interface Pending {
  resolve(selection: CdpBrowserElementSelection | null): void;
  reject(error: Error): void;
}

function setup(cancel: () => void = () => {}) {
  const states: ElementPickState[] = [];
  const failures: string[] = [];
  const picks: Pending[] = [];
  let cancels = 0;
  const pick = createElementPick({
    pick: () => new Promise((resolve, reject) => void picks.push({ resolve, reject })),
    cancel: () => {
      cancels += 1;
      cancel();
    },
    onState: (state) => void states.push(state),
    onFailure: (reason) => void failures.push(reason),
  });
  return { pick, states, failures, picks, cancels: () => cancels };
}

const settle = () => new Promise((done) => setTimeout(done, 0));

describe("createElementPick", () => {
  test("a picked element waits for its note", async () => {
    const { pick, states, picks } = setup();

    pick.start();
    picks[0].resolve(SELECTION);
    await settle();

    expect(states).toEqual([{ status: "picking" }, { status: "annotating", selection: SELECTION }]);
  });

  test("a pick that ended without an element goes back to idle and reports nothing", async () => {
    const { pick, states, failures, picks } = setup();

    pick.start();
    picks[0].resolve(null);
    await settle();

    expect(states).toEqual([{ status: "picking" }, { status: "idle" }]);
    expect(failures).toEqual([]);
  });

  test("stopping a running pick tells the daemon, and its late answer changes nothing", async () => {
    const { pick, states, picks, cancels } = setup();

    pick.start();
    pick.stop();
    picks[0].resolve(SELECTION);
    await settle();

    expect(cancels()).toBe(1);
    expect(states).toEqual([{ status: "picking" }, { status: "idle" }]);
  });

  test("stopping drops a picked element, and tells the daemon nothing: its pick is over", async () => {
    const { pick, states, picks, cancels } = setup();
    pick.start();
    picks[0].resolve(SELECTION);
    await settle();

    pick.stop();

    expect(states.at(-1)).toEqual({ status: "idle" });
    expect(cancels()).toBe(0);
  });

  test("stopping when nothing runs does nothing", () => {
    const { pick, states, cancels } = setup();

    pick.stop();

    expect(states).toEqual([]);
    expect(cancels()).toBe(0);
  });

  test("a cancel that cannot be sent still ends the pick here", () => {
    const { pick, states } = setup(() => {
      throw new Error("Transport not connected");
    });
    pick.start();

    expect(() => pick.stop()).not.toThrow();
    expect(states.at(-1)).toEqual({ status: "idle" });
  });

  test("a page that is still loading, and a pick that could not start, are reported", async () => {
    const { pick, states, failures, picks } = setup();

    pick.start();
    picks[0].reject(new Error("browser_page_loading"));
    await settle();
    pick.start();
    picks[1].reject(new Error("browser_no_host"));
    await settle();

    expect(failures).toEqual(["loading", "failed"]);
    expect(states.at(-1)).toEqual({ status: "idle" });
  });

  test("a pick nobody finished goes off without a report", async () => {
    const { pick, states, failures, picks } = setup();

    pick.start();
    picks[0].reject(new Error("browser_timeout"));
    await settle();

    expect(states).toEqual([{ status: "picking" }, { status: "idle" }]);
    expect(failures).toEqual([]);
  });

  test("a second start replaces the first, whose answer is ignored", async () => {
    const { pick, states, picks } = setup();

    pick.start();
    pick.start();
    picks[0].resolve(null);
    await settle();
    expect(states.at(-1)).toEqual({ status: "picking" });

    picks[1].resolve(SELECTION);
    await settle();
    expect(states.at(-1)).toEqual({ status: "annotating", selection: SELECTION });
  });
});
