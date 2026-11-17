import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type RefObject,
} from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { useAgentDescriptor } from "@/agent-presentation";
import { createInlinePathOpener, type InlinePathTarget } from "@/assistant-file-links";
import { WorkspaceComposerEditingSessionsProvider } from "@/composer/editing-session";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";
import { DiffDocumentWorkspaceCacheProvider } from "@/git/diff-document/workspace-cache";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";
import { useStableEvent } from "@/hooks/use-stable-event";
import { usePaneFocusIfAny } from "@/panels/pane-context";
import { getPanelRegistration, type PanelIconProps } from "@/panels/panel-registry";
import { ensurePanelsRegistered } from "@/panels/register-panels";
import type { ResolvedBesideTarget } from "@/plugins/host-navigation-model";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { SheetPaneHostProvider, type SheetPaneHost } from "@/screens/workspace/sheet-pane";
import { useViewedSheetAgent } from "@/screens/workspace/sheet-pane/sheet-pane";
import { resolveWorkspaceHeader } from "@/screens/workspace/workspace-header-source";
import { WorkspaceMarkdownLinks } from "@/screens/workspace/workspace-screen";
import {
  buildWorkspacePaneContentModel,
  WorkspacePaneContent,
  type WorkspacePaneContentModel,
} from "@/screens/workspace/workspace-pane-content";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import { selectWorkspaceExists } from "@/stores/session-store-hooks/selectors";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import { openExplorerSidebarView } from "@/workspace-tabs/explorer-sidebar";
import { buildWorkspaceTabPersistenceKey, type WorkspaceTabTarget } from "@/workspace-tabs/model";
import {
  createWorkspaceFileTabTarget,
  normalizeWorkspaceFileLocation,
  type OpenFileDisposition,
  type WorkspaceFileOpenRequest,
} from "@/workspace/file-open";
import { useOpenOutsideWorkspaceFolder } from "@/workspace/open-in-file-manager/outside-folder";
import { registerBesideKind } from "./beside-area";
import { BesideHeader } from "./beside-header";
import { buildAgentBesidePaneContext } from "./agent-pane-context";
import { besideTabId } from "./store";

type AgentTarget = Extract<ResolvedBesideTarget, { kind: "agent" }>;
type SessionState = ReturnType<typeof useSessionStore.getState>;

/** The agent's workspace id, or null while its host does not know the agent. */
function selectAgentWorkspaceId(state: SessionState, target: AgentTarget): string | null {
  const session = state.sessions[target.serverId];
  const agent = session?.agents.get(target.agentId) ?? session?.agentDetails.get(target.agentId);
  return normalizeWorkspaceOpaqueId(agent?.workspaceId);
}

/** The session can be shown while its host knows the agent and the agent's workspace. */
function isAgentShowable(target: AgentTarget): boolean {
  const state = useSessionStore.getState();
  return selectWorkspaceExists(state, target.serverId, selectAgentWorkspaceId(state, target));
}

function useAgentWorkspace(target: AgentTarget): WorkspaceDescriptor | null {
  const workspaceId = useSessionStore((state) => selectAgentWorkspaceId(state, target));
  return useWorkspace(target.serverId, workspaceId);
}

function PanelIcon({
  icon: Icon,
  size,
  color,
}: { icon: ComponentType<PanelIconProps> } & PanelIconProps) {
  return <Icon size={size} color={color} />;
}

