/**
 * @vitest-environment jsdom
 */
// The Activity panel, mounted as the office's column mounts it: the feed's store is filled
// directly, and the surface's state arrives as a prop.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeAgent, OfficeSnapshot } from "../shared/contracts.js";
import { ActivityPanel } from "./activity-panel.js";
import { feedStore, type FeedEvent, type FeedKind } from "./activity-feed.js";
import { FEED_EMPTY, FEED_NO_MATCH } from "./activity-feed-text.js";
import type { OfficeLink } from "./office-link.js";
import { EMPTY_OFFICE } from "./office-state.js";
import { useOfficeStyles } from "./styles.js";
import type { OfficeState } from "./use-office.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { View } = await import("react-native");
  const ScrollView = (props: { children: ReactNode }) =>
    createElement("div", { "data-scroll": "vertical" }, createElement(View, null, props.children));
  return { ScrollView };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const at = (hours: number, minutes: number) => new Date(2026, 10, 17, hours, minutes).getTime();

let seq = 0;
function ev(agentId: string, when: number, kind: FeedKind, text: string): FeedEvent {
  seq += 1;
  return {
    id: `${agentId}:${seq}`,
    agentId,
    title: agentId.toUpperCase(),
    at: when,
    kind,
    alert: kind === "permission" || kind === "error",
    text,
  };
}

function agent(id: string, agentStatus: OfficeAgent["status"]): OfficeAgent {
  return {
    id,
    title: id.toUpperCase(),
    provider: "claude",
    model: null,
    status: agentStatus,
    workspaceId: null,
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-11T08:00:00.000Z",
  };
}

let selected: string[];
let opened: string[];
let container: HTMLElement;
let root: Root;

const LAYOUT = { compact: true, platform: "web" } as const;

function office(state: Partial<OfficeSnapshot>, extra: Partial<OfficeState> = {}): OfficeState {
  return {
    state: { ...EMPTY_OFFICE, ...state },
    loaded: true,
    subscription: { status: "live" },
    chat: null,
    ...extra,
  };
}

function Harness({ value }: { value: OfficeState }) {
  const styles = useOfficeStyles(THEME, LAYOUT.compact, false);
  const link: OfficeLink = {
    select: (agentId) => void selected.push(agentId),
    openSession: (agentId) => void opened.push(agentId),
  };
  return createElement(ActivityPanel, {
    office: value,
    styles,
    theme: THEME,
    layout: LAYOUT,
    link,
  });
}

async function mount(value: OfficeState = office({})): Promise<void> {
  await act(async () => root.render(createElement(Harness, { value })));
}

function labelled(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`Nothing is labelled "${label}"`);
  return found;
}

function maybe(label: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}

async function press(label: string): Promise<void> {
  const button = labelled(label);
  await act(async () => button.click());
}

