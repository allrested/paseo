/**
 * @vitest-environment jsdom
 */
// The Stats screen, mounted as the app mounts a screen: with the plugin's calls and nothing else.
// The scroll view is the host's, so react-native's own stands in.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  PluginRpcProvider,
  type PluginSubscribe,
  type PluginSubscriptionObserver,
} from "@getpaseo/plugin/client/host";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { Hour, Stats } from "../shared/contracts.js";
import { hourOf } from "../shared/hours.js";
import { LOCAL } from "./aggregate.js";
import { dayLabel } from "./format.js";
import { StatsScreen } from "./stats-screen.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView, View } = await import("react-native");
  const { createElement } = await import("react");
  const Icon = ({ name }: { name: string }) => createElement(View, { testID: `icon-${name}` });
  return { Icon, ScrollView };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = Date.parse("2026-11-15T11:20:00Z");

/** The day `back` days ago where the test runs, and an hour in its morning. */
const dayBack = (back: number) => LOCAL.dayOf(LOCAL.dayStart(NOW, back));
const hourBack = (back: number, extra: Partial<Hour> = {}): Hour => ({
  hour: hourOf(LOCAL.dayStart(NOW, back) + 3 * HOUR),
  workspaceId: "w1",
  turns: 1,
  failed: 0,
  workMs: 10 * MINUTE,
  ...extra,
});

const STATS: Stats = {
  hours: [
    hourBack(0, { turns: 30, failed: 2, workMs: 3 * HOUR }),
    hourBack(2, { workspaceId: "w2", turns: 12, workMs: 72 * MINUTE }),
    hourBack(10, { workspaceId: null, turns: 5, workMs: 20 * MINUTE }),
  ],
  workspaces: [
    { id: "w1", name: "Checkout", open: true },
    { id: "w2", name: "old-api", open: false },
    { id: "", name: "No workspace", open: false },
  ],
  countingSince: "2026-01-01T00:00:00.000Z",
};

let answers: Array<Stats | Error>;
let reads: unknown[];
let observers: PluginSubscriptionObserver[];
let opened: unknown[];
let container: HTMLElement;
let root: Root;

const subscribe: PluginSubscribe = (_method, _input, observer) => {
  observers.push(observer);
  const close = () => undefined;
  return Object.assign(close, { ready: Promise.resolve(), release: async () => close() });
};

async function invoke(method: string, input: unknown): Promise<unknown> {
  if (method !== "stats.read.request") throw new Error(`Unexpected call ${method}`);
  reads.push(input);
  // The last answer repeats.
  const answer = answers.length > 1 ? answers.shift() : answers[0];
  if (answer instanceof Error) throw answer;
  return answer;
}

const PROPS = {
  theme: { colors: new Proxy({}, { get: () => "#808080" }) },
  layout: { compact: false, platform: "web" },
  host: { id: "host", label: "Host" },
  params: {},
  navigation: {
    openAgent() {},
    openWorkspace: (input: unknown) => void opened.push(input),
  },
} as unknown as PluginScreenProps;

/** A host that takes the call and does not answer. */
const neverAnswers = () => new Promise<never>(() => {});

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

async function mount(props: PluginScreenProps = PROPS): Promise<void> {
  await act(async () => {
    root.render(
      <PluginRpcProvider invoke={invoke} subscribe={subscribe}>
        <StatsScreen {...props} />
      </PluginRpcProvider>,
    );
  });
  await settle();
}

const buttons = () => [...container.querySelectorAll<HTMLElement>('[role="button"]')];
const button = (label: string) => {
  const found = buttons().find((each) => each.getAttribute("aria-label") === label);
  if (!found) throw new Error(`No button "${label}"`);
  return found;
};
const press = (label: string) => act(async () => button(label).click());
const labelled = (start: string) =>
  [...container.querySelectorAll("[aria-label]")]
    .map((each) => each.getAttribute("aria-label") ?? "")
    .filter((label) => label.startsWith(start));
const headings = () =>
  [...container.querySelectorAll('[role="heading"]')].map((each) => each.textContent);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  answers = [STATS];
  reads = [];
  observers = [];
  opened = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

test("before the host answers, the screen says it is loading", async () => {
  answers = [];
  await act(async () => {
    root.render(
      <PluginRpcProvider invoke={neverAnswers} subscribe={subscribe}>
        <StatsScreen {...PROPS} />
      </PluginRpcProvider>,
    );
  });

  expect(container.textContent).toContain("Loading...");
  expect(buttons().map((each) => each.getAttribute("aria-label"))).toEqual([
    "Last 7 days",
    "Last 30 days",
    "Last 90 days",
  ]);
});

test("the last 7 days are summed into three figures, the days and the workspaces", async () => {
  await mount();

  expect(labelled("Turns")).toEqual(["Turns: 42"]);
  expect(labelled("Agent time")).toEqual(["Agent time: 4 h 12 min"]);
  expect(labelled("Failed turns")).toEqual(["Failed turns: 2"]);
  expect(headings()).toEqual(["Agent time by day", "By workspace"]);
  expect(button("Last 7 days").getAttribute("aria-pressed")).toBe("true");
  // Asked once, from ninety days back.
  expect(reads).toEqual([{ since: hourOf(LOCAL.dayStart(NOW, 89)) }]);
});

test("a longer range is cut from the same answer, without asking the host again", async () => {
  await mount();

  await press("Last 30 days");

  expect(labelled("Turns")).toEqual(["Turns: 47"]);
  expect(labelled("Agent time")).toEqual(["Agent time: 4 h 32 min"]);
  expect(button("Last 30 days").getAttribute("aria-pressed")).toBe("true");
  expect(button("Last 7 days").getAttribute("aria-pressed")).toBe("false");
  expect(reads).toHaveLength(1);
});

