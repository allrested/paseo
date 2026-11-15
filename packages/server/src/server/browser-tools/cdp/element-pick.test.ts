import { describe, expect, test } from "vitest";
import { CdpTimeoutError } from "./cdp-connection.js";
import { pickElement, readSelection, type PickTab } from "./element-pick.js";

const SELECTION = {
  url: "https://example.com/cart",
  selector: "#buy",
  tag: "button",
  text: "Buy",
  outerHTML: '<button id="buy">Buy</button>',
  computedStyles: { display: "inline-block", color: "rgb(0, 0, 0)" },
  boundingRect: { x: 10, y: 20, width: 80, height: 32 },
  reactSource: null,
  parentChain: ["form#order", "main"],
  children: [],
};
const PICKED = JSON.stringify({ ...SELECTION, __paseoSessionToken: "t1" });

type Step = () => unknown;

/** A tab whose page gives the scripted answers in order, then says it still waits. */
function fakeTab(answers: { install?: Step; polls?: Step[] } = {}) {
  const calls: string[] = [];
  const polls = [...(answers.polls ?? [])];
  const state = { loading: false, destroyed: false };
  const tab: PickTab = {
    isLoading: () => state.loading,
    isDestroyed: () => state.destroyed,
    async executeJavaScript(code) {
      if (code.includes("__paseo-select-mode")) {
        calls.push("install");
        return answers.install ? answers.install() : { installed: true, sessionToken: "t1" };
      }
      if (code.includes("__cancelled")) {
        calls.push("poll");
        return polls.shift()?.() ?? null;
      }
      calls.push("clear");
      return undefined;
    },
  };
  return { tab, calls, state };
}

const pick = (tab: PickTab, extra: Partial<Parameters<typeof pickElement>[0]> = {}) =>
  pickElement({ tab, token: "t1", signal: new AbortController().signal, pollMs: 1, ...extra });

describe("pickElement", () => {
  test("answers with the element the page reports, once it reports one", async () => {
    const { tab, calls } = fakeTab({ polls: [() => null, () => null, () => PICKED] });

    expect(await pick(tab)).toEqual({ kind: "picked", selection: SELECTION });
    // The page ended its own picker with the click: nothing is left to clear.
    expect(calls).toEqual(["install", "poll", "poll", "poll"]);
  });

  test("ends without an element when the page says the pick was cancelled or is gone", async () => {
    const { tab, calls } = fakeTab({ polls: [() => JSON.stringify({ __cancelled: true })] });

    expect(await pick(tab)).toEqual({ kind: "cancelled" });
    expect(calls).toEqual(["install", "poll"]);
  });

  test("a page that is still loading is not made a picker", async () => {
    const loading = fakeTab();
    loading.state.loading = true;
    expect(await pick(loading.tab)).toEqual({ kind: "failed", error: "browser_page_loading" });
    expect(loading.calls).toEqual([]);

    const noDocument = fakeTab({
      install: () => ({ installed: false, reason: "document-loading", sessionToken: "t1" }),
    });
    expect(await pick(noDocument.tab)).toEqual({ kind: "failed", error: "browser_page_loading" });
    expect(noDocument.calls).toEqual(["install"]);
  });

  test("an install the page does not confirm fails the pick", async () => {
    const silent = fakeTab({ install: () => undefined });
    expect(await pick(silent.tab)).toEqual({ kind: "failed", error: "browser_unknown_error" });

    const other = fakeTab({ install: () => ({ installed: true, sessionToken: "someone-else" }) });
    expect(await pick(other.tab)).toEqual({ kind: "failed", error: "browser_unknown_error" });
  });

  test("an install that times out fails the pick with the timeout", async () => {
    const { tab } = fakeTab({
      install: () => {
        throw new CdpTimeoutError("Runtime.evaluate", 10_000);
      },
    });

    expect(await pick(tab)).toEqual({ kind: "failed", error: "browser_timeout" });
  });

  test("a cancel ends the pick and takes the picker off the page", async () => {
    const controller = new AbortController();
    const { tab, calls } = fakeTab({
      polls: [
        () => {
          controller.abort();
          return null;
        },
      ],
    });

    expect(await pick(tab, { signal: controller.signal, pollMs: 60_000 })).toEqual({
      kind: "cancelled",
    });
    expect(calls).toEqual(["install", "poll", "clear"]);
  });

  test("a pick already cancelled never touches the page", async () => {
    const controller = new AbortController();
    controller.abort();
    const { tab, calls } = fakeTab();

    expect(await pick(tab, { signal: controller.signal })).toEqual({ kind: "cancelled" });
    expect(calls).toEqual([]);
  });

  test("a pick nobody finishes times out and takes the picker off the page", async () => {
    let clock = 1000;
    const { tab, calls } = fakeTab({
      polls: [
        () => {
          clock += 30_000;
          return null;
        },
      ],
    });

    expect(await pick(tab, { now: () => clock })).toEqual({
      kind: "failed",
      error: "browser_timeout",
    });
    expect(calls).toEqual(["install", "poll", "clear"]);
  });

  test("a poll that throws is asked again: the page may be between two documents", async () => {
    const { tab, calls } = fakeTab({
      polls: [
        () => {
          throw new Error("Execution context was destroyed");
        },
        () => JSON.stringify({ __cancelled: true }),
      ],
    });

    expect(await pick(tab)).toEqual({ kind: "cancelled" });
    expect(calls).toEqual(["install", "poll", "poll"]);
  });

  test("a tab that closed ends the pick as not found", async () => {
    const { tab, state } = fakeTab({
      polls: [
        () => {
          state.destroyed = true;
          return null;
        },
      ],
    });

    expect(await pick(tab)).toEqual({ kind: "failed", error: "browser_tab_not_found" });
  });

  test("an answer that is no element fails the pick and takes the picker off", async () => {
    const garbage = fakeTab({ polls: [() => "{ not json"] });
    expect(await pick(garbage.tab)).toEqual({ kind: "failed", error: "browser_unknown_error" });
    expect(garbage.calls).toEqual(["install", "poll", "clear"]);

    const noTag = fakeTab({ polls: [() => JSON.stringify({ selector: "#buy" })] });
    expect(await pick(noTag.tab)).toEqual({ kind: "failed", error: "browser_unknown_error" });
  });
});

