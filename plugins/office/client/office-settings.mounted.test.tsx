/**
 * @vitest-environment jsdom
 */
// The Office settings screen, mounted as the app mounts a settings screen. The host's hooks are
// stood in: the settings record what was saved, and the office's subscription speaks only when a
// test delivers an event.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeEvent } from "../shared/contracts.js";
import { officeHostSettings } from "../shared/settings.js";
import { EMPTY_OFFICE } from "./office-state.js";

let hostSaves: unknown[];
let deviceSaves: unknown[];
let deliver: ((event: OfficeEvent) => void) | null;

vi.mock("@getpaseo/plugin/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/plugin/client")>()),
  useSettings: (settings: { id: string }) => {
    const device = settings.id === "office-device";
    return {
      status: "ready",
      revision: "r1",
      values: device
        ? { threeD: true, view: "list", rungIncidents: {} }
        : officeHostSettings.schema.parse({}),
      saving: false,
      saveError: null,
      save: async (values: unknown) => {
        (device ? deviceSaves : hostSaves).push(values);
        return true;
      },
      reset: async () => true,
      reload: async () => undefined,
    };
  },
  useSubscription: (
    contract: { name: string },
    _input: unknown,
    onEvent: (event: OfficeEvent) => void,
  ) => {
    if (contract.name === "office.state") deliver = onEvent;
    return { status: "live" };
  },
  useRpc: () => async () => undefined,
  usePaseo: () => ({ agents: { ref: () => ({}) } }),
}));

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView, TextInput, View } = await import("react-native");
  const Modal = (props: { title: string; open: boolean; children: ReactNode }) =>
    props.open ? createElement("section", { "aria-label": props.title }, props.children) : null;
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  const Icon = (props: { name: string }) => createElement(View, { testID: `icon-${props.name}` });
  return {
    ExternalLink: () => null,
    Icon,
    Markdown: () => null,
    Modal,
    ScrollView,
    TextInput,
    copyText: async () => undefined,
    useToast: () => ({ show: () => undefined, error: () => undefined }),
  };
});

vi.mock("./web-env.web.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./web-env.web.js")>()),
  hasWebGL2: () => false,
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
let container: HTMLElement;
let root: Root;

async function mount(): Promise<void> {
  const { OfficeSettings } = await import("./office-settings.js");
  const props = {
    theme: THEME,
    layout: { compact: false, platform: "web" },
    host: { id: "host", label: "Host" },
  } as unknown as PluginSurfaceProps;
  await act(async () => root.render(createElement(OfficeSettings, props)));
}

function labelled(label: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[aria-label^="${label}"]`);
}

beforeEach(() => {
  hostSaves = [];
  deviceSaves = [];
  deliver = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("the screen holds the switches, the fields and the view", async () => {
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));

  expect(labelled("Wake agents")?.getAttribute("role")).toBe("switch");
  expect(labelled("Agent tools")?.getAttribute("role")).toBe("switch");
  for (const field of ["Notes folder", "Time zone", "Jira projects", "Sentry organisation"]) {
    expect(container.querySelector(`input[aria-label="${field}"]`)).not.toBeNull();
  }
  expect(labelled("List view")?.getAttribute("aria-selected")).toBe("true");
});

test("a view chosen here is saved on the device", async () => {
  await mount();
  await act(async () => labelled("2D view")?.click());

  expect(deviceSaves).toEqual([{ threeD: true, view: "2d", rungIncidents: {} }]);
  expect(hostSaves).toEqual([]);
});

test("the notes schedule's failure shows under the Time zone field", async () => {
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

  const failure = [...container.querySelectorAll("*")].find(
    (node) =>
      node.children.length === 0 &&
      node.textContent === "Unable to schedule the stand-up notes: unknown zone Mars/Olympus",
  );
  const field = container.querySelector('input[aria-label="Time zone"]');
  if (!failure || !field) throw new Error("The failure or the Time zone field is not drawn");
  expect(field.compareDocumentPosition(failure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
