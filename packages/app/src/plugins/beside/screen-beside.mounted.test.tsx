/**
 * @vitest-environment jsdom
 */
// A plugin's screen in the side area, mounted in the frame with a fake installed plugin: the props
// the screen gets, its header and Open action, a screen that throws, and targets the host lacks.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { Text } from "react-native";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import appPackage from "../../../package.json";
import { i18n } from "@/i18n/i18next";
import type { ResolvedBesideTarget } from "@/plugins/host-navigation-model";
import { pluginRegistry } from "../registry";
import type { EvaluatedPlugin } from "../types";
import { BesideFrame, useShowBeside } from "./beside-area";
import { useBesideStore } from "./store";
// oxlint-disable-next-line import/no-unassigned-import -- The screen kind registers itself on import.
import "./screen-beside";

// The package's CJS entry loads React Native's Flow sources, which the unit project cannot parse.
// The frame only reads its two contexts.
vi.mock("expo-router/react-navigation", async () => {
  const { createContext } = await import("react");
  return {
    NavigationContext: createContext(undefined),
    NavigationRouteContext: createContext(undefined),
  };
});

const routerPush = vi.hoisted(() => vi.fn());

vi.mock("expo-router", () => ({
  router: { push: routerPush },
}));

// The registry installs the fake plugin as it would a real one, with these contributions in place
// of what its client bundle would register.
const evaluatedPlugins = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@/plugins/evaluate", () => ({
  runPluginClientBundle: (pluginId: string) => evaluatedPlugins.get(pluginId),
}));

// A 1280px desktop window with a mouse, read once when React Native Web and the pointer
// capabilities load: jsdom has no layout and answers no media query.
vi.hoisted(() => {
  Object.defineProperty(document.documentElement, "clientWidth", { value: 1280 });
  const queries = window.matchMedia;
  window.matchMedia = (query: string) =>
    query === "(hover: hover) and (pointer: fine)"
      ? Object.assign(queries(query), { matches: true })
      : queries(query);
});

vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => false,
}));

const HOST = "host";
const PLUGIN_ID = "resource-manager";
const RESOURCES = {
  kind: "screen",
  pluginId: PLUGIN_ID,
  screenId: "resources",
  serverId: HOST,
} as const;

let resourcesProps: PluginScreenProps | null = null;

function ResourcesScreen(props: PluginScreenProps) {
  resourcesProps = props;
  return <Text testID="resources-screen">Instance</Text>;
}

function BrokenResourcesScreen(): never {
  throw new Error("Resources exploded");
}

function ResourcesIcon() {
  return <Text testID="resources-icon">R</Text>;
}

/** Installs resource-manager on the host with these contributions. */
function installResourceManager(contributions: Partial<EvaluatedPlugin>) {
  const plugin: EvaluatedPlugin = {
    id: PLUGIN_ID,
    cleanup: () => undefined,
    surfaces: [],
    settingsScreens: [],
    sidebarViews: [],
    sidebarItems: { header: [], footer: [] },
    legacySidebarItems: [],
    workspaceRowBadgeItems: [],
    filePanels: [],
    composerItems: [],
    newWorkspaceItems: [],
    workspacePanels: [],
    commandCenterItems: [],
    clientSlashCommands: [],
    attachmentSources: [],
    themes: [],
    timelineTransformers: [],
    timelineRenderers: [],
    ...contributions,
  };
  evaluatedPlugins.set(PLUGIN_ID, plugin);
  pluginRegistry.installCatalog(
    HOST,
    [
      {
        id: PLUGIN_ID,
        requirements: { paseo: `>=${appPackage.version}` },
        clientBundle: "resource-manager bundle",
      },
    ],
    { client: {} as DaemonClient, audio: { play: async () => 0 } },
  );
}

/** As resource-manager registers it: a screen, and a sidebar header item that draws its own row. */
function installResources(Component = ResourcesScreen) {
  installResourceManager({
    surfaces: [{ id: "resources", title: "Resources", Component }],
    sidebarItems: {
      header: [{ id: "resources", title: "Resources", Component: () => null }],
      footer: [],
    },
  });
}

let showBeside: ((target: ResolvedBesideTarget) => boolean) | undefined;

function OfficeContent() {
  showBeside = useShowBeside();
  return <Text testID="plugin-content">The office</Text>;
}

function renderFrame() {
  return render(
    <BesideFrame surfaceKey="host:office:office">
      <OfficeContent />
    </BesideFrame>,
  );
}

function show(target: ResolvedBesideTarget): boolean {
  let shown = false;
  act(() => {
    shown = showBeside!(target);
  });
  return shown;
}

