/**
 * @vitest-environment jsdom
 */
// The office's page, mounted as the app mounts the screen: nothing of the settings is on it, and
// the view switch and the settings button sit over the floor's corner. Everything the page and its
// cards take from the host is stood in here; the office's subscription speaks only when a test
// delivers an event, so the body stays on "Loading..." until then.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AccessibilityInfo } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps, SettingsState } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ChatMessage, OfficeAgent, OfficeEvent } from "../shared/contracts.js";
import { buildOfficeModel } from "../shared/model.js";
import { officeHostSettings, officeDeviceSettings } from "../shared/settings.js";
import { markChatSeen, resetChatSeen } from "./chat-seen.js";
import { EMPTY_OFFICE } from "./office-state.js";

/** The view the device holds; every other device value is the office's default. */
let view: "3d" | "2d" | "list";
/** The office's subscription: "live" unless a test says it failed or closed. */
let subscriptionStatus: "live" | "error" | "closed";
/** The office's events, once its subscription is drawn. */
let deliver: ((event: OfficeEvent) => void) | null;

const DEVICE: SettingsState<typeof officeDeviceSettings.schema> = {
  status: "ready",
  values: { threeD: true, rungIncidents: {} },
  revision: "r1",
  saving: false,
  saveError: null,
  save: async () => true,
  reset: async () => true,
  reload: async () => undefined,
};

vi.mock("@getpaseo/plugin/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/plugin/client")>()),
  // The device's view is the test's; the host's settings are the schema's defaults.
  useSettings: (settings: { id: string }) => {
    if (settings.id === "office-device") {
      return { ...DEVICE, values: { ...DEVICE.values, view } };
    }
    if (settings.id === "office-column") {
      return { ...DEVICE, values: { width: 360, collapsed: false } };
    }
    return { ...DEVICE, values: officeHostSettings.schema.parse({}) };
  },
  // Live, and silent until a test delivers: the body shows what it shows before a snapshot. The
  // machine's subscription never speaks.
  useSubscription: (
    contract: { name: string },
    _input: unknown,
    onEvent: (event: OfficeEvent) => void,
  ) => {
    if (contract.name === "office.state") deliver = onEvent;
    if (contract.name !== "office.state") return { status: "live" };
    return { status: subscriptionStatus, error: { message: "The office is out of reach" } };
  },
  useRpc: () => async () => {
    throw new Error("The header asks for nothing");
  },
  usePaseo: () => ({
    agents: {
      ref: () => ({
        send: async () => undefined,
        respondToPermission: async () => undefined,
        cancel: async () => undefined,
      }),
    },
  }),
}));

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView, TextInput, View } = await import("react-native");
  const Modal = (props: { title: string; open: boolean; children: ReactNode }) =>
    props.open ? createElement("section", { "aria-label": props.title }, props.children) : null;
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  const Markdown = (props: { children: string }) =>
    createElement("div", { "data-markdown": "" }, props.children);
  const ExternalLink = (props: { href: string; children: ReactNode }) =>
    createElement("a", { href: props.href }, props.children);
  const Icon = (props: { name: string }) => createElement(View, { testID: `icon-${props.name}` });
  return {
    ExternalLink,
    Icon,
    Markdown,
    Modal,
    ScrollView,
    TextInput,
    copyText: async () => undefined,
    useToast: () => ({ show: () => undefined, error: () => undefined }),
  };
});

// The real model, counted: a chat change must not build it again.
vi.mock("../shared/model.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../shared/model.js")>();
  return { ...real, buildOfficeModel: vi.fn(real.buildOfficeModel) };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
// A test browser draws no 3D: the surface asks for WebGL2 as it loads, and the answer is no.
vi.mock("./web-env.web.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./web-env.web.js")>()),
  hasWebGL2: () => false,
}));

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

/** False on a host with no way to the settings: the surface gets no `onOpenSettings`. */
let settingsWay: boolean;
/** How many times the surface asked for the office's settings screen. */
let settingsOpened: number;
/** True for the phone's layout, as the app mounts it narrow; false for the wide one. */
let compact: boolean;
let container: HTMLElement;
let root: Root;

async function mount(): Promise<void> {
  const { OfficeSurface } = await import("./office-surface.js");
  const props = {
    theme: THEME,
    layout: { compact, platform: "web" },
    host: { id: "host", label: "Host" },
    params: {},
    ...(settingsWay ? { onOpenSettings: () => void (settingsOpened += 1) } : {}),
    navigation: { openAgent: () => undefined, openWorkspace: () => undefined },
  } as unknown as PluginScreenProps;
  await act(async () => root.render(createElement(OfficeSurface, props)));
}

