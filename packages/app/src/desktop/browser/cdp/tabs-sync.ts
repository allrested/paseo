import { useEffect } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { CdpBrowserTabState } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import { useBrowserStore } from "@/desktop/browser/store";
import { createBrowserRecord } from "@/desktop/browser/store/state";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { useCdpTabsStore } from "./tabs-store";

/** The tab's label and toolbar read the shared browser store, so a daemon tab gets a record there. */
function syncBrowserRecord(tab: CdpBrowserTabState): void {
  if (!useBrowserStore.getState().browsersById[tab.browserId]) {
    useBrowserStore.setState((state) => ({
      browsersById: {
        ...state.browsersById,
        [tab.browserId]: createBrowserRecord({
          browserId: tab.browserId,
          initialUrl: tab.url,
          now: Date.now(),
        }),
      },
    }));
  }
  useBrowserStore.getState().updateBrowser(tab.browserId, {
    url: tab.url,
    title: tab.title,
    isLoading: tab.isLoading,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
  });
}

function findLayoutTab(workspaceKey: string, browserId: string): string | null {
  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];
  if (!layout) return null;
  const tab = collectAllTabs(layout.root).find(
    (candidate) => candidate.target.kind === "browser" && candidate.target.browserId === browserId,
  );
  return tab?.tabId ?? null;
}

function hasLayoutTab(workspaceKey: string, tabId: string): boolean {
  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];
  return layout ? collectAllTabs(layout.root).some((tab) => tab.tabId === tabId) : false;
}

/**
 * Adds the tab to the workspace layout once. A tab that is already there is only focused, never
 * duplicated. `replaceTabId` (a placeholder tab) is swapped for the browser tab, in the
 * placeholder's pane and position. `paneId` opens the tab in that pane. A tab that is already open
 * is moved to the requested place.
 */
export function ensureCdpTabInLayout(input: {
  serverId: string;
  workspaceId: string;
  browserId: string;
  focus: boolean;
  replaceTabId?: string;
  paneId?: string;
}): void {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey) return;
  const layoutStore = useWorkspaceLayoutStore.getState();
  const target = { kind: "browser", browserId: input.browserId } as const;
  const existing = findLayoutTab(workspaceKey, input.browserId);
  if (existing) {
    // The daemon's "opened" event reaches the sync before the open response, so the tab is already
    // there, in the default place. Put it where the caller asked.
    let tabId = existing;
    // A background open into a pane whose only tab is the placeholder already took its place.
    const placeholderOpen =
      input.replaceTabId !== undefined && hasLayoutTab(workspaceKey, input.replaceTabId);
    if (input.replaceTabId && placeholderOpen && input.replaceTabId !== existing) {
      layoutStore.closeTab(workspaceKey, existing);
      tabId = layoutStore.replaceTab(workspaceKey, input.replaceTabId, target) ?? existing;
    } else if (input.paneId) {
      layoutStore.moveTabToPane(workspaceKey, existing, input.paneId);
    }
    if (input.focus) layoutStore.focusTab(workspaceKey, tabId);
    return;
  }
  if (input.replaceTabId) {
    layoutStore.replaceTab(workspaceKey, input.replaceTabId, target);
    return;
  }
  layoutStore.openTab({
    workspaceKey,
    target,
    intent: input.focus ? "reveal" : "background",
    ...(input.paneId ? { placement: { mode: "pane", paneId: input.paneId } } : {}),
  });
}

/** Opens a tab from the UI. Rejects with the daemon's error code. */
export async function openCdpTab(input: {
  client: DaemonClient;
  serverId: string;
  workspaceId: string;
  url?: string;
  replaceTabId?: string;
  paneId?: string;
}): Promise<string> {
  const tab = await input.client.openCdpBrowserTab({
    workspaceId: input.workspaceId,
    url: input.url,
  });
  syncBrowserRecord(tab);
  // The "opened" event may have added the tab in the background already; this focuses it.
  ensureCdpTabInLayout({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    browserId: tab.browserId,
    focus: true,
    replaceTabId: input.replaceTabId,
    paneId: input.paneId,
  });
  return tab.browserId;
}

/**
 * "Tab closed" then Reopen: a new tab on the daemon's last URL takes the dead tab's place. Falls
 * back to the record URL when the daemon sent no closed event.
 */
export async function reopenCdpTab(input: {
  client: DaemonClient;
  serverId: string;
  workspaceId: string;
  browserId: string;
}): Promise<void> {
  const url =
    useCdpTabsStore.getState().lastUrlByBrowserId[input.browserId] ??
    useBrowserStore.getState().browsersById[input.browserId]?.url;
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  const dead = workspaceKey ? findLayoutTab(workspaceKey, input.browserId) : null;
  await openCdpTab({
    client: input.client,
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    url,
    replaceTabId: dead ?? undefined,
  });
  useCdpTabsStore.getState().forgetLastUrl(input.browserId);
  useBrowserStore.getState().removeBrowser(input.browserId);
}

/**
 * Keeps one workspace's daemon browser tabs in the stores and the layout while its screen is mounted.
 * The subscription replays its snapshot on reconnect, which is the reconcile when a workspace opens.
 * A layout tab the daemon no longer has stays: its pane shows "Tab closed" with Reopen.
 * Callers pass `enabled` from the host's `cdpBrowser` feature.
 */
export function useCdpTabsSync(input: {
  client: DaemonClient | null;
  serverId: string;
  workspaceId: string;
  enabled: boolean;
}): void {
  const { client, serverId, workspaceId, enabled } = input;
  useEffect(() => {
    if (!enabled || !client || !serverId || !workspaceId) return;
    const observation = client.observeCdpBrowserTabs({ workspaceId });
    const unsubscribe = observation.subscribe({
      snapshot: (snapshot) => {
        useCdpTabsStore.getState().applySnapshot(serverId, workspaceId, snapshot);
        for (const tab of snapshot.tabs) {
          syncBrowserRecord(tab);
          ensureCdpTabInLayout({ serverId, workspaceId, browserId: tab.browserId, focus: false });
        }
      },
      update: (message) => {
        if (message.type !== "browser.cdp.tabs.update") return;
        const { event } = message.payload;
        useCdpTabsStore.getState().applyEvent(serverId, event);
        if (event.kind === "opened") {
          syncBrowserRecord(event.tab);
          ensureCdpTabInLayout({
            serverId,
            workspaceId,
            browserId: event.tab.browserId,
            focus: false,
          });
        } else if (event.kind === "state") {
          syncBrowserRecord(event.tab);
        }
      },
      // A refused subscription (old host, lost feature) leaves the pane on its own error state.
      error: () => {},
    });
    // A refused subscription rejects `ready`; handled by `error` above, so only swallow here.
    observation.ready.catch(() => {});
    return () => {
      unsubscribe();
      void observation.release().catch(() => {});
    };
  }, [client, enabled, serverId, workspaceId]);
}