const ThemedPanelIcon = withUnistyles(PanelIcon, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

/** The agent's title as its tab shows it, its workspace's name, Open in workspace and Close. */
function AgentBesideHeader({ target, close }: { target: AgentTarget; close(): void }) {
  const { serverId, agentId } = target;
  const descriptor = useAgentDescriptor({ kind: "agent", agentId }, { serverId });
  const workspace = useAgentWorkspace(target);
  const icon = useMemo(
    () => <ThemedPanelIcon icon={descriptor.icon} size={16} />,
    [descriptor.icon],
  );
  const openInWorkspace = useMemo(
    () => ({
      label: "Open in workspace",
      onPress: () => {
        navigateToAgent({ serverId, agentId });
        close();
      },
    }),
    [agentId, close, serverId],
  );
  return (
    <BesideHeader
      icon={icon}
      title={descriptor.label}
      subtitle={workspace ? resolveWorkspaceHeader({ workspace }).title : undefined}
      action={openInWorkspace}
      onClose={close}
    />
  );
}

/** Closes the area once the agent, or its workspace, is gone from the host. */
function AgentBesideBody({
  target,
  surfaceKey,
  close,
}: {
  target: AgentTarget;
  surfaceKey: string;
  close(): void;
}) {
  // A workspace screen registers the panels as it renders; the office's own screen may be the
  // first screen the app shows. Render time only: the registry imports the plugin panel, which
  // imports the side area, which imports this module.
  ensurePanelsRegistered();
  const workspace = useAgentWorkspace(target);
  const gone = workspace === null;
  useEffect(() => {
    if (gone) close();
  }, [close, gone]);
  if (!workspace) return null;
  return (
    <AgentBesidePane
      serverId={target.serverId}
      agentId={target.agentId}
      workspace={workspace}
      tabId={besideTabId(surfaceKey)}
      close={close}
    />
  );
}

const ignore = () => undefined;

interface AgentBesidePaneProps {
  serverId: string;
  agentId: string;
  workspace: WorkspaceDescriptor;
  tabId: string;
  close(): void;
}

/**
 * The agent pane under the providers its own workspace's screen gives every pane. Around an office
 * panel those of the office's workspace are already there, so these replace them; on the office's
 * own screen there are none.
 */
function AgentBesidePane({ serverId, agentId, workspace, tabId, close }: AgentBesidePaneProps) {
  const workspaceId = workspace.id;
  const workspaceRoot = workspace.workspaceDirectory;
  const workspaceKey = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  invariant(workspaceKey, "An agent's workspace has a key");
  const isCompact = useIsCompactFormFactor();
  const client = useHostRuntimeClient(serverId);
  const toast = useToast();
  // Beside a workspace panel the area is part of that panel's pane: it has the keyboard only while
  // that pane does. The plugin's own screen is in no pane.
  const isWorkspaceFocused = usePaneFocusIfAny()?.isInteractive ?? true;

  // Links leave for the agent's workspace with what they open.
  const openInWorkspace = useStableEvent((target: WorkspaceTabTarget) => {
    navigateToWorkspace({ serverId, workspaceId, target });
  });
  const openFile = useStableEvent((request: WorkspaceFileOpenRequest) => {
    const location = normalizeWorkspaceFileLocation(request.location);
    if (location) openInWorkspace(createWorkspaceFileTabTarget(location));
  });

  const paneContextValue = useMemo(
    () =>
      buildAgentBesidePaneContext({
        serverId,
        workspaceId,
        agentId,
        tabId,
        close,
        openInWorkspace,
        openFile,
      }),
    [agentId, close, openFile, openInWorkspace, serverId, tabId, workspaceId],
  );
  const Component = getPanelRegistration("agent")?.component;
  invariant(Component, "No panel registration for kind: agent");
  const content = useMemo<WorkspacePaneContentModel>(
    () => ({ key: `${serverId}:${workspaceId}:${tabId}`, Component, paneContextValue }),
    [Component, paneContextValue, serverId, tabId, workspaceId],
  );

  // The subagents track opens its rows as sheets of this workspace.
  const buildSheetContent = useCallback<SheetPaneHost["buildContent"]>(
    (tab, closeCurrentTab) =>
      buildWorkspacePaneContentModel({
        tab,
        normalizedServerId: serverId,
        normalizedWorkspaceId: workspaceId,
        host: "sheet",
        onOpenTab: openInWorkspace,
        onOpenPreferredTarget: openInWorkspace,
        onCloseCurrentTab: closeCurrentTab,
        onRetargetCurrentTab: ignore,
        onSetCurrentTabState: ignore,
        onOpenWorkspaceFile: openFile,
        onOpenImportSheet: ignore,
      }),
    [openFile, openInWorkspace, serverId, workspaceId],
  );
  const sheetPaneHost = useMemo<SheetPaneHost>(
    () => ({
      workspaceKey,
      serverId,
      workspaceId,
      isWorkspaceFocused,
      buildContent: buildSheetContent,
    }),
    [buildSheetContent, isWorkspaceFocused, serverId, workspaceId, workspaceKey],
  );

  // Paths in the agent's messages, as its workspace opens them (workspace-screen.tsx's Markdown
  // path opener), leaving for that workspace.
  const { revealDirectory } = useFileExplorerActions({ serverId, workspaceId, workspaceRoot });
  const openDirectory = useStableEvent((directoryPath: string) => {
    void revealDirectory(directoryPath);
    openExplorerSidebarView({ isCompact, workspaceKey, view: "files" });
    navigateToWorkspace({ serverId, workspaceId });
  });
  const openOutsideDirectory = useOpenOutsideWorkspaceFolder(serverId);
  const pathOpener = useMemo(
    () =>
      createInlinePathOpener({
        workspaceRoot,
        client,
        openFile: (location) => openInWorkspace(createWorkspaceFileTabTarget(location)),
        openDirectory,
        openOutsideDirectory,
      }),
    [client, openDirectory, openInWorkspace, openOutsideDirectory, workspaceRoot],
  );
  useEffect(() => () => pathOpener.cancel(), [pathOpener]);
  const openPath = useStableEvent((target: InlinePathTarget, disposition: OpenFileDisposition) => {
    void pathOpener.open(target, disposition);
  });

  // The workspace only publishes the agents of its panes; this one is outside them.
  useViewedSheetAgent({ sourceId: tabId, serverId, agentId });
  const paneRef = useRef<View>(null);
  const isPaneFocused = useHasKeyboard(paneRef);
  // The composer's editing session is the area's own. Under the office's workspace, that
  // workspace's tab changes would drop it; under the agent's, each side would drop the other's.
  const editingTabIds = useMemo(() => [tabId], [tabId]);

  return (
    <WorkspaceComposerEditingSessionsProvider workspaceKey={tabId} tabIds={editingTabIds}>
      <DiffDocumentWorkspaceCacheProvider>
        <SheetPaneHostProvider value={sheetPaneHost}>
          <WorkspaceMarkdownLinks
            workspace={workspace}
            client={client}
            serverId={serverId}
            workspaceRoot={workspaceRoot || undefined}
            onOpenWorkspaceFile={openPath}
            toast={toast}
          >
            <View ref={paneRef} style={styles.pane}>
              <WorkspacePaneContent
                content={content}
                isWorkspaceFocused={isWorkspaceFocused}
                isPaneFocused={isPaneFocused}
              />
            </View>
          </WorkspaceMarkdownLinks>
        </SheetPaneHostProvider>
      </DiffDocumentWorkspaceCacheProvider>
    </WorkspaceComposerEditingSessionsProvider>
  );
}

// The frame around the plugin's content and the area (beside-area.tsx).
const FRAME_SELECTOR = '[data-testid="beside-frame"]';

/**
 * Whether the pane has the keyboard, so the app's pane shortcuts reach it and not the plugin's
 * content. On a wide web layout that is from a press or a focus inside the pane until one elsewhere
 * in the frame, or until an iframe in the frame takes the focus; the area's own menus and sheets
 * open outside the frame and leave it as it is. The compact sheet covers the plugin's content, and
 * native has no keyboard focus to follow.
 */
function useHasKeyboard(paneRef: RefObject<View | null>): boolean {
  const isCompact = useIsCompactFormFactor();
  const followsPresses = isWeb && !isCompact;
  const [pressedInside, setPressedInside] = useState(false);
  useEffect(() => {
    if (!followsPresses) return;
    const pane: unknown = paneRef.current;
    if (!(pane instanceof HTMLElement)) return;
    const frame = pane.closest(FRAME_SELECTOR);
    if (!frame) return;
    const follow = (event: Event) => {
      setPressedInside(event.target instanceof Node && pane.contains(event.target));
    };
    // A press inside an iframe, such as the office's scene, reaches no listener in this document,
    // and browsers differ on firing focusin at the iframe element. The window's blur always fires;
    // some browsers make the iframe the active element only after it.
    let blurCheck: ReturnType<typeof setTimeout> | undefined;
    const followWindowBlur = () => {
      clearTimeout(blurCheck);
      blurCheck = setTimeout(() => {
        const focused = document.activeElement;
        if (focused && frame.contains(focused) && !pane.contains(focused)) setPressedInside(false);
      }, 0);
    };
    frame.addEventListener("pointerdown", follow, true);
    frame.addEventListener("focusin", follow, true);
    window.addEventListener("blur", followWindowBlur);
    return () => {
      frame.removeEventListener("pointerdown", follow, true);
      frame.removeEventListener("focusin", follow, true);
      window.removeEventListener("blur", followWindowBlur);
      clearTimeout(blurCheck);
    };
  }, [followsPresses, paneRef]);
  return followsPresses ? pressedInside : true;
}

registerBesideKind("agent", {
  available: isAgentShowable,
  Header: AgentBesideHeader,
  Body: AgentBesideBody,
});

const styles = StyleSheet.create({
  pane: {
    flex: 1,
    minHeight: 0,
  },
});
