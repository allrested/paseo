/**
 * @vitest-environment jsdom
 */
// The Sessions panel, mounted as the office's column mounts it: the surface's state arrives as a
// prop, and a test re-renders with the next state to see the panel change.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSubscriptionState } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeAgent, OfficeSnapshot } from "../shared/contracts.js";
import { NO_MATCH, SEARCH_LABEL } from "./list-text.js";
import type { OfficeLink } from "./office-link.js";
import { EMPTY_OFFICE } from "./office-state.js";
import { SessionsPanel } from "./sessions-panel.js";
import { NO_AGENTS } from "./sessions-text.js";
import { useOfficeStyles } from "./styles.js";
import type { OfficeState } from "./use-office.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { TextInput, View } = await import("react-native");
  const ScrollView = (props: { children: ReactNode }) =>
    createElement("div", { "data-scroll": "vertical" }, createElement(View, null, props.children));
  return { ScrollView, TextInput };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

function agent(id: string, overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: id.toUpperCase(),
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: null,
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-17T08:00:00.000Z",
    ...overrides,
  };
}

const AGENTS = [
  agent("a", { status: "running", workspaceId: "w1", promptedAt: "2026-11-17T09:00:00.000Z" }),
  agent("b", { workspaceId: "w2", idleSince: "2026-11-17T09:30:00.000Z" }),
];

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
  return createElement(SessionsPanel, {
    office: value,
    styles,
    theme: THEME,
    layout: LAYOUT,
    link,
  });
}

async function mount(value: OfficeState): Promise<void> {
  await act(async () => root.render(createElement(Harness, { value })));
}

async function show(agents: OfficeAgent[]): Promise<void> {
  await mount(
    office({
      agents,
      workspaces: [
        { id: "w1", name: "shop-api", projectName: "Shop" },
        { id: "w2", name: "blog", projectName: "Blog" },
      ],
      activity: { a: "Editing files" },
    }),
  );
}

function maybe(label: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}

function labelled(label: string): HTMLElement {
  const found = maybe(label);
  if (!found) throw new Error(`Nothing is labelled "${label}"`);
  return found;
}

async function press(label: string): Promise<void> {
  const button = labelled(label);
  await act(async () => button.click());
}

async function type(label: string, text: string): Promise<void> {
  const field = labelled(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  selected = [];
  opened = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("a row shows the room's name and the doing-now line; a press selects", async () => {
  await show(AGENTS);

  const rowA = labelled("A: Running");
  expect(rowA.textContent).toContain("shop-api");
  expect(rowA.textContent).toContain("Editing files");
  // A resting agent has no doing-now line: its state's word stands there.
  const rowB = labelled("B: Idle");
  expect(rowB.textContent).toContain("blog");
  expect(rowB.textContent).toContain("Idle");
  // Working comes before Resting.
  expect(rowA.compareDocumentPosition(rowB) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // No Open session on a Sessions row: the press and the card it opens are the way in.
  expect(maybe("Open session")).toBeNull();

  await press("A: Running");
  await press("B: Idle");
  expect(selected).toEqual(["a", "b"]);
  expect(opened).toEqual([]);
});

test("No agents yet. and No agent matches.", async () => {
  // Before the first state the office is not known to be empty.
  await mount(office({}, { loaded: false }));
  expect(container.textContent).toContain("Loading...");
  expect(container.textContent).not.toContain(NO_AGENTS);
  await show([]);
  expect(container.textContent).not.toContain("Loading...");
  expect(container.textContent).toContain(NO_AGENTS);
  expect(container.textContent).not.toContain(NO_MATCH);

  await show(AGENTS);
  expect(container.textContent).not.toContain(NO_AGENTS);
  // Nobody needs you: the tab is empty, and says so.
  await press("Needs you, 0");
  expect(labelled("Needs you, 0").getAttribute("aria-selected")).toBe("true");
  expect(container.textContent).toContain(NO_MATCH);
  expect(maybe("A: Running")).toBeNull();

  await press("All, 2");
  await type(SEARCH_LABEL, "blog");
  expect(maybe("A: Running")).toBeNull();
  expect(maybe("B: Idle")).not.toBeNull();
  // The counts ignore the search, as the List view's do.
  expect(maybe("Working, 1")).not.toBeNull();

  await type(SEARCH_LABEL, "nothing like it");
  expect(container.textContent).toContain(NO_MATCH);
  expect(labelled(SEARCH_LABEL).getAttribute("placeholder")).toBe(SEARCH_LABEL);
});

test("a state that cannot load says so as the office does", async () => {
  const problem = (subscription: PluginSubscriptionState) =>
    mount(office({}, { loaded: false, subscription }));
  await problem({ status: "error", error: new Error("Host offline.") });
  expect(container.textContent).toContain("Unable to load the office: host offline");

  await problem({ status: "closed" });
  expect(container.textContent).toContain(
    "Unable to show live agents: the host closed the office. Reopen it.",
  );
});