function labelled(label: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}

async function press(label: string): Promise<void> {
  const button = labelled(label);
  if (!button) throw new Error(`Nothing is labelled "${label}"`);
  await act(async () => button.click());
}

/** What each button says to a screen reader, in the order they are drawn. */
function buttonLabels(): (string | null)[] {
  return [...container.querySelectorAll('[role="button"]')].map((button) =>
    button.getAttribute("aria-label"),
  );
}

function chatMessage(at: number, from: string | undefined, kind = "text"): ChatMessage {
  return { id: `m${at}`, at, kind, from, name: from, text: "Hi", reacts: {} };
}

beforeEach(() => {
  view = "list";
  subscriptionStatus = "live";
  deliver = null;
  settingsWay = true;
  settingsOpened = 0;
  compact = true;
  // The test browser's AccessibilityInfo gives no subscription to remove; the 2D floor asks.
  vi.spyOn(AccessibilityInfo, "addEventListener").mockReturnValue({
    remove: () => undefined,
  } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("the page has no settings: no switch and no field", async () => {
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));

  expect(container.querySelector('[role="switch"]')).toBeNull();
  // The list view's agent search is the page's own field, not a setting.
  expect(container.querySelector("input:not(#office-list-search)")).toBeNull();
});

const BROKEN_NOTES = {
  folderSet: true,
  writing: false,
  writtenAt: null,
  failedAgentId: null,
  problem: null,
  scheduleError: "unknown zone Mars/Olympus",
};

function settingsCard(): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>('[role="button"]')].find(
    (button) =>
      button.getAttribute("aria-label") !== "Office settings" &&
      button.textContent?.includes("Settings"),
  );
}

/** The wide office's Attention tab, where the strip's cards are. */
async function openAttention(): Promise<void> {
  await act(async () =>
    container.querySelector<HTMLElement>('[role="tab"][aria-label^="Attention"]')?.click(),
  );
}

test("a schedule the settings broke shows a Settings card that opens the settings", async () => {
  compact = false;
  await mount();
  await act(async () =>
    deliver?.({ type: "snapshot", state: { ...EMPTY_OFFICE, notes: BROKEN_NOTES } }),
  );
  await openAttention();

  const card = settingsCard();
  if (!card) throw new Error("The strip has no Settings card");
  await act(async () => card.click());

  expect(settingsOpened).toBe(1);
});

test("with no way to the settings, a broken schedule draws no Settings card", async () => {
  settingsWay = false;
  compact = false;
  await mount();
  await act(async () =>
    deliver?.({ type: "snapshot", state: { ...EMPTY_OFFICE, notes: BROKEN_NOTES } }),
  );
  await openAttention();

  expect(settingsCard()).toBeUndefined();
});

test("the corner has an Office settings button that opens the settings", async () => {
  await mount();

  await press("Office settings");

  expect(settingsOpened).toBe(1);
});

test("with no way to the settings, the corner has no Office settings button", async () => {
  settingsWay = false;
  await mount();

  expect(labelled("Office settings")).toBeNull();
});

test("the header has the view switch and the settings button, and no panel buttons", async () => {
  await mount();

  // A test browser has no WebGL, so the view switch offers 2D and the List.
  expect(buttonLabels()).toEqual(["2D view", "List view", "Office settings"]);
});

test("a chat change does not rebuild the floor's model", async () => {
  resetChatSeen(1000);
  await mount();
  await act(async () =>
    deliver?.({
      type: "snapshot",
      state: { ...EMPTY_OFFICE, chat: { messages: [], typing: [] } },
    }),
  );
  const built = vi.mocked(buildOfficeModel).mock.calls.length;
  expect(built).toBeGreaterThan(0);

  await act(async () => deliver?.({ type: "chat", change: { op: "typing", names: ["Ali"] } }));
  await act(async () =>
    deliver?.({ type: "chat", change: { op: "add", message: chatMessage(6000, "a1") } }),
  );
  expect(vi.mocked(buildOfficeModel).mock.calls.length).toBe(built);
});

test("a wide office has the column, on Sessions, and no strip above the floor", async () => {
  compact = false;
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));

  // The Sessions panel's own filter pills are tabs too: only the column's are asked for.
  const tabs = [...container.querySelectorAll('[aria-label="Office column"] [role="tab"]')].map(
    (each) => each.getAttribute("aria-label"),
  );
  expect(tabs).toEqual(["Attention", "Sessions", "Activity", "Chat"]);
  expect(labelled("Sessions")?.getAttribute("aria-selected")).toBe("true");
});

