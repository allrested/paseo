/**
 * @vitest-environment jsdom
 */
// An agent's session in the side area, beside the office. The agent pane is replaced by a probe
// registered for kind "agent": the real pane's imports reach the expo package's runtime, which the
// unit project cannot load. The probe reads what the pane reads (its pane context and focus, the
// workspace providers it asserts, its draft by key, its composer's editing session, the agent's
// archived state).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  createElement,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Text } from "react-native";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssistantFileLinkResolverProvider,
  useAssistantFileLinkEnvironment,
} from "@/assistant-file-links";
import type { ToastApi } from "@/components/toast-host";
import {
  ComposerEditingSessionsProvider,
  useComposerEditingSession,
  useComposerFullscreen,
  WorkspaceComposerEditingSessionsProvider,
  type ComposerEditingSession,
} from "@/composer/editing-session";
import { ToastApiProvider } from "@/contexts/toast-api-context";
import {
  DiffDocumentWorkspaceCacheProvider,
  useDiffDocumentWorkspaceCache,
} from "@/git/diff-document/workspace-cache";
import { i18n } from "@/i18n/i18next";
import {
  createPaneFocusContextValue,
  PaneFocusProvider,
  usePaneContext,
  usePaneFocus,
  type PaneContextValue,
} from "@/panels/pane-context";
import { definePanel, registerPanel } from "@/panels/panel-registry";
import { ensurePanelsRegistered } from "@/panels/register-panels";
import type { ResolvedBesideTarget } from "@/plugins/host-navigation-model";
import {
  SheetPaneHostProvider,
  useSheetPaneHost,
  type SheetPaneHost,
} from "@/screens/workspace/sheet-pane";
import { buildDraftStoreKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore, type Agent, type WorkspaceDescriptor } from "@/stores/session-store";
import { seedSessionWorkspaces } from "@/test/seed-session";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { BesideFrame, useShowBeside } from "./beside-area";
import { besideTabId, useBesideStore } from "./store";
// oxlint-disable-next-line import/no-unassigned-import -- The agent kind registers itself on import.
import "./agent-beside";

// The package's CJS entry loads React Native's Flow sources, which the unit project cannot parse.
// The frame and the sheet bridge only read its two contexts.
vi.mock("expo-router/react-navigation", async () => {
  const { createContext } = await import("react");
  return {
    NavigationContext: createContext(undefined),
    NavigationRouteContext: createContext(undefined),
  };
});

// Both leave for a workspace route through expo-router.
vi.mock("@/utils/navigate-to-agent", () => ({ navigateToAgent: vi.fn() }));
vi.mock("@/stores/navigation-active-workspace-store", () => ({ navigateToWorkspace: vi.fn() }));

// Registering the real panels imports the real agent pane; the probe stands in for it below.
vi.mock("@/panels/register-panels", () => ({ ensurePanelsRegistered: vi.fn() }));

/** The workspace the area last gave its Markdown links, for their forge references. */
const markdownLinks = vi.hoisted(() => ({ workspaceId: null as string | null }));

// The workspace screen's module reaches the expo package's runtime, as the agent pane's does. The
// stand-in `WorkspaceMarkdownLinks` gives the area's props to the real file-link resolver, which the
// probe reads.
vi.mock("@/screens/workspace/workspace-screen", async () => {
  const { AssistantFileLinkResolverProvider: FileLinkResolver } =
    await import("@/assistant-file-links");
  function WorkspaceMarkdownLinks({
    workspace: linked,
    ...fileLinks
  }: ComponentProps<typeof import("@/screens/workspace/workspace-screen").WorkspaceMarkdownLinks>) {
    markdownLinks.workspaceId = linked?.id ?? null;
    return <FileLinkResolver {...fileLinks} />;
  }
  return { WorkspaceMarkdownLinks };
});

const navigateToAgentMock = vi.mocked(navigateToAgent);
const navigateToWorkspaceMock = vi.mocked(navigateToWorkspace);

const SERVER = "host";
const AGENT = "agent-1";
const OFFICE_SCREEN = `${SERVER}:office:office`;
const TARGET = { kind: "agent", agentId: AGENT, serverId: SERVER } as const;

