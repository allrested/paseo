/**
 * @vitest-environment jsdom
 */
// The Feed screen, mounted. The scroll view is the host's, so react-native's own stands in; the
// subscription and the seen call are the test's.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  PluginRpcProvider,
  type PluginSubscribe,
  type PluginSubscriptionObserver,
} from "@getpaseo/plugin/client/host";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { FeedEntry, FeedEvent } from "../shared/contracts.js";
import { FeedScreen } from "./feed-screen.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView, View } = await import("react-native");
  const { createElement } = await import("react");
  const Icon = ({ name }: { name: string }) => createElement(View, { testID: `icon-${name}` });
  return { Icon, ScrollView };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const NOW = "2026-11-15T12:00:00.000Z";
const SEEN = "2026-11-15T10:00:00.000Z";

const entry = (id: string, at: string, extra: Partial<FeedEntry> = {}): FeedEntry => ({
  id,
  at,
  kind: "finished",
  agentId: `agent-${id}`,
  title: `Agent ${id}`,
  folder: "/work/shop",
  text: `Said by ${id}`,
  ...extra,
});

const FRESH = entry("fresh", "2026-11-15T11:18:00.000Z", {
  kind: "failed",
  text: "Rate limit reached",
});
const OLD = entry("old", "2026-11-15T07:00:00.000Z");

let observers: PluginSubscriptionObserver[];
let seenCalls: Array<{ resolve(): void; reject(error: Error): void }>;
let opened: unknown[];
let container: HTMLElement;
let root: Root;

const subscribe: PluginSubscribe = (_method, _input, observer) => {
  observers.push(observer);
  const close = () => undefined;
  return Object.assign(close, { ready: Promise.resolve(), release: async () => close() });
};

function invoke(method: string): Promise<unknown> {
  if (method !== "feed.seen.request") throw new Error(`Unexpected call ${method}`);
  return new Promise((resolve, reject) => {
    seenCalls.push({ resolve: () => resolve({ seenAt: NOW }), reject });
  });
}

const PROPS = {
  theme: { colors: new Proxy({}, { get: () => "#808080" }) },
  layout: { compact: true, platform: "web" },
  host: { id: "host", label: "Host" },
  params: {},
  navigation: { openAgent: (input: unknown) => void opened.push(input), openWorkspace() {} },
} as unknown as PluginScreenProps;

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

async function mount(props: PluginScreenProps = PROPS): Promise<void> {
  await act(async () => {
    root.render(
      <PluginRpcProvider invoke={invoke} subscribe={subscribe}>
        <FeedScreen {...props} />
      </PluginRpcProvider>,
    );
  });
  await settle();
}

async function send(event: FeedEvent): Promise<void> {
  await act(async () => observers[0].event(event));
}

const sectionNames = () =>
  [...container.querySelectorAll('[role="heading"]')].map((heading) => heading.textContent);
const rows = () => [...container.querySelectorAll('[role="button"]')];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  observers = [];
  seenCalls = [];
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
  await mount();

  expect(container.textContent).toBe("Loading...");
  expect(seenCalls).toHaveLength(0);
});

test("a feed with nothing in it says what will show up, and asks the host nothing", async () => {
  await mount();
  await send({ type: "state", state: { entries: [], seenAt: null } });

  expect(container.textContent).toContain("Nothing yet.");
  expect(seenCalls).toHaveLength(0);
});

test("entries since the feed was last opened are under New, the rest under Earlier", async () => {
  await mount();
  await send({ type: "state", state: { entries: [FRESH, OLD], seenAt: SEEN } });

  expect(sectionNames()).toEqual(["New", "Earlier"]);
  const [fresh, old] = rows();
  expect(fresh.textContent).toBe("Agent freshFailed · shop · 42 min agoRate limit reached");
  expect(fresh.getAttribute("aria-label")).toBe("Failed: Agent fresh. Open the agent");
  expect(old.textContent).toBe("Agent oldFinished · shop · 5 h agoSaid by old");
});

test("a feed with nothing new is one list without a name", async () => {
  await mount();
  await send({ type: "state", state: { entries: [OLD], seenAt: SEEN } });

  expect(sectionNames()).toEqual([]);
  expect(rows()).toHaveLength(1);
  expect(seenCalls).toHaveLength(0);
});

test("opening the feed tells the host once, and what was new stays under New", async () => {
  await mount();
  await send({ type: "state", state: { entries: [FRESH, OLD], seenAt: SEEN } });
  expect(seenCalls).toHaveLength(1);

  await act(async () => seenCalls[0].resolve());
  await send({ type: "seen", seenAt: NOW });

  expect(sectionNames()).toEqual(["New", "Earlier"]);
  expect(seenCalls).toHaveLength(1);
});

test("an entry that comes while the feed is up is new until the feed is pressed", async () => {
  await mount();
  await send({ type: "state", state: { entries: [OLD], seenAt: SEEN } });
  await send({ type: "added", entry: entry("late", "2026-11-15T11:59:00.000Z") });
  expect(sectionNames()).toEqual(["New", "Earlier"]);
  expect(seenCalls).toHaveLength(0);

  await act(async () => {
    rows()[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  });

  expect(seenCalls).toHaveLength(1);
});

test("a seen call that fails is asked again at the next press", async () => {
  await mount();
  await send({ type: "state", state: { entries: [FRESH], seenAt: SEEN } });
  await act(async () => seenCalls[0].reject(new Error("offline")));

  await act(async () => {
    rows()[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  });

  expect(seenCalls).toHaveLength(2);
});

test("pressing a row opens its agent", async () => {
  await mount();
  await send({ type: "state", state: { entries: [FRESH, OLD], seenAt: SEEN } });

  await act(async () => (rows()[1] as HTMLElement).click());

  expect(opened).toEqual([{ agentId: "agent-old" }]);
});

test("a host without navigation lists the entries and opens nothing", async () => {
  await mount({ ...PROPS, navigation: undefined });
  await send({ type: "state", state: { entries: [OLD], seenAt: SEEN } });

  expect(rows()).toHaveLength(0);
  expect(container.textContent).toContain("Agent old");
  expect(container.querySelector('[data-testid="icon-ChevronRight"]')).toBeNull();
});

test("an agent without a title and a turn without words still make a row", async () => {
  await mount();
  await send({
    type: "state",
    state: {
      entries: [entry("bare", "2026-11-15T11:59:50.000Z", { title: null, text: null })],
      seenAt: SEEN,
    },
  });

  expect(rows()[0].textContent).toBe("Untitled agentFinished · shop · just now");
});

test("a feed the host cannot serve says so", async () => {
  await mount();
  await act(async () => observers[0].closed(new Error("plugin stopped")));

  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Unable to load the feed: plugin stopped",
  );
});

test("a feed the host closed says to reopen it", async () => {
  await mount();
  await send({ type: "state", state: { entries: [OLD], seenAt: SEEN } });
  await act(async () => observers[0].closed());

  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Reopen the feed");
  expect(rows()).toHaveLength(0);
});
