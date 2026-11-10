import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import {
  collectAllPanes,
  collectAllTabs,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { ensureCdpTabInLayout } from "./tabs-sync";

const KEY = buildWorkspaceTabPersistenceKey({ serverId: "srv", workspaceId: "ws" }) as string;

function browserTabIds(): string[] {
  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[KEY];
  if (!layout) return [];
  return collectAllTabs(layout.root)
    .filter((tab) => tab.target.kind === "browser")
    .map((tab) => (tab.target.kind === "browser" ? tab.target.browserId : ""));
}

function paneBrowserIds(): { paneId: string; browserIds: string[] }[] {
  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[KEY];
  if (!layout) return [];
  const idByTabId = new Map(
    collectAllTabs(layout.root).map((tab) => [
      tab.tabId,
      tab.target.kind === "browser" ? tab.target.browserId : tab.target.kind,
    ]),
  );
  return collectAllPanes(layout.root).map((pane) => ({
    paneId: pane.id,
    browserIds: pane.tabIds.map((tabId) => idByTabId.get(tabId) ?? ""),
  }));
}

describe("ensureCdpTabInLayout", () => {
  beforeEach(() => {
    useWorkspaceLayoutStore.setState({ layoutByWorkspace: {} });
  });

  it("called twice for one browser yields one tab", () => {
    const input = { serverId: "srv", workspaceId: "ws", browserId: "b1", focus: false };
    ensureCdpTabInLayout(input);
    ensureCdpTabInLayout({ ...input, focus: true });
    expect(browserTabIds()).toEqual(["b1"]);
  });

  it("replaceTabId swaps the placeholder for the browser tab", () => {
    const placeholder = useWorkspaceLayoutStore.getState().openTab({
      workspaceKey: KEY,
      target: { kind: "browser", browserId: "old" },
      intent: "new",
    }) as string;
    ensureCdpTabInLayout({
      serverId: "srv",
      workspaceId: "ws",
      browserId: "b2",
      focus: true,
      replaceTabId: placeholder,
    });
    expect(browserTabIds()).toEqual(["b2"]);
  });

  it("replaceTabId closes the placeholder when the tab is already in the layout", () => {
    ensureCdpTabInLayout({ serverId: "srv", workspaceId: "ws", browserId: "b3", focus: false });
    const placeholder = useWorkspaceLayoutStore.getState().openTab({
      workspaceKey: KEY,
      target: { kind: "browser", browserId: "old" },
      intent: "new",
    }) as string;
    ensureCdpTabInLayout({
      serverId: "srv",
      workspaceId: "ws",
      browserId: "b3",
      focus: true,
      replaceTabId: placeholder,
    });
    expect(browserTabIds()).toEqual(["b3"]);
  });

  it("opened first: replaceTabId puts the tab at the placeholder's pane and index", () => {
    const store = useWorkspaceLayoutStore.getState();
    store.openTab({
      workspaceKey: KEY,
      target: { kind: "browser", browserId: "first" },
      intent: "new",
    });
    const placeholder = store.openTab({
      workspaceKey: KEY,
      target: { kind: "browser", browserId: "old" },
      intent: "new",
    }) as string;
    store.openTab({
      workspaceKey: KEY,
      target: { kind: "browser", browserId: "last" },
      intent: "new",
    });
    // The tabs sync adds the tab first, in the default place.
    ensureCdpTabInLayout({ serverId: "srv", workspaceId: "ws", browserId: "b4", focus: false });
    ensureCdpTabInLayout({
      serverId: "srv",
      workspaceId: "ws",
      browserId: "b4",
      focus: true,
      replaceTabId: placeholder,
    });
    expect(paneBrowserIds().map((pane) => pane.browserIds)).toEqual([["first", "b4", "last"]]);
  });

  it("opened first: paneId moves the tab into that pane", () => {
    const store = useWorkspaceLayoutStore.getState();
    store.openTab({
      workspaceKey: KEY,
      target: { kind: "browser", browserId: "first" },
      intent: "new",
    });
    const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[KEY];
    const firstPane = collectAllPanes(layout.root)[0].id;
    const otherPane = store.splitPaneEmpty(KEY, {
      targetPaneId: firstPane,
      position: "right",
    }) as string;
    ensureCdpTabInLayout({ serverId: "srv", workspaceId: "ws", browserId: "b5", focus: false });
    ensureCdpTabInLayout({
      serverId: "srv",
      workspaceId: "ws",
      browserId: "b5",
      focus: true,
      paneId: firstPane,
    });
    expect(otherPane).not.toBe(firstPane);
    expect(paneBrowserIds().find((pane) => pane.paneId === firstPane)?.browserIds).toEqual([
      "first",
      "b5",
    ]);
    expect(browserTabIds().filter((id) => id === "b5")).toHaveLength(1);
  });
});