function workspace(id: string, name: string): WorkspaceDescriptor {
  return {
    createdAt: null,
    lastUserMessageAt: null,
    id,
    projectId: "project-1",
    projectDisplayName: "Shop",
    projectRootPath: "/repo",
    workspaceDirectory: `/repo/${id}`,
    projectKind: "git",
    workspaceKind: "worktree",
    name,
    status: "done",
    archivingAt: null,
    statusEnteredAt: null,
    diffStat: null,
    scripts: [],
  };
}

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    serverId: SERVER,
    id: AGENT,
    provider: "claude",
    status: "idle",
    createdAt: new Date("2026-11-17T00:00:00.000Z"),
    updatedAt: new Date("2026-11-17T00:00:00.000Z"),
    lastUserMessageAt: null,
    lastActivityAt: new Date("2026-11-17T00:00:00.000Z"),
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: "Fix the checkout",
    cwd: "/repo/shop-api",
    workspaceId: "shop-api",
    model: null,
    parentAgentId: null,
    labels: {},
    archivedAt: null,
    turn: { phase: "idle", cancellationRequestId: null },
    ...overrides,
  };
}

const viewedTimelineSync = { replaceVisibleAgentIds: vi.fn() };

function seed() {
  const store = useSessionStore.getState();
  store.initializeSession(SERVER, null);
  seedSessionWorkspaces(
    SERVER,
    new Map([
      ["shop-api", workspace("shop-api", "Checkout fixes")],
      ["ops", workspace("ops", "Ops")],
    ]),
  );
  store.setAgents(SERVER, new Map([[AGENT, agent()]]));
  store.setViewedTimelineSync(SERVER, viewedTimelineSync as never);
}

function setAgent(next: Agent | null) {
  act(() => {
    useSessionStore
      .getState()
      .setAgents(SERVER, next ? new Map([[AGENT, next]]) : new Map<string, Agent>());
  });
}

let probeMounts = 0;
let probePane: PaneContextValue | null = null;
let probeEditingSession: ComposerEditingSession | null = null;
let rerenderProbe: (() => void) | null = null;

/** The agent pane's stand-in: what it reads, as text. */
function PaneProbe() {
  const pane = usePaneContext();
  probePane = pane;
  const { isInteractive } = usePaneFocus();
  // The composer's fullscreen state and caret live here (agent-panel.tsx:1058).
  const editingSession = useComposerEditingSession("chat");
  probeEditingSession = editingSession;
  const fullscreen = useComposerFullscreen(editingSession);
  rerenderProbe = useReducer((count: number) => count + 1, 0)[1];
  // The subagents track asserts both on every route (subagents/track.tsx:83).
  const sheetHost = useSheetPaneHost();
  useDiffDocumentWorkspaceCache();
  const fileLinks = useAssistantFileLinkEnvironment();
  const agentId = pane.target.kind === "agent" ? pane.target.agentId : "";
  // The key the pane's composer keeps its draft under (agent-panel.tsx:1064-1068).
  const draft = useDraftStore(
    (state) =>
      state.getDraftInput(buildDraftStoreKey({ serverId: pane.serverId, agentId }))?.text ?? "",
  );
  // The pane shows the archived callout in its composer's place while this is set
  // (agent-panel.tsx:1525).
  const archived = useSessionStore((state) =>
    Boolean(state.sessions[pane.serverId]?.agents.get(agentId)?.archivedAt),
  );
  useEffect(() => {
    probeMounts += 1;
  }, []);
  return (
    <>
      <Text testID="probe-tab">{pane.tabId}</Text>
      <Text testID="probe-workspace">{pane.workspaceId}</Text>
      <Text testID="probe-sheet-workspace">{sheetHost.workspaceId}</Text>
      <Text testID="probe-file-root">{fileLinks.workspaceRoot ?? ""}</Text>
      <Text testID="probe-draft">{draft}</Text>
      <Text testID="probe-focus">{isInteractive ? "focused" : "unfocused"}</Text>
      <Text testID="probe-composer">{archived ? "archived" : "composer"}</Text>
      <Text testID="probe-fullscreen">{fullscreen ? "fullscreen" : "inline"}</Text>
    </>
  );
}

registerPanel(
  definePanel("agent", {
    component: PaneProbe,
    useDescriptor: () => {
      throw new Error("The area's header reads the agent panel's own descriptor");
    },
  }),
);

let showBeside: ((target: ResolvedBesideTarget) => boolean) | undefined;

function OfficeContent() {
  showBeside = useShowBeside();
  return (
    <>
      <Text testID="office-content">The office</Text>
      {/* The office's 3D scene is an iframe (plugins/office/client/world/world-frame.web.ts). */}
      {createElement("iframe", { "data-testid": "office-scene", title: "Office", sandbox: "" })}
    </>
  );
}

const toast = { show: vi.fn(), copied: vi.fn(), error: vi.fn() } as unknown as ToastApi;

