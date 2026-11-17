/**
 * @vitest-environment jsdom
 */
// The office's header, mounted as the app mounts the screen: the panel buttons open their panels
// beside the floor, and are not there on an app without a side area. Everything the header and
// its cards take from the host is stood in here; the office's subscription speaks only when a
// test delivers an event, so the body stays on "Loading..." until then.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps, SettingsState } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ChatMessage, OfficeEvent } from "../shared/contracts.js";
import { buildOfficeModel } from "../shared/model.js";
import { officeHostSettings, officeDeviceSettings } from "../shared/settings.js";
import { markChatSeen, resetChatSeen } from "./chat-seen.js";
import {
  ACTIVITY_SCREEN,
  CHAT_SCREEN,
  SESSIONS_SCREEN,
  claimOfficeLink,
  linkSelect,
} from "./office-link.js";
import { EMPTY_OFFICE } from "./office-state.js";

/** The view the device holds; every other device value is the office's default. */
let view: "3d" | "2d" | "list";
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
  useSettings: (settings: { id: string }) =>
    settings.id === "office-device"
      ? { ...DEVICE, values: { ...DEVICE.values, view } }
      : {
          ...DEVICE,
          values: officeHostSettings.schema.parse({}),
        },
  // Live, and silent until a test delivers: the body shows what it shows before a snapshot. The
  // machine's subscription never speaks.
  useSubscription: (
    contract: { name: string },
    _input: unknown,
    onEvent: (event: OfficeEvent) => void,
  ) => {
    if (contract.name === "office.state") deliver = onEvent;
    return { status: "live" };
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
const SESSIONS = { kind: "screen", pluginId: "office", screenId: SESSIONS_SCREEN };
const ACTIVITY = { kind: "screen", pluginId: "office", screenId: ACTIVITY_SCREEN };
const CHAT = { kind: "screen", pluginId: "office", screenId: CHAT_SCREEN };

/** What the app's navigation saw, and whether its side area takes what it is asked for. */
let shown: unknown[];
let opened: string[];
/** False on an app without sub-project 4: no `showBeside` at all. */
let sideArea: boolean;
/** True on a host that offers no navigation: an older app. */
let noNavigation: boolean;
let container: HTMLElement;
let root: Root;

async function mount(): Promise<void> {
  const { OfficeSurface } = await import("./office-surface.js");
  const props = {
    theme: THEME,
    layout: { compact: true, platform: "web" },
    host: { id: "host", label: "Host" },
    params: {},
    ...(noNavigation
      ? {}
      : {
          navigation: {
            openAgent: ({ agentId }: { agentId: string }) => void opened.push(agentId),
            openWorkspace: () => undefined,
            ...(sideArea
              ? {
                  showBeside: (target: unknown) => {
                    shown.push(target);
                    return true;
                  },
                }
              : {}),
          },
        }),
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

/** Chat, whose label carries its count. */
function chatButton(): HTMLElement {
  const button = container.querySelector<HTMLElement>('[aria-label^="Chat"]');
  if (!button) throw new Error("There is no Chat button");
  return button;
}

function chatMessage(at: number, from: string | undefined, kind = "text"): ChatMessage {
  return { id: `m${at}`, at, kind, from, name: from, text: "Hi", reacts: {} };
}

beforeEach(() => {
  view = "list";
  deliver = null;
  shown = [];
  opened = [];
  sideArea = true;
  noNavigation = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("the header has Sessions and Activity when the side area exists, and they open their screens", async () => {
  await mount();

  expect(labelled("Sessions")?.getAttribute("role")).toBe("button");
  expect(labelled("Activity")?.getAttribute("role")).toBe("button");
  // The view switch comes first in the header's row, the two panels' buttons after it.
  const list = labelled("List view");
  const sessions = labelled("Sessions");
  const activity = labelled("Activity");
  if (!list || !sessions || !activity) throw new Error("The header is missing a control");
  expect(list.compareDocumentPosition(sessions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(
    sessions.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  await press("Sessions");
  expect(shown).toEqual([SESSIONS]);

  await press("Activity");
  expect(shown).toEqual([SESSIONS, ACTIVITY]);
  expect(opened).toEqual([]);
});

test("a header press claims the link for this office", async () => {
  await mount();
  // Another office took the link after this one mounted, as a second retained office would.
  const elsewhere: string[] = [];
  claimOfficeLink({
    select: (agentId) => void elsewhere.push(agentId),
    openSession: (agentId) => void elsewhere.push(agentId),
  });

  await press("Sessions");
  // The panel in the area (no showBeside of its own) now reaches this office, not the other.
  act(() => linkSelect("a1", { openAgent: () => undefined, openWorkspace: () => undefined }));
  expect(elsewhere).toEqual([]);
});

test("without showBeside the buttons are not there", async () => {
  sideArea = false;
  await mount();

  // The view switch is still there, so the header itself was drawn.
  expect(labelled("List view")).not.toBeNull();
  expect(labelled("Sessions")).toBeNull();
  expect(labelled("Activity")).toBeNull();
});

test("without any navigation at all the buttons are not there", async () => {
  noNavigation = true;
  await mount();

  expect(labelled("List view")).not.toBeNull();
  expect(labelled("Sessions")).toBeNull();
  expect(labelled("Activity")).toBeNull();
});

test("the buttons are there in every view", async () => {
  for (const chosen of ["list", "2d"] as const) {
    view = chosen;
    await mount();
    // The view itself took the choice, so the buttons were drawn on that view.
    expect(
      labelled(`${chosen === "list" ? "List" : "2D"} view`)?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(labelled("Sessions")).not.toBeNull();
    expect(labelled("Activity")).not.toBeNull();
  }
});

test("the header has Chat after Activity, and a press opens the chat beside the floor", async () => {
  await mount();

  // A test browser has no WebGL, so the view switch offers 2D and the List.
  expect(buttonLabels()).toEqual(["2D view", "List view", "Sessions", "Activity", "Chat"]);
  await press("Chat");
  expect(shown).toEqual([CHAT]);
  expect(opened).toEqual([]);
});

test("Chat shows the messages since the chat was last open, and none at zero", async () => {
  resetChatSeen(1000);
  await mount();
  expect(chatButton().getAttribute("aria-label")).toBe("Chat");

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
  expect(chatButton().textContent).toContain("2");
  expect(chatButton().getAttribute("aria-label")).toBe("Chat, 2 new");

  // The chat was open up to the newest: the count goes.
  await act(async () => markChatSeen(5000));
  expect(chatButton().getAttribute("aria-label")).toBe("Chat");
  expect(chatButton().textContent).toBe("");
});

test("without showBeside Chat is not there either", async () => {
  sideArea = false;
  await mount();

  expect(labelled("List view")).not.toBeNull();
  expect(container.querySelector('[aria-label^="Chat"]')).toBeNull();
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
  // The surface drew the change (its count moved), and built no model for it.
  expect(chatButton().getAttribute("aria-label")).not.toBe("Chat");
  expect(vi.mocked(buildOfficeModel).mock.calls.length).toBe(built);
});