test("Attention counts the strip's cards and shows them", async () => {
  compact = false;
  await mount();
  const notes = {
    folderSet: true,
    writing: false,
    writtenAt: null,
    failedAgentId: null,
    problem: null,
    scheduleError: "unknown zone Mars/Olympus",
  };
  await act(async () => deliver?.({ type: "snapshot", state: { ...EMPTY_OFFICE, notes } }));

  const attention = container.querySelector<HTMLElement>('[role="tab"][aria-label^="Attention"]');
  expect(attention?.getAttribute("aria-label")).toBe("Attention, 1 new");
  await act(async () => attention?.click());
  expect(container.textContent).toContain("Settings");
});

test("Attention with nothing waiting says so", async () => {
  compact = false;
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));
  await openAttention();

  expect(container.textContent).toContain("Nothing needs you.");
});

test("Chat's tab shows the messages since the chat was last open, and none at zero", async () => {
  compact = false;
  resetChatSeen(1000);
  await mount();
  const chat = () => container.querySelector<HTMLElement>('[role="tab"][aria-label^="Chat"]');
  expect(chat()?.getAttribute("aria-label")).toBe("Chat");

  // Seen, then two agents' messages after the mark; yours and a system line do not count.
  const messages = [
    chatMessage(500, "a1"),
    chatMessage(2000, "a1"),
    chatMessage(3000, "me"),
    chatMessage(4000, undefined, "sys"),
    chatMessage(5000, "a2"),
  ];
  await act(async () =>
    deliver?.({ type: "snapshot", state: { ...EMPTY_OFFICE, chat: { messages, typing: [] } } }),
  );
  expect(chat()?.getAttribute("aria-label")).toBe("Chat, 2 new");

  // The chat was open up to the newest: the count goes.
  await act(async () => markChatSeen(5000));
  expect(chat()?.getAttribute("aria-label")).toBe("Chat");
});

test("the controls take a row while the body shows Loading, and the corner once a floor is drawn", async () => {
  view = "2d";
  await mount();
  expect(container.textContent).toContain("Loading");
  expect(container.querySelector('[data-testid="office-view-row"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="office-view-corner"]')).toBeNull();

  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));

  expect(container.querySelector('[data-testid="office-view-corner"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="office-view-row"]')).toBeNull();
});

test("the controls take a row while the subscription is in error or closed", async () => {
  view = "2d";
  for (const status of ["error", "closed"] as const) {
    subscriptionStatus = status;
    await mount();
    await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));

    expect(container.querySelector('[data-testid="office-view-row"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="office-view-corner"]')).toBeNull();
  }
});

const ADA: OfficeAgent = {
  id: "ada",
  title: "Ada",
  provider: "claude",
  model: null,
  status: "idle",
  workspaceId: "w1",
  parentAgentId: null,
  permissions: [],
  createdAt: "2026-11-17T08:00:00.000Z",
};

const OFFICE_WITH_ONE_AGENT = {
  ...EMPTY_OFFICE,
  agents: [ADA],
  workspaces: [{ id: "w1", name: "shop-api", projectName: "Shop" }],
};

test("a phone has the bar under the floor, and no column beside it", async () => {
  compact = true;
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));

  expect(
    container.querySelectorAll('[role="tablist"][aria-label="Office column"] [role="tab"]'),
  ).toHaveLength(4);
  expect(container.querySelector('[aria-label="Collapse the column"]')).toBeNull();
  expect(container.querySelector('[aria-label="Close"]')).toBeNull();
});

test("a phone's Sessions opens as a sheet, and a row press closes it for the agent's card", async () => {
  compact = true;
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: OFFICE_WITH_ONE_AGENT }));
  await act(async () =>
    container
      .querySelector<HTMLElement>(
        '[role="tablist"][aria-label="Office column"] [role="tab"][aria-label="Sessions"]',
      )
      ?.click(),
  );
  expect(container.querySelector('[aria-label="Close"]')).not.toBeNull();

  // The list view of the floor has rows for the agent too: look only inside the sheet.
  const sheet = container.querySelector('[aria-label="Close"]')?.parentElement?.parentElement;
  const row = [...(sheet?.querySelectorAll<HTMLElement>('[role="button"]') ?? [])].find((button) =>
    button.getAttribute("aria-label")?.startsWith("Ada"),
  );
  if (!row) throw new Error("The sheet has no row for the agent");
  await act(async () => row.click());
  expect(container.querySelector('[aria-label="Close"]')).toBeNull();
});
