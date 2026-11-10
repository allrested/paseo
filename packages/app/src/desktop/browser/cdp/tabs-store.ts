import { create } from "zustand";
import type {
  CdpBrowserTabState,
  CdpBrowserTabsEvent,
} from "@getpaseo/protocol/browser-automation/cdp-view-schemas";

/** What one host's Docker browser reports. Not persisted: the daemon is the source on every connect. */
export interface CdpHostTabs {
  connected: boolean;
  tabs: Record<string, CdpBrowserTabState>;
}

const EMPTY_HOST: CdpHostTabs = { connected: false, tabs: {} };

export function applyTabsSnapshot(
  host: CdpHostTabs,
  workspaceId: string,
  snapshot: { connected: boolean; tabs: readonly CdpBrowserTabState[] },
): CdpHostTabs {
  const tabs: Record<string, CdpBrowserTabState> = {};
  for (const tab of Object.values(host.tabs)) {
    if (tab.workspaceId !== workspaceId) tabs[tab.browserId] = tab;
  }
  for (const tab of snapshot.tabs) tabs[tab.browserId] = tab;
  return { connected: snapshot.connected, tabs };
}

export function applyTabsEvent(host: CdpHostTabs, event: CdpBrowserTabsEvent): CdpHostTabs {
  switch (event.kind) {
    case "opened":
    case "state":
      return { ...host, tabs: { ...host.tabs, [event.tab.browserId]: event.tab } };
    case "closed": {
      const { [event.browserId]: _closed, ...tabs } = host.tabs;
      return { ...host, tabs };
    }
    case "host": {
      if (event.connected) return { ...host, connected: true };
      // The daemon's "agent stopped" event cannot arrive while the host is gone.
      const tabs = Object.fromEntries(
        Object.entries(host.tabs).map(([id, tab]) => [id, { ...tab, agentActiveUntil: null }]),
      );
      return { connected: false, tabs };
    }
  }
}

interface CdpTabsStoreState {
  hosts: Record<string, CdpHostTabs>;
  /** The daemon's last URL for each tab it closed, so Reopen can restore it. */
  lastUrlByBrowserId: Record<string, string>;
  applySnapshot(
    serverId: string,
    workspaceId: string,
    snapshot: { connected: boolean; tabs: readonly CdpBrowserTabState[] },
  ): void;
  applyEvent(serverId: string, event: CdpBrowserTabsEvent): void;
  forgetLastUrl(browserId: string): void;
}

export const useCdpTabsStore = create<CdpTabsStoreState>()((set) => ({
  hosts: {},
  lastUrlByBrowserId: {},
  applySnapshot: (serverId, workspaceId, snapshot) =>
    set((state) => ({
      hosts: {
        ...state.hosts,
        [serverId]: applyTabsSnapshot(state.hosts[serverId] ?? EMPTY_HOST, workspaceId, snapshot),
      },
    })),
  applyEvent: (serverId, event) =>
    set((state) => ({
      hosts: {
        ...state.hosts,
        [serverId]: applyTabsEvent(state.hosts[serverId] ?? EMPTY_HOST, event),
      },
      ...(event.kind === "closed"
        ? { lastUrlByBrowserId: { ...state.lastUrlByBrowserId, [event.browserId]: event.lastUrl } }
        : {}),
    })),
  forgetLastUrl: (browserId) =>
    set((state) => {
      const { [browserId]: _forgotten, ...rest } = state.lastUrlByBrowserId;
      return { lastUrlByBrowserId: rest };
    }),
}));