beforeEach(() => {
  selected = [];
  opened = [];
  act(() => feedStore.reset());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("empty: Nothing yet since the office opened.", async () => {
  await mount();
  expect(container.textContent).toContain(FEED_EMPTY);
});

test("cards with their lines and +N more; a press selects the agent", async () => {
  // Six events of A within four minutes share one card; B's is its own.
  act(() =>
    feedStore.push([
      ev("a", at(9, 1), "read", "Reading"),
      ev("a", at(9, 1), "edit", "Editing"),
      ev("a", at(9, 2), "command", "Running a command"),
      ev("a", at(9, 3), "test", "Running tests"),
      ev("a", at(9, 4), "write", "Writing"),
      ev("a", at(9, 5), "edit", "Editing"),
      ev("b", at(8, 30), "finished", "Finished"),
    ]),
  );
  await mount(office({ agents: [agent("a", "running")] }));

  const cardA = labelled("A, 09:05");
  expect(cardA.textContent).toContain("Working");
  expect(cardA.textContent).toContain("Running tests");
  expect(cardA.textContent).toContain("+2 more");
  const cardB = labelled("B, 08:30");
  expect(cardB.textContent).toContain("Finished");
  // B is not running, and its one line leaves nothing more.
  expect(cardB.textContent).not.toContain("Working");
  expect(cardB.textContent).not.toContain("more");
  // Newest first.
  expect(cardA.compareDocumentPosition(cardB) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  await press("A, 09:05");
  expect(selected).toEqual(["a"]);
  expect(opened).toEqual([]);
});

test("an alert card has Open session", async () => {
  act(() =>
    feedStore.push([
      ev("a", at(9, 0), "edit", "Editing"),
      ev("a", at(9, 1), "permission", "Needs permission: Bash"),
    ]),
  );
  await mount();

  const alert = labelled("A, 09:01");
  expect(alert.textContent).toContain("Needs permission: Bash");
  const buttons = container.querySelectorAll('[aria-label="Open session"]');
  // The alert stands alone, and only it offers the session.
  expect(buttons).toHaveLength(1);
  expect(labelled("A, 09:00").textContent).toContain("Editing");

  await press("Open session");
  // The inner button opened the session once; the card's own press did not also fire.
  expect(opened).toEqual(["a"]);
  expect(selected).toEqual([]);
});

test("Needs you and the chips filter the cards", async () => {
  act(() =>
    feedStore.push([
      ev("a", at(9, 0), "read", "Reading"),
      ev("b", at(9, 10), "command", "Running a command"),
      ev("c", at(9, 20), "error", "Stopped on an error"),
      ev("d", at(9, 30), "web", "Searching the web"),
    ]),
  );
  await mount();

  expect(labelled("All").getAttribute("aria-selected")).toBe("true");
  expect(maybe("A, 09:00")).not.toBeNull();
  expect(maybe("D, 09:30")).not.toBeNull();

  // Chips: Commands and Reads on keep their kinds; the alert and the web step drop out.
  await press("Commands");
  expect(labelled("Commands").getAttribute("aria-pressed")).toBe("true");
  expect(labelled("Reads").getAttribute("aria-pressed")).toBe("false");
  await press("Reads");
  expect(maybe("A, 09:00")).not.toBeNull();
  expect(maybe("B, 09:10")).not.toBeNull();
  expect(maybe("C, 09:20")).toBeNull();
  expect(maybe("D, 09:30")).toBeNull();
  // The count ignores the chips: one alert in the whole feed.
  expect(maybe("Needs you, 1")).not.toBeNull();

  // Both off again: none means all.
  await press("Commands");
  await press("Reads");
  expect(maybe("D, 09:30")).not.toBeNull();

  await press("Needs you, 1");
  expect(labelled("Needs you, 1").getAttribute("aria-selected")).toBe("true");
  expect(maybe("C, 09:20")).not.toBeNull();
  expect(maybe("A, 09:00")).toBeNull();
  expect(maybe("D, 09:30")).toBeNull();
});

test("a filter that hides every card says so", async () => {
  act(() => feedStore.push([ev("a", at(9, 0), "read", "Reading")]));
  await mount();
  expect(container.textContent).not.toContain(FEED_NO_MATCH);

  await press("Commands");
  expect(maybe("A, 09:00")).toBeNull();
  expect(container.textContent).toContain(FEED_NO_MATCH);
  // The feed has events, so it is not the empty feed's line.
  expect(container.textContent).not.toContain(FEED_EMPTY);
});

test("the Live tag shows while the subscription is live", async () => {
  await mount();
  expect(container.textContent).toContain("Live");

  await mount(office({}, { subscription: { status: "connecting" } }));
  expect(container.textContent).not.toContain("Live");

  // A state that cannot load says so as the office does.
  await mount(office({}, { subscription: { status: "error", error: new Error("Host offline.") } }));
  expect(container.textContent).not.toContain("Live");
  expect(container.textContent).toContain("Unable to load the office: host offline");

  await mount(office({}, { subscription: { status: "closed" } }));
  expect(container.textContent).toContain(
    "Unable to show live agents: the host closed the office. Reopen it.",
  );
});
