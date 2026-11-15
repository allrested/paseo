/**
 * @vitest-environment jsdom
 */
// The Feed screen, mounted as the app mounts a screen: with the plugin's calls and nothing else.
// The app gives a screen no view of its agents, so a hook that reads them throws here as it does
// there. The scroll view and the field are the host's, so react-native's own stand in.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  PluginRpcProvider,
  type PluginSubscribe,
  type PluginSubscriptionObserver,
} from "@getpaseo/plugin/client/host";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { FeedEntry, FeedEvent, RunningAgent } from "../shared/contracts.js";
import { FeedScreen } from "./feed-screen.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView, TextInput, View } = await import("react-native");
  const { createElement } = await import("react");
  const Icon = ({ name }: { name: string }) => createElement(View, { testID: `icon-${name}` });
  return { Icon, ScrollView, TextInput };
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

const running = (id: string, extra: Partial<RunningAgent> = {}): RunningAgent => ({
  agentId: id,
  title: `Agent ${id}`,
  folder: "/work/shop",
  since: "2026-11-15T11:57:00.000Z",
  ...extra,
});

let observers: PluginSubscriptionObserver[];
let seenCalls: Array<{ resolve(): void; reject(error: Error): void }>;
/** The marks asked of the host, and whether the host takes them. */
let marks: unknown[];
let marking: boolean;
let opened: unknown[];
let container: HTMLElement;
let root: Root;

const subscribe: PluginSubscribe = (_method, _input, observer) => {
  observers.push(observer);
  const close = () => undefined;
  return Object.assign(close, { ready: Promise.resolve(), release: async () => close() });
};

