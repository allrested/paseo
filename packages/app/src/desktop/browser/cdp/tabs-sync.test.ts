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

import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
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
});
