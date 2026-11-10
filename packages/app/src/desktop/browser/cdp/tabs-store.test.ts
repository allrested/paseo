import { describe, expect, it } from "vitest";
import { applyTabsEvent, applyTabsSnapshot, useCdpTabsStore, type CdpHostTabs } from "./tabs-store";

const tab = (browserId: string, workspaceId: string, extra: Record<string, unknown> = {}) => ({
  browserId,
  workspaceId,
  url: "https://example.com/",
  title: "Example",
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  agentActiveUntil: null,
  ...extra,
});
const empty: CdpHostTabs = { connected: false, tabs: {} };

describe("cdp tabs store", () => {
  it("a snapshot replaces one workspace's tabs and keeps the others", () => {
    const before: CdpHostTabs = {
      connected: false,
      tabs: { old: tab("old", "ws-a"), other: tab("other", "ws-b") },
    };
    const after = applyTabsSnapshot(before, "ws-a", {
      connected: true,
      tabs: [tab("new", "ws-a")],
    });
    expect(after.connected).toBe(true);
    expect(Object.keys(after.tabs).sort()).toEqual(["new", "other"]);
  });

  it("opened and state events upsert; closed removes", () => {
    let host = applyTabsEvent(empty, { kind: "opened", tab: tab("t1", "ws-a") });
    host = applyTabsEvent(host, {
      kind: "state",
      tab: tab("t1", "ws-a", { title: "Next", agentActiveUntil: 9 }),
    });
    expect(host.tabs.t1).toMatchObject({ title: "Next", agentActiveUntil: 9 });
    host = applyTabsEvent(host, {
      kind: "closed",
      browserId: "t1",
      workspaceId: "ws-a",
      lastUrl: "https://example.com/",
    });
    expect(host.tabs).toEqual({});
  });

  it("a host event sets connected, and a lost host clears agent activity", () => {
    let host = applyTabsEvent(empty, {
      kind: "opened",
      tab: tab("t1", "ws-a", { agentActiveUntil: 9 }),
    });
    host = applyTabsEvent(host, { kind: "host", connected: false });
    expect(host.connected).toBe(false);
    expect(host.tabs.t1.agentActiveUntil).toBeNull();
    expect(applyTabsEvent(host, { kind: "host", connected: true }).connected).toBe(true);
  });

  it("the store keeps the daemon's lastUrl from a closed event until it is forgotten", () => {
    const { applyEvent, forgetLastUrl } = useCdpTabsStore.getState();
    applyEvent("srv", { kind: "opened", tab: tab("t9", "ws-a") });
    applyEvent("srv", {
      kind: "closed",
      browserId: "t9",
      workspaceId: "ws-a",
      lastUrl: "https://last.example/",
    });
    expect(useCdpTabsStore.getState().lastUrlByBrowserId.t9).toBe("https://last.example/");
    expect(useCdpTabsStore.getState().hosts.srv.tabs).toEqual({});
    forgetLastUrl("t9");
    expect(useCdpTabsStore.getState().lastUrlByBrowserId.t9).toBeUndefined();
  });

  it("a snapshot that reports the host connected clears the no-host state", () => {
    const { applySnapshot } = useCdpTabsStore.getState();
    applySnapshot("srv2", "ws-a", { connected: false, tabs: [] });
    expect(useCdpTabsStore.getState().hosts.srv2.connected).toBe(false);
    applySnapshot("srv2", "ws-a", { connected: true, tabs: [] });
    expect(useCdpTabsStore.getState().hosts.srv2.connected).toBe(true);
  });
});