/** What leads the header's title: the icon's slot, or nothing. */
function headerLeading(title: string): Element | null {
  return screen.getByText(title).parentElement!.previousElementSibling;
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  resourcesProps = null;
  showBeside = undefined;
  routerPush.mockClear();
  useBesideStore.setState(useBesideStore.getInitialState(), true);
});

afterEach(() => {
  cleanup();
  pluginRegistry.removeHost(HOST);
  evaluatedPlugins.clear();
});

describe("a plugin's screen in the side area", () => {
  it("runs the screen narrow, on its host, with empty params and no side area of its own", () => {
    installResources();
    renderFrame();

    expect(show(RESOURCES)).toBe(true);

    const panel = screen.getByTestId("beside-panel");
    expect(panel.contains(screen.getByTestId("resources-screen"))).toBe(true);
    expect(resourcesProps!.params).toEqual({});
    expect(resourcesProps!.layout).toEqual({ compact: true, platform: "web" });
    expect(resourcesProps!.host.id).toBe(HOST);
    expect(resourcesProps!.theme.colors.foreground).toBe("#111111");
    expect(resourcesProps!.navigation!.openAgent).toBeTypeOf("function");
    expect(resourcesProps!.navigation!.showBeside).toBeUndefined();
  });

  it("gives the screen the params it was shown with", () => {
    installResources();
    renderFrame();

    show({ ...RESOURCES, params: { machine: "dev-box" } });

    expect(resourcesProps!.params).toEqual({ machine: "dev-box" });
  });

  it("heads the area with the screen's title and no icon when its sidebar item has none", () => {
    installResources();
    renderFrame();

    show(RESOURCES);

    const panel = screen.getByTestId("beside-panel");
    expect(panel.contains(screen.getByText("Resources"))).toBe(true);
    expect(panel.contains(screen.getByLabelText("Open Resources"))).toBe(true);
    expect(headerLeading("Resources")).toBeNull();
  });

  it("heads the area with the icon of the screen's sidebar item when it has one", () => {
    installResourceManager({
      surfaces: [{ id: "resources", title: "Resources", Component: ResourcesScreen }],
      legacySidebarItems: [
        { id: "resources-row", title: "Machine", icon: ResourcesIcon, surface: "resources" },
      ],
    });
    renderFrame();

    show(RESOURCES);

    expect(headerLeading("Resources")!.contains(screen.getByTestId("resources-icon"))).toBe(true);
  });

  it("opens the screen on its route with its params and closes the area", () => {
    installResources();
    renderFrame();
    show({ ...RESOURCES, params: { machine: "dev-box" } });

    act(() => fireEvent.click(screen.getByLabelText("Open Resources")));

    expect(routerPush).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith(
      "/h/host/plugin/resource-manager/surface/resources?param.machine=dev-box",
    );
    expect(useBesideStore.getState().areas).toEqual({});
    expect(screen.queryByTestId("beside-panel")).toBeNull();
    expect(screen.getByTestId("plugin-content")).toBeTruthy();
  });

  it("answers false and shows nothing for a plugin the host lacks or a screen the plugin lacks", () => {
    installResources();
    renderFrame();

    expect(show({ ...RESOURCES, pluginId: "missing" })).toBe(false);
    expect(show({ ...RESOURCES, screenId: "missing" })).toBe(false);
    expect(show({ ...RESOURCES, serverId: "other-host" })).toBe(false);

    expect(useBesideStore.getState().areas).toEqual({});
    expect(screen.queryByTestId("beside-panel")).toBeNull();
  });

  it("shows that the screen is unavailable when its plugin goes away while shown", () => {
    installResources();
    renderFrame();
    show(RESOURCES);

    act(() => pluginRegistry.removeHost(HOST));

    const panel = screen.getByTestId("beside-panel");
    expect(panel.contains(screen.getByText("This plugin surface is unavailable."))).toBe(true);
    expect(screen.queryByTestId("resources-screen")).toBeNull();
  });
});

describe("a plugin's screen that throws in the side area", () => {
  beforeEach(() => {
    // The boundary reports what it caught; React reports it too.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the plugin's error boundary message in the area, and the content keeps running", () => {
    installResources(BrokenResourcesScreen);
    renderFrame();

    expect(show(RESOURCES)).toBe(true);

    const panel = screen.getByTestId("beside-panel");
    expect(panel.contains(screen.getByText("Plugin failed: Resources exploded"))).toBe(true);
    // The plugin's own boundary caught it, under the screen's header.
    expect(panel.contains(screen.getByLabelText("Open Resources"))).toBe(true);
    expect(screen.queryByText("Could not show this")).toBeNull();
    expect(screen.getByTestId("plugin-content").textContent).toBe("The office");
  });
});
