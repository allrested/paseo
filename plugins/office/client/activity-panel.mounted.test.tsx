/**
 * @vitest-environment jsdom
 */
// The Activity panel, mounted as the side area mounts the screen: the feed's store is filled
// directly, and the office's subscription is stood in so a test decides its status and state.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps, PluginSubscriptionState } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeAgent, OfficeEvent } from "../shared/contracts.js";
import { feedStore, type FeedEvent, type FeedKind } from "./activity-feed.js";
import { FEED_EMPTY } from "./activity-feed-text.js";
import { useOfficeLink, type OfficeLink } from "./office-link.js";
import { EMPTY_OFFICE } from "./office-state.js";

/** The subscription's status, and the office's events once it delivers them. */
let status: PluginSubscriptionState;
let deliver: ((event: OfficeEvent) => void) | null;

vi.mock("@getpaseo/plugin/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/plugin/client")>()),
  useSubscription: (_contract: unknown, _input: unknown, onEvent: (event: OfficeEvent) => void) => {
    deliver = onEvent;
    return status;
  },
}));

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

let opened: string[];
let container: HTMLElement;
let root: Root;

function screenProps(): PluginScreenProps {
  return {
    theme: THEME,
    layout: { compact: true, platform: "web" },
    host: { id: "host", label: "Host" },
    params: {},
    navigation: {
      openAgent: ({ agentId }: { agentId: string }) => void opened.push(agentId),
      openWorkspace: () => undefined,
    },
  } as unknown as PluginScreenProps;
}

async function mount(link?: OfficeLink): Promise<void> {
  const { ActivityPanel } = await import("./activity-panel.js");
  const panel = createElement(ActivityPanel, screenProps());
  // The office surface beside the panel is a tree of its own in the app; here a sibling stands in.
  await act(async () =>
    root.render(
      link ? createElement("div", null, createElement(Surface, { value: link }), panel) : panel,
    ),
  );
}

function Surface({ value }: { value: OfficeLink }) {
  useOfficeLink(value);
  return null;
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
  status = { status: "live" };
  deliver = null;
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
  await mount();
  await act(async () =>
    deliver?.({ type: "snapshot", state: { ...EMPTY_OFFICE, agents: [agent("a", "running")] } }),
  );

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

  // No office is mounted beside the panel: the agent's workspace opens.
  await press("A, 09:05");
  expect(opened).toEqual(["a"]);
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

test("the Live tag shows while the subscription is live", async () => {
  await mount();
  expect(container.textContent).toContain("Live");

  status = { status: "connecting" };
  await mount();
  expect(container.textContent).not.toContain("Live");

  // A state that cannot load says so as the office does.
  status = { status: "error", error: new Error("Host offline.") };
  await mount();
  expect(container.textContent).not.toContain("Live");
  expect(container.textContent).toContain("Unable to load the office: host offline");

  status = { status: "closed" };
  await mount();
  expect(container.textContent).toContain(
    "Unable to show live agents: the host closed the office. Reopen it.",
  );
});

test("with a surface registered a press selects in it and Open session opens it there", async () => {
  const selected: string[] = [];
  const sessions: string[] = [];
  const link: OfficeLink = {
    select: (agentId) => void selected.push(agentId),
    openSession: (agentId) => void sessions.push(agentId),
  };
  act(() =>
    feedStore.push([
      ev("a", at(9, 0), "edit", "Editing"),
      ev("b", at(9, 1), "error", "Stopped on an error"),
    ]),
  );
  await mount(link);

  await press("A, 09:00");
  expect(selected).toEqual(["a"]);
  await press("Open session");
  expect(sessions).toEqual(["b"]);
  expect(selected).toEqual(["a"]);
  expect(opened).toEqual([]);
});