/** The office beside its area; `around` stands for the workspace an office panel sits in. */
function renderOffice(
  surfaceKey = OFFICE_SCREEN,
  around: (children: ReactNode) => ReactNode = (children) => children,
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastApiProvider api={toast}>
        {/* The app's root keeps every composer's editing sessions (app/_layout.tsx). */}
        <ComposerEditingSessionsProvider>
          {around(
            <BesideFrame surfaceKey={surfaceKey}>
              <OfficeContent />
            </BesideFrame>,
          )}
        </ComposerEditingSessionsProvider>
      </ToastApiProvider>
    </QueryClientProvider>,
  );
}

function show(target: ResolvedBesideTarget): boolean {
  let shown = false;
  act(() => {
    shown = showBeside!(target);
  });
  return shown;
}

/** The page's window loses the focus, and the next tick passes. */
async function blurWindow() {
  await act(async () => {
    window.dispatchEvent(new Event("blur"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function text(testID: string): string {
  return screen.getByTestId(testID).textContent ?? "";
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

beforeEach(() => {
  useSessionStore.setState((state) => ({ ...state, sessions: {} }));
  seed();
  useBesideStore.setState(useBesideStore.getInitialState(), true);
  probeMounts = 0;
  probePane = null;
  probeEditingSession = null;
  rerenderProbe = null;
  markdownLinks.workspaceId = null;
  showBeside = undefined;
  navigateToAgentMock.mockReset();
  navigateToWorkspaceMock.mockReset();
  viewedTimelineSync.replaceVisibleAgentIds.mockReset();
  vi.mocked(ensurePanelsRegistered).mockClear();
});

afterEach(() => {
  cleanup();
});

describe("an agent's session beside the office's own screen", () => {
  it("shows the agent's title over its workspace's name, and its pane in its own workspace", () => {
    renderOffice();

    expect(show(TARGET)).toBe(true);

    expect(screen.getByText("Fix the checkout")).toBeTruthy();
    expect(screen.getByText("Checkout fixes")).toBeTruthy();
    expect(ensurePanelsRegistered).toHaveBeenCalled();
    // The screen route has no workspace: the area supplies the agent's own.
    expect(text("probe-workspace")).toBe("shop-api");
    expect(text("probe-sheet-workspace")).toBe("shop-api");
    expect(text("probe-file-root")).toBe("/repo/shop-api");
    expect(markdownLinks.workspaceId).toBe("shop-api");
    expect(text("probe-tab")).toBe(besideTabId(OFFICE_SCREEN));
    expect(screen.getByTestId("office-content")).toBeTruthy();
  });

  it("answers false for an agent the host does not know, and shows nothing", () => {
    renderOffice();

    expect(show({ ...TARGET, agentId: "unknown" })).toBe(false);
    expect(show({ ...TARGET, serverId: "elsewhere" })).toBe(false);

    expect(useBesideStore.getState().areas).toEqual({});
    expect(screen.queryByTestId("probe-tab")).toBeNull();
  });

  it("answers false for an agent whose workspace the host does not know", () => {
    setAgent(agent({ workspaceId: "gone" }));
    renderOffice();

    expect(show(TARGET)).toBe(false);
  });

  it("opens the agent in its workspace and closes the area from Open in workspace", () => {
    renderOffice();
    show(TARGET);

    fireEvent.click(screen.getByLabelText("Open in workspace"));

    expect(navigateToAgentMock).toHaveBeenCalledWith({ serverId: SERVER, agentId: AGENT });
    expect(useBesideStore.getState().areas).toEqual({});
    expect(screen.queryByTestId("probe-tab")).toBeNull();
  });

  it("shows the archived state, then the composer again once unarchived, without closing", () => {
    renderOffice();
    show(TARGET);
    expect(text("probe-composer")).toBe("composer");

    setAgent(agent({ archivedAt: new Date("2026-11-17T09:00:00.000Z") }));
    expect(text("probe-composer")).toBe("archived");
    expect(screen.getByText("Fix the checkout")).toBeTruthy();

    setAgent(agent({ archivedAt: null }));
    expect(text("probe-composer")).toBe("composer");
    expect(screen.getByText("Fix the checkout")).toBeTruthy();
    expect(probeMounts).toBe(1);
  });

  it("closes when the agent is gone from the host", () => {
    renderOffice();
    show(TARGET);

    setAgent(null);

    expect(useBesideStore.getState().areas).toEqual({});
    expect(screen.queryByText("Fix the checkout")).toBeNull();
    expect(screen.getByTestId("office-content")).toBeTruthy();
  });

  it("closes when the agent's workspace is gone", () => {
    renderOffice();
    show(TARGET);

    act(() => {
      useSessionStore.getState().removeWorkspace(SERVER, "shop-api");
    });

    expect(useBesideStore.getState().areas).toEqual({});
    expect(screen.queryByTestId("probe-tab")).toBeNull();
  });

  it("sends the pane's tabs and files to the agent's workspace, and its tab's close closes the area", () => {
    renderOffice();
    show(TARGET);
    const pane = probePane!;

    expect(pane.openTargetToSide).toBeUndefined();
    act(() => pane.openTab({ kind: "changes_tree" }));
    act(() =>
      pane.openFileInWorkspace({
        location: { path: "src/cart.ts", lineStart: 12 },
        disposition: "preferred",
      }),
    );

    expect(navigateToWorkspaceMock.mock.calls).toEqual([
      [{ serverId: SERVER, workspaceId: "shop-api", target: { kind: "changes_tree" } }],
      [
        {
          serverId: SERVER,
          workspaceId: "shop-api",
          target: { kind: "file", path: "src/cart.ts", lineStart: 12 },
        },
      ],
    ]);

    act(() => pane.closeCurrentTab());
    expect(useBesideStore.getState().areas).toEqual({});
  });

  it("marks the agent viewed while it is shown, so its timeline stays live", () => {
    renderOffice();
    show(TARGET);
    const tabId = besideTabId(OFFICE_SCREEN);

    expect(viewedTimelineSync.replaceVisibleAgentIds).toHaveBeenLastCalledWith(tabId, [AGENT]);

    fireEvent.click(screen.getByLabelText("Close"));
    expect(viewedTimelineSync.replaceVisibleAgentIds).toHaveBeenLastCalledWith(tabId, []);
  });

  it("is the focused pane while it has the keyboard, not while the office does", () => {
    renderOffice();
    show(TARGET);
    expect(text("probe-focus")).toBe("unfocused");

    fireEvent.pointerDown(screen.getByTestId("probe-tab"));
    expect(text("probe-focus")).toBe("focused");

    fireEvent.pointerDown(screen.getByTestId("office-content"));
    expect(text("probe-focus")).toBe("unfocused");

    fireEvent.focusIn(screen.getByTestId("probe-draft"));
    expect(text("probe-focus")).toBe("focused");
  });

  it("gives up the keyboard when focus moves into the office's scene, an iframe", async () => {
    renderOffice();
    show(TARGET);
    const scene = screen.getByTestId("office-scene");

    fireEvent.pointerDown(screen.getByTestId("probe-tab"));
    fireEvent.focusIn(scene);
    expect(text("probe-focus")).toBe("unfocused");

    // A press in an iframe reaches no listener in the page, and a browser may fire no focusin on
    // the iframe element either: the page's window loses focus to it.
    fireEvent.pointerDown(screen.getByTestId("probe-tab"));
    expect(text("probe-focus")).toBe("focused");
    const activeElement = vi.spyOn(document, "activeElement", "get").mockReturnValue(scene);
    await blurWindow();
    activeElement.mockRestore();
    expect(text("probe-focus")).toBe("unfocused");
  });

  it("keeps the keyboard when the page's window loses focus with the pane focused", async () => {
    renderOffice();
    show(TARGET);
    fireEvent.pointerDown(screen.getByTestId("probe-tab"));
    const activeElement = vi
      .spyOn(document, "activeElement", "get")
      .mockReturnValue(screen.getByTestId("probe-draft"));

    // Another app took the focus; the pane gets it back with the window.
    await blurWindow();
    activeElement.mockRestore();

    expect(text("probe-focus")).toBe("focused");
  });
});

/** The sheet host of a workspace the office panel is a tab of. */
function officeSheetHost(workspaceId: string): SheetPaneHost {
  return {
    workspaceKey: `${SERVER}:${workspaceId}`,
    serverId: SERVER,
    workspaceId,
    isWorkspaceFocused: true,
    buildContent: () => {
      throw new Error("The office workspace's sheets are not the agent's");
    },
  };
}

const OFFICE_SHEET_HOSTS = { ops: officeSheetHost("ops"), "shop-api": officeSheetHost("shop-api") };

/** Lets a test open another tab in the workspace the office panel is a tab of. */
const officeTabs = { set: null as null | ((tabIds: string[]) => void) };

/** The workspace's editing sessions, which keep only its own tabs' (workspace-screen.tsx). */
function OfficeWorkspaceTabs({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const [tabIds, setTabIds] = useState(["office-tab"]);
  officeTabs.set = setTabIds;
  return (
    <WorkspaceComposerEditingSessionsProvider
      workspaceKey={`${SERVER}:${workspaceId}`}
      tabIds={tabIds}
    >
      {children}
    </WorkspaceComposerEditingSessionsProvider>
  );
}

/** Lets a test move the workspace's focus off the office's pane, as a press in another pane does. */
const officePane = { setFocused: null as null | ((focused: boolean) => void) };

/** The focus of the workspace pane the office panel is a tab of. */
function OfficePane({ children }: { children: ReactNode }) {
  const [focused, setFocused] = useState(true);
  officePane.setFocused = setFocused;
  const value = useMemo(
    () => createPaneFocusContextValue({ isWorkspaceFocused: true, isPaneFocused: focused }),
    [focused],
  );
  return <PaneFocusProvider value={value}>{children}</PaneFocusProvider>;
}

describe("an agent's session beside the office as a workspace panel", () => {
  /** The office workspace's own providers, around the panel the office is a tab of. */
  function inWorkspace(workspaceId: keyof typeof OFFICE_SHEET_HOSTS) {
    const host = OFFICE_SHEET_HOSTS[workspaceId];
    return (children: ReactNode) => (
      <OfficeWorkspaceTabs workspaceId={workspaceId}>
        <DiffDocumentWorkspaceCacheProvider>
          <SheetPaneHostProvider value={host}>
            <AssistantFileLinkResolverProvider
              serverId={SERVER}
              workspaceRoot={`/repo/${workspaceId}`}
            >
              <OfficePane>{children}</OfficePane>
            </AssistantFileLinkResolverProvider>
          </SheetPaneHostProvider>
        </DiffDocumentWorkspaceCacheProvider>
      </OfficeWorkspaceTabs>
    );
  }

  it("gives the pane the agent's workspace, not the one the office panel sits in", () => {
    renderOffice(`${SERVER}:ops:office-tab`, inWorkspace("ops"));

    show(TARGET);

    expect(text("probe-workspace")).toBe("shop-api");
    expect(text("probe-sheet-workspace")).toBe("shop-api");
    expect(text("probe-file-root")).toBe("/repo/shop-api");
    expect(markdownLinks.workspaceId).toBe("shop-api");
  });

  it("is the focused pane only while the office's pane is focused and the area has the keyboard", () => {
    renderOffice(`${SERVER}:ops:office-tab`, inWorkspace("ops"));
    show(TARGET);
    fireEvent.pointerDown(screen.getByTestId("probe-tab"));
    expect(text("probe-focus")).toBe("focused");

    // A press in another split pane is outside the frame; that pane takes the workspace's focus.
    act(() => officePane.setFocused!(false));
    expect(text("probe-focus")).toBe("unfocused");

    // A press on the office's content gives its pane the focus back, and the area stays unfocused.
    act(() => officePane.setFocused!(true));
    fireEvent.pointerDown(screen.getByTestId("office-content"));
    expect(text("probe-focus")).toBe("unfocused");

    fireEvent.pointerDown(screen.getByTestId("probe-tab"));
    expect(text("probe-focus")).toBe("focused");
  });

  it("shares the agent's draft with its workspace tab, under a tab id no workspace tab has", () => {
    // The office is a tab of the agent's own workspace.
    const surfaceKey = `${SERVER}:shop-api:office-tab`;
    renderOffice(surfaceKey, inWorkspace("shop-api"));
    show(TARGET);

    // Typed in the workspace's tab of the same agent.
    act(() => {
      useDraftStore.getState().editDraftText({
        draftKey: buildDraftStoreKey({ serverId: SERVER, agentId: AGENT }),
        text: "ship it",
      });
    });

    expect(text("probe-draft")).toBe("ship it");
    expect(text("probe-tab")).toBe(`beside:${surfaceKey}`);
    expect(text("probe-tab")).not.toBe("office-tab");
  });

  it.each([
    ["another workspace", "ops"],
    ["the agent's own workspace", "shop-api"],
  ] as const)(
    "keeps the composer's editing session when the office's workspace, %s, changes its tabs",
    (_name, workspaceId) => {
      renderOffice(`${SERVER}:${workspaceId}:office-tab`, inWorkspace(workspaceId));
      show(TARGET);
      const session = probeEditingSession!;
      act(() => session.setFullscreen(true));
      expect(text("probe-fullscreen")).toBe("fullscreen");

      // A tab opened beside the office: the workspace keeps the editing sessions of its own tabs.
      act(() => officeTabs.set!(["office-tab", "notes-tab"]));
      act(() => rerenderProbe!());

      expect(probeEditingSession).toBe(session);
      expect(text("probe-fullscreen")).toBe("fullscreen");
    },
  );
});