function invoke(method: string, input: unknown): Promise<unknown> {
  if (method === "feed.unread.request") {
    marks.push(input);
    return marking ? Promise.resolve({}) : Promise.reject(new Error("offline"));
  }
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
const buttons = () => [...container.querySelectorAll<HTMLElement>('[role="button"]')];
const named = (end: string) =>
  buttons().filter((each) => each.getAttribute("aria-label")?.endsWith(end));
/** The rows that open an agent; a row's mark button is a button too. */
const rows = () => named("Open the agent");
const button = (label: string) => {
  const found = buttons().find((each) => each.getAttribute("aria-label") === label);
  if (!found) throw new Error(`No button "${label}"`);
  return found;
};
const press = (label: string) => act(async () => button(label).click());
const filter = () => container.querySelector<HTMLInputElement>('[aria-label="Filter the feed"]');

async function type(value: string): Promise<void> {
  const element = filter();
  if (!element) throw new Error("No filter field");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  observers = [];
  seenCalls = [];
  marks = [];
  marking = true;
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

test("entries since the feed was last opened are under Unread, the rest under Earlier", async () => {
  await mount();
  await send({ type: "state", state: { entries: [FRESH, OLD], seenAt: SEEN } });

  expect(sectionNames()).toEqual(["Unread", "Earlier"]);
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

test("opening the feed tells the host once, and what was new stays under Unread", async () => {
  await mount();
  await send({ type: "state", state: { entries: [FRESH, OLD], seenAt: SEEN } });
  expect(seenCalls).toHaveLength(1);

  await act(async () => seenCalls[0].resolve());
  await send({ type: "seen", seenAt: NOW });

  expect(sectionNames()).toEqual(["Unread", "Earlier"]);
  expect(seenCalls).toHaveLength(1);
});

test("an entry that comes while the feed is up is new until the feed is pressed", async () => {
  await mount();
  await send({ type: "state", state: { entries: [OLD], seenAt: SEEN } });
  await send({ type: "added", entry: entry("late", "2026-11-15T11:59:00.000Z") });
  expect(sectionNames()).toEqual(["Unread", "Earlier"]);
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
  // It can still be marked.
  expect(named(": Agent old")).toHaveLength(1);
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
  expect(buttons()).toHaveLength(0);
});

test("an entry is marked unread from its row, and the host is told which", async () => {
  await mount();
  await send({ type: "state", state: { entries: [OLD], seenAt: SEEN } });
  expect(button("Mark unread: Agent old").getAttribute("aria-pressed")).toBe("false");

  await press("Mark unread: Agent old");

  expect(marks).toEqual([{ id: "old", unread: true }]);
  // The row moves when the host says so, not before.
  expect(sectionNames()).toEqual([]);
  await send({ type: "marked", id: "old", unread: true });
  expect(sectionNames()).toEqual(["Unread"]);
  expect(button("Mark read: Agent old").getAttribute("aria-pressed")).toBe("true");
});

test("a marked entry stays unread when the feed is opened again, until it is marked read", async () => {
  await mount();
  await send({ type: "state", state: { entries: [OLD], seenAt: NOW, unread: ["old"] } });
  expect(sectionNames()).toEqual(["Unread"]);

  await press("Mark read: Agent old");
  expect(marks).toEqual([{ id: "old", unread: false }]);
  await send({ type: "marked", id: "old", unread: false });

  expect(sectionNames()).toEqual([]);
  expect(rows()).toHaveLength(1);
});

test("opening a marked entry's agent reads the entry; opening another marks nothing", async () => {
  await mount();
  await send({ type: "state", state: { entries: [FRESH, OLD], seenAt: NOW, unread: ["old"] } });

  await act(async () => rows()[0].click());
  await act(async () => rows()[1].click());

  expect(opened).toEqual([{ agentId: "agent-old" }, { agentId: "agent-fresh" }]);
  expect(marks).toEqual([{ id: "old", unread: false }]);
});

test("a mark the host does not take leaves the row as it was", async () => {
  marking = false;
  await mount();
  await send({ type: "state", state: { entries: [OLD], seenAt: SEEN } });

  await press("Mark unread: Agent old");
  await settle();

  expect(marks).toHaveLength(1);
  expect(button("Mark unread: Agent old")).toBeDefined();
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

test("the agents in a turn are listed first, in the host's order", async () => {
  await mount();
  await send({
    type: "state",
    state: {
      entries: [OLD],
      seenAt: SEEN,
      running: [
        running("busy", { title: null }),
        running("slow", { folder: "/work/api", since: "2026-11-15T11:00:00.000Z" }),
        // Its turn began before the feed listened.
        running("found", { since: null }),
      ],
    },
  });

  expect(sectionNames()).toEqual(["Running", "Earlier"]);
  const listed = rows().slice(0, 3);
  expect(listed.map((row) => row.textContent)).toEqual([
    "Untitled agentRunning · shop · started 3 min ago",
    "Agent slowRunning · api · started 1 h ago",
    "Agent foundRunning · shop",
  ]);
  expect(listed[0].getAttribute("aria-label")).toBe("Running: Untitled agent. Open the agent");

  await act(async () => listed[1].click());
  expect(opened).toEqual([{ agentId: "slow" }]);
});

test("an agent joins the list when its turn starts and leaves it when the turn ends", async () => {
  await mount();
  await send({ type: "state", state: { entries: [OLD], seenAt: SEEN } });
  expect(sectionNames()).toEqual([]);

  await send({ type: "started", agent: running("busy") });
  expect(sectionNames()).toEqual(["Running", "Earlier"]);

  await send({ type: "stopped", agentId: "busy" });
  expect(sectionNames()).toEqual([]);
});

test("a running agent on a host without navigation is listed and opens nothing", async () => {
  await mount({ ...PROPS, navigation: undefined });
  await send({ type: "state", state: { entries: [], seenAt: null, running: [running("busy")] } });

  expect(sectionNames()).toEqual(["Running"]);
  expect(buttons()).toHaveLength(0);
  expect(container.textContent).toContain("Agent busyRunning · shop · started 3 min ago");
});

test("a feed with no entries still lists what runs, and says nothing is yet in it only when nothing does", async () => {
  await mount();
  await send({ type: "state", state: { entries: [], seenAt: null, running: [running("busy")] } });

  expect(sectionNames()).toEqual(["Running"]);
  expect(container.textContent).not.toContain("Nothing yet.");
  expect(filter()).not.toBeNull();

  await send({ type: "stopped", agentId: "busy" });
  expect(container.textContent).toContain("Nothing yet.");
  expect(filter()).toBeNull();
});

test("the filter narrows the entries and the running agents by any of their words", async () => {
  await mount();
  await send({
    type: "state",
    state: {
      entries: [FRESH, OLD],
      seenAt: SEEN,
      running: [running("busy", { title: "Checkout total", folder: "/work/api" })],
    },
  });
  expect(rows()).toHaveLength(3);

  // What happened is a word too.
  await type("failed");
  expect(rows().map((row) => row.getAttribute("aria-label"))).toEqual([
    "Failed: Agent fresh. Open the agent",
  ]);
  expect(sectionNames()).toEqual(["Unread"]);

  // Every word has to be found; the folder and the entry's line count.
  await type("  SHOP said ");
  expect(rows().map((row) => row.getAttribute("aria-label"))).toEqual([
    "Finished: Agent old. Open the agent",
  ]);

  await type("checkout api");
  expect(sectionNames()).toEqual(["Running"]);
  expect(rows()).toHaveLength(1);

  await type("running");
  expect(rows()).toHaveLength(1);
});

test("a filter that finds nothing says so, and clearing it brings everything back", async () => {
  await mount();
  await send({ type: "state", state: { entries: [FRESH, OLD], seenAt: SEEN } });

  await type("zzz");
  expect(rows()).toHaveLength(0);
  expect(container.textContent).toContain('Nothing matches "zzz"');
  expect(sectionNames()).toEqual([]);

  await type("");
  expect(rows()).toHaveLength(2);
  expect(container.textContent).not.toContain("Nothing matches");
});
