import { beforeEach, describe, expect, it } from "vitest";
import { besideTabId, sameBesideTarget, useBesideStore } from "./store";

const agentOne = { kind: "agent", agentId: "agent-1", serverId: "server" } as const;
const agentTwo = { kind: "agent", agentId: "agent-2", serverId: "server" } as const;
const resources = {
  kind: "screen",
  pluginId: "resource-manager",
  screenId: "resources",
  serverId: "server",
} as const;

beforeEach(() => {
  useBesideStore.setState(useBesideStore.getInitialState(), true);
});

describe("beside store", () => {
  it("replaces the area's target and grows its revision when a different agent is shown", () => {
    const { show } = useBesideStore.getState();
    show("office", agentOne);
    const first = useBesideStore.getState().areas.office!.revision;
    show("office", agentTwo);
    const replaced = useBesideStore.getState().areas.office!;
    expect(replaced.target).toBe(agentTwo);
    expect(replaced.revision).toBeGreaterThan(first);
  });

  it("keeps the revision when the same agent is shown again", () => {
    const { show } = useBesideStore.getState();
    show("office", agentOne);
    const first = useBesideStore.getState().areas.office!.revision;
    show("office", { ...agentOne });
    expect(useBesideStore.getState().areas.office).toEqual({ target: agentOne, revision: first });
  });

  it("removes the area on close and reopens it at a higher revision", () => {
    const { show, close } = useBesideStore.getState();
    show("office", agentOne);
    show("office", agentTwo);
    const beforeClose = useBesideStore.getState().areas.office!.revision;
    close("office");
    expect(useBesideStore.getState().areas).toEqual({});
    show("office", agentOne);
    const reopened = useBesideStore.getState().areas.office!;
    expect(reopened.target).toBe(agentOne);
    expect(reopened.revision).toBeGreaterThan(beforeClose);
  });

  it("does nothing when an unknown area is closed", () => {
    useBesideStore.getState().show("office", agentOne);
    const before = useBesideStore.getState();
    useBesideStore.getState().close("unknown");
    expect(useBesideStore.getState()).toBe(before);
  });

  it("holds one area per surface key", () => {
    const { show } = useBesideStore.getState();
    show("office", agentOne);
    show("panel:tab-1", resources);
    expect(useBesideStore.getState().areas).toEqual({
      office: { target: agentOne, revision: expect.any(Number) },
      "panel:tab-1": { target: resources, revision: expect.any(Number) },
    });
  });

  it("starts with no width and keeps one width for every area", () => {
    expect(useBesideStore.getState().width).toBeNull();
    const { show, setWidth } = useBesideStore.getState();
    show("office", agentOne);
    show("panel:tab-1", resources);
    setWidth(400);
    expect(useBesideStore.getState().width).toBe(400);
  });
});

describe("sameBesideTarget", () => {
  it("compares agents by server and agent", () => {
    expect(sameBesideTarget(agentOne, { ...agentOne })).toBe(true);
    expect(sameBesideTarget(agentOne, agentTwo)).toBe(false);
    expect(sameBesideTarget(agentOne, { ...agentOne, serverId: "other" })).toBe(false);
  });

  it("compares screens by server, plugin, screen and the JSON of params", () => {
    const withParams = { ...resources, params: { tab: "disk" } };
    expect(sameBesideTarget(withParams, { ...resources, params: { tab: "disk" } })).toBe(true);
    expect(sameBesideTarget(withParams, { ...resources, params: { tab: "memory" } })).toBe(false);
    expect(sameBesideTarget(withParams, resources)).toBe(false);
  });

  it("never matches an agent with a screen", () => {
    expect(sameBesideTarget(agentOne, resources)).toBe(false);
  });
});

describe("besideTabId", () => {
  it("names the area's tab after its surface key", () => {
    expect(besideTabId("office")).toBe("beside:office");
  });
});
