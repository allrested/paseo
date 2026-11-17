/**
 * @vitest-environment jsdom
 */
// The Sessions panel, mounted as the side area mounts the screen: the office's subscription is
// stood in so a test decides its status and the state it delivers.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps, PluginSubscriptionState } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeAgent, OfficeEvent } from "../shared/contracts.js";
import { NO_MATCH, SEARCH_LABEL } from "./list-text.js";
import { useOfficeLink, type OfficeLink } from "./office-link.js";
import { EMPTY_OFFICE } from "./office-state.js";
import { NO_AGENTS } from "./sessions-text.js";

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

function Surface({ value }: { value: OfficeLink }) {
  useOfficeLink(value);
  return null;
}

async function mount(link?: OfficeLink): Promise<void> {
  const { SessionsPanel } = await import("./sessions-panel.js");
  const panel = createElement(SessionsPanel, screenProps());
  // The office surface beside the panel is a tree of its own in the app; here a sibling stands in.
  await act(async () =>
    root.render(
      link ? createElement("div", null, createElement(Surface, { value: link }), panel) : panel,
    ),
  );
}

async function show(agents: OfficeAgent[]): Promise<void> {
  await act(async () =>
    deliver?.({
      type: "snapshot",
      state: {
        ...EMPTY_OFFICE,
        agents,
        workspaces: [
          { id: "w1", name: "shop-api", projectName: "Shop" },
          { id: "w2", name: "blog", projectName: "Blog" },
        ],
        activity: { a: "Editing files" },
      },
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
  status = { status: "live" };
  deliver = null;
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
  await mount();
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

  // No office is mounted beside the panel: the agent's workspace opens.
  await press("A: Running");
  expect(opened).toEqual(["a"]);
});

test("with a surface registered a press selects in it", async () => {
  const selected: string[] = [];
  const link: OfficeLink = {
    select: (agentId) => void selected.push(agentId),
    openSession: () => undefined,
  };
  await mount(link);
  await show(AGENTS);

  await press("B: Idle");
  expect(selected).toEqual(["b"]);
  expect(opened).toEqual([]);
});

test("No agents yet. and No agent matches.", async () => {
  await mount();
  // Before the first state the office is not known to be empty.
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
  status = { status: "error", error: new Error("Host offline.") };
  await mount();
  expect(container.textContent).toContain("Unable to load the office: host offline");

  status = { status: "closed" };
  await mount();
  expect(container.textContent).toContain(
    "Unable to show live agents: the host closed the office. Reopen it.",
  );
});
