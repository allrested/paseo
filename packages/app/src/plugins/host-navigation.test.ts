import { describe, expect, it } from "vitest";
import { createPluginHostNavigation, type ResolvedBesideTarget } from "./host-navigation-model";

describe("plugin host navigation", () => {
  function setup(electron = true) {
    const destinations: unknown[] = [];
    const browsers: string[] = [];
    const workspaces = new Set(["selected:one", "remote:two"]);
    const navigation = createPluginHostNavigation("selected", {
      browserAvailable: electron,
      resolveWorkspace: ({ serverId, workspaceId }) =>
        workspaces.has(`${serverId}:${workspaceId}`) ? workspaceId : null,
      openAgent: (input) => destinations.push(input),
      openWorkspace: (input) => destinations.push(input),
      createBrowser: ({ initialUrl }) => {
        browsers.push(initialUrl);
        return { browserId: `browser-${browsers.length}` };
      },
    });
    return { navigation, destinations, browsers, workspaces };
  }

  it("creates and focuses a local browser in the selected or explicit host workspace", () => {
    const { navigation, destinations, browsers } = setup();
    navigation.openBrowser!({ url: "https://example.com/one", workspaceId: "one" });
    navigation.openBrowser!({
      url: "https://example.com/two",
      workspaceId: "two",
      serverId: "remote",
    });
    expect(browsers).toEqual(["https://example.com/one", "https://example.com/two"]);
    expect(destinations).toEqual([
      {
        serverId: "selected",
        workspaceId: "one",
        target: { kind: "browser", browserId: "browser-1" },
      },
      {
        serverId: "remote",
        workspaceId: "two",
        target: { kind: "browser", browserId: "browser-2" },
      },
    ]);
  });

  it("refuses unknown or removed workspaces before creating browser records", () => {
    const { navigation, destinations, browsers, workspaces } = setup();
    expect(() =>
      navigation.openBrowser!({ url: "https://example.com", workspaceId: "missing" }),
    ).toThrow("Workspace is unavailable");
    expect(() =>
      navigation.openBrowser!({
        url: "https://example.com",
        workspaceId: "one",
        serverId: "unknown",
      }),
    ).toThrow("Workspace is unavailable");
    workspaces.delete("selected:one");
    expect(() =>
      navigation.openBrowser!({ url: "https://example.com", workspaceId: "one" }),
    ).toThrow("Workspace is unavailable");
    expect(destinations).toEqual([]);
    expect(browsers).toEqual([]);
  });

  it("exposes no browser capability outside Electron and creates no tabs", () => {
    const { navigation, destinations, browsers } = setup(false);
    expect(navigation.openBrowser).toBeUndefined();
    expect(destinations).toEqual([]);
    expect(browsers).toEqual([]);
  });

  it.each(["javascript:alert(1)", "file:///tmp/file", "/relative", "invalid"])(
    "rejects %s before creating a browser",
    (url) => {
      const { navigation, browsers, destinations } = setup();
      expect(() => navigation.openBrowser!({ url, workspaceId: "one" })).toThrow("HTTP(S)");
      expect(browsers).toEqual([]);
      expect(destinations).toEqual([]);
    },
  );

  it("rejects an empty workspace before creating a browser", () => {
    const { navigation, browsers } = setup();
    expect(() => navigation.openBrowser!({ url: "https://example.com", workspaceId: "" })).toThrow(
      "workspaceId",
    );
    expect(browsers).toEqual([]);
  });

  describe("showBeside", () => {
    function besideSetup(serverId: string, answers: boolean[]) {
      const targets: ResolvedBesideTarget[] = [];
      const navigation = createPluginHostNavigation(serverId, {
        browserAvailable: false,
        resolveWorkspace: () => null,
        openAgent: () => {},
        openWorkspace: () => {},
        createBrowser: () => ({ browserId: "unused" }),
        showBeside: (target) => {
          targets.push(target);
          return answers[targets.length - 1] ?? false;
        },
      });
      return { navigation, targets };
    }

    it("exposes no showBeside when the owner has none", () => {
      const { navigation } = setup();
      expect(navigation.showBeside).toBeUndefined();
    });

    it("fills the surface's host into a showBeside target", () => {
      const { navigation, targets } = besideSetup("s1", [true, false]);
      expect(navigation.showBeside!({ kind: "agent", agentId: "a1" })).toBe(true);
      expect(navigation.showBeside!({ kind: "agent", agentId: "a1" })).toBe(false);
      expect(targets).toEqual([
        { kind: "agent", agentId: "a1", serverId: "s1" },
        { kind: "agent", agentId: "a1", serverId: "s1" },
      ]);
    });

    it("keeps an explicit serverId", () => {
      const { navigation, targets } = besideSetup("s1", [true]);
      navigation.showBeside!({
        kind: "screen",
        pluginId: "resource-manager",
        screenId: "resources",
        serverId: "s2",
      });
      expect(targets).toEqual([
        { kind: "screen", pluginId: "resource-manager", screenId: "resources", serverId: "s2" },
      ]);
    });
  });
});