describe("readSelection", () => {
  test("keeps what the picker's script reports and drops what it does not", () => {
    expect(
      readSelection({ ...SELECTION, __paseoSessionToken: "t1", attributes: { id: "buy" } }),
    ).toEqual(SELECTION);
  });

  test("cuts every string and list a page sends to its bound", () => {
    const long = "x".repeat(5000);
    const selection = readSelection({
      url: long,
      selector: long,
      tag: long,
      text: long,
      outerHTML: long,
      computedStyles: Object.fromEntries(
        Array.from({ length: 60 }, (_, index) => [`p${index}${long}`, long]),
      ),
      boundingRect: { x: 1, y: 2, width: 3, height: 4 },
      reactSource: { fileName: long, lineNumber: 3, columnNumber: 9, componentName: long },
      parentChain: Array.from({ length: 40 }, () => long),
      children: Array.from({ length: 40 }, () => long),
    });

    expect(selection?.url).toHaveLength(2048);
    expect(selection?.selector).toHaveLength(1024);
    expect(selection?.tag).toHaveLength(64);
    expect(selection?.text).toHaveLength(500);
    expect(selection?.outerHTML).toHaveLength(2000);
    const styles = Object.entries(selection?.computedStyles ?? {});
    expect(styles).toHaveLength(24);
    expect(styles[0][0]).toHaveLength(64);
    expect(styles[0][1]).toHaveLength(256);
    expect(selection?.reactSource?.fileName).toHaveLength(1024);
    expect(selection?.reactSource?.componentName).toHaveLength(256);
    expect(selection?.parentChain).toHaveLength(8);
    expect(selection?.parentChain[0]).toHaveLength(256);
    expect(selection?.children).toHaveLength(12);
  });

  test("replaces values of the wrong kind, and refuses an answer without a tag", () => {
    expect(
      readSelection({
        tag: "div",
        url: 7,
        selector: null,
        text: ["a"],
        outerHTML: {},
        computedStyles: { display: 3, color: "red" },
        boundingRect: { x: "1", y: Number.NaN, width: Infinity },
        reactSource: { fileName: 5, lineNumber: "3" },
        parentChain: "main",
        children: ["a", 2, "b"],
      }),
    ).toEqual({
      tag: "div",
      url: "",
      selector: "",
      text: "",
      outerHTML: "",
      computedStyles: { color: "red" },
      boundingRect: { x: 0, y: 0, width: 0, height: 0 },
      reactSource: { fileName: null, lineNumber: null, columnNumber: null, componentName: null },
      parentChain: [],
      children: ["a", "b"],
    });
    expect(readSelection({ selector: "#buy" })).toBeNull();
    expect(readSelection("button")).toBeNull();
    expect(readSelection(null)).toBeNull();
    expect(readSelection([SELECTION])).toBeNull();
  });
});