test("the chart has a bar slot for every day, and picking one reads its numbers out", async () => {
  await mount();
  const chart = container.querySelector('[data-testid="stats-chart"]');
  expect(chart?.querySelectorAll('[data-testid^="stats-day-"]')).toHaveLength(7);
  expect(chart?.getAttribute("aria-hidden")).toBe("true");
  expect(container.textContent).toContain("Pick a day for its numbers");
  // The scale ends on a round time above the busiest day, and a week names its days.
  expect(chart?.textContent).toContain("3 h");
  expect(chart?.textContent).toContain("0");

  await act(async () => {
    container.querySelector<HTMLElement>(`[data-testid="stats-day-${dayBack(2)}"]`)?.click();
  });

  expect(container.textContent).toContain(`${dayLabel(dayBack(2))} · 1 h 12 min · 12 turns`);
  expect(container.textContent).not.toContain("Pick a day for its numbers");
});

test("a day picked in one range is not carried into another", async () => {
  await mount();
  await act(async () => {
    container.querySelector<HTMLElement>(`[data-testid="stats-day-${dayBack(2)}"]`)?.click();
  });

  await press("Last 30 days");

  expect(container.textContent).toContain("Pick a day for its numbers");
});

test("the days can be read as a table: the days something happened, the newest first", async () => {
  await mount();
  expect(container.querySelector('[data-testid="stats-table"]')).toBeNull();

  await press("Show the days as a table");

  const table = container.querySelector('[data-testid="stats-table"]');
  expect([...(table?.children ?? [])].map((row) => row.textContent)).toEqual([
    `${dayLabel(dayBack(0))}3 h · 30 turns · 2 failed`,
    `${dayLabel(dayBack(2))}1 h 12 min · 12 turns`,
  ]);
  expect(container.querySelector('[data-testid="stats-chart"]')).toBeNull();
  expect(button("Show the days as a table").getAttribute("aria-pressed")).toBe("true");

  await press("Show the days as a table");
  expect(container.querySelector('[data-testid="stats-chart"]')).not.toBeNull();
});

test("the workspaces are ranked by time, and one that still exists opens", async () => {
  await mount();
  await press("Last 30 days");

  expect(labelled("Checkout")).toEqual(["Checkout: 3 h · 30 turns · 2 failed. Open the workspace"]);
  expect(labelled("old-api")).toEqual(["old-api: 1 h 12 min · 12 turns"]);
  expect(labelled("No workspace")).toEqual(["No workspace: 20 min · 5 turns"]);
  const order = [...container.querySelectorAll("[aria-label]")]
    .map((each) => each.getAttribute("aria-label") ?? "")
    .filter((label) => /^(Checkout|old-api|No workspace)/.test(label))
    .map((label) => label.split(":")[0]);
  expect(order).toEqual(["Checkout", "old-api", "No workspace"]);

  await press("Checkout: 3 h · 30 turns · 2 failed. Open the workspace");
  expect(opened).toEqual([{ workspaceId: "w1" }]);
  // A workspace that is gone is a line, not a button.
  expect(buttons().some((each) => each.getAttribute("aria-label")?.startsWith("old-api"))).toBe(
    false,
  );
});

test("a host without navigation lists the workspaces and opens none", async () => {
  await mount({ ...PROPS, navigation: undefined });

  expect(labelled("Checkout")).toEqual(["Checkout: 3 h · 30 turns · 2 failed"]);
  expect(buttons().some((each) => each.getAttribute("aria-label")?.startsWith("Checkout"))).toBe(
    false,
  );
});

test("a range with nothing in it says so", async () => {
  answers = [{ ...STATS, hours: [hourBack(10)] }];
  await mount();

  expect(container.textContent).toContain("No turns in the last 7 days.");
  expect(headings()).toEqual([]);

  await press("Last 30 days");
  expect(labelled("Turns")).toEqual(["Turns: 1"]);
});

test("a host that began to count inside the range says since when", async () => {
  const began = LOCAL.dayStart(NOW, 3) + HOUR;
  answers = [{ ...STATS, countingSince: new Date(began).toISOString() }];
  await mount();

  expect(container.textContent).toContain("Counting since");
  expect(container.textContent).toContain("Turns before that are not known.");
});

test("an empty range says since when the host counts, too", async () => {
  const began = LOCAL.dayStart(NOW, 3) + HOUR;
  answers = [{ hours: [], workspaces: [], countingSince: new Date(began).toISOString() }];
  await mount();

  expect(container.textContent).toContain("No turns in the last 7 days.");
  expect(container.textContent).toContain("Counting since");
});

test("a host that has counted for longer than the range says nothing about it", async () => {
  await mount();

  expect(container.textContent).not.toContain("Counting since");
});

test("a host that cannot answer says why", async () => {
  answers = [new Error("plugin stopped")];
  await mount();

  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Unable to load the stats: plugin stopped",
  );
});

test("a turn that ends while the screen is up is read in", async () => {
  answers = [STATS, { ...STATS, hours: [hourBack(0, { turns: 31, workMs: 3 * HOUR })] }];
  await mount();
  expect(labelled("Turns")).toEqual(["Turns: 42"]);

  await act(async () => observers[0].event({ type: "changed" }));
  await settle();

  expect(labelled("Turns")).toEqual(["Turns: 31"]);
  expect(reads).toHaveLength(2);
});

test("a read that fails after one that worked leaves the numbers on screen", async () => {
  answers = [STATS, new Error("offline")];
  await mount();

  await act(async () => observers[0].event({ type: "changed" }));
  await settle();

  expect(labelled("Turns")).toEqual(["Turns: 42"]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
