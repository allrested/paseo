import { describe, expect, test } from "vitest";

import { BROWSER_AUTOMATION_COMMAND_NAMES } from "./browser-automation/rpc-schemas.js";
import { CLIENT_CAPS } from "./client-capabilities.js";
import {
  MutableDaemonConfigPatchSchema,
  MutableDaemonConfigSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  WSHelloMessageSchema,
} from "./messages.js";

describe("browser automation protocol integration", () => {
  const browserId = "11111111-1111-4111-8111-111111111111";

  test("browser host capability parses supported commands in hello", () => {
    expect(
      WSHelloMessageSchema.parse({
        type: "hello",
        clientId: "client-1",
        clientType: "mobile",
        protocolVersion: 1,
        capabilities: {
          [CLIENT_CAPS.browserHost]: {
            supportedCommands: [...BROWSER_AUTOMATION_COMMAND_NAMES],
            hostKind: "desktop app",
          },
        },
      }).capabilities,
    ).toMatchObject({
      [CLIENT_CAPS.browserHost]: {
        supportedCommands: [...BROWSER_AUTOMATION_COMMAND_NAMES],
        hostKind: "desktop app",
      },
    });
  });

  test("browser host capability requires at least one supported command", () => {
    expect(() =>
      WSHelloMessageSchema.parse({
        type: "hello",
        clientId: "client-1",
        clientType: "mobile",
        protocolVersion: 1,
        capabilities: {
          [CLIENT_CAPS.browserHost]: {
            supportedCommands: [],
            hostKind: "desktop app",
          },
        },
      }),
    ).toThrow();

    expect(() =>
      WSHelloMessageSchema.parse({
        type: "hello",
        clientId: "client-2",
        clientType: "mobile",
        protocolVersion: 1,
        capabilities: {
          [CLIENT_CAPS.browserHost]: {},
        },
      }),
    ).toThrow();

    expect(() =>
      WSHelloMessageSchema.parse({
        type: "hello",
        clientId: "client-3",
        clientType: "mobile",
        protocolVersion: 1,
        capabilities: {
          [CLIENT_CAPS.browserHost]: {
            supportedCommands: ["future_command"],
          },
        },
      }),
    ).toThrow();
  });

  test("browser host capability ignores unknown future commands when known commands remain", () => {
    expect(
      WSHelloMessageSchema.parse({
        type: "hello",
        clientId: "client-1",
        clientType: "mobile",
        protocolVersion: 1,
        capabilities: {
          [CLIENT_CAPS.browserHost]: {
            supportedCommands: ["list_tabs", "future_command", "list_tabs"],
            hostKind: "desktop app",
          },
        },
      }).capabilities,
    ).toMatchObject({
      [CLIENT_CAPS.browserHost]: {
        supportedCommands: ["list_tabs"],
        hostKind: "desktop app",
      },
    });
  });

  test("browser host capability accepts new tool commands as supported commands", () => {
    expect(
      WSHelloMessageSchema.parse({
        type: "hello",
        clientId: "client-1",
        clientType: "mobile",
        protocolVersion: 1,
        capabilities: {
          [CLIENT_CAPS.browserHost]: {
            supportedCommands: ["evaluate", "scroll", "resize", "close_tab"],
            hostKind: "desktop app",
          },
        },
      }).capabilities,
    ).toMatchObject({
      [CLIENT_CAPS.browserHost]: {
        supportedCommands: ["evaluate", "scroll", "resize", "close_tab"],
        hostKind: "desktop app",
      },
    });
  });

  test("hello remains valid when no browser host capability is advertised", () => {
    expect(
      WSHelloMessageSchema.parse({
        type: "hello",
        clientId: "old-client",
        clientType: "mobile",
        protocolVersion: 1,
      }).capabilities,
    ).toBeUndefined();
  });

  test("daemon to browser host execute request is an outbound session message", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "browser.automation.execute.request",
      requestId: "req-1",
      command: { command: "snapshot", args: { browserId } },
    });

    expect(parsed.type).toBe("browser.automation.execute.request");
  });

  test("browser host to daemon execute response is an inbound session message", () => {
    const parsed = SessionInboundMessageSchema.parse({
      type: "browser.automation.execute.response",
      payload: {
        requestId: "req-1",
        ok: true,
        result: { command: "list_tabs", tabs: [] },
      },
    });

    expect(parsed.type).toBe("browser.automation.execute.response");
  });

  test("mutable daemon config defaults browser tools off and accepts opt-in patches", () => {
    expect(
      MutableDaemonConfigSchema.parse({
        mcp: { injectIntoAgents: false },
      }).browserTools,
    ).toEqual({ enabled: false });

    expect(
      MutableDaemonConfigPatchSchema.parse({
        browserTools: { enabled: true },
      }).browserTools,
    ).toEqual({ enabled: true });
  });
});

const CDP_TAB = {
  browserId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "ws-a",
  url: "https://example.com/",
  title: "Example",
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  agentActiveUntil: null,
};

describe("browser.cdp messages", () => {
  test("parses every inbound request", () => {
    const messages = [
      { type: "browser.cdp.tab.open.request", requestId: "r1", workspaceId: "ws-a" },
      {
        type: "browser.cdp.tab.open.request",
        requestId: "r1",
        workspaceId: "ws-a",
        url: "https://example.com/",
      },
      { type: "browser.cdp.tab.close.request", requestId: "r2", browserId: CDP_TAB.browserId },
      { type: "browser.cdp.tabs.subscribe.request", requestId: "r3" },
      { type: "browser.cdp.tabs.subscribe.request", requestId: "r3", workspaceId: "ws-a" },
      {
        type: "browser.cdp.view.subscribe.request",
        requestId: "r4",
        browserId: CDP_TAB.browserId,
        width: 390,
        height: 700,
        deviceScaleFactor: 2,
      },
      {
        type: "browser.cdp.view.navigate.request",
        requestId: "r5",
        browserId: CDP_TAB.browserId,
        action: { kind: "url", url: "https://example.com/" },
      },
      {
        type: "browser.cdp.view.navigate.request",
        requestId: "r5",
        browserId: CDP_TAB.browserId,
        action: { kind: "back" },
      },
      {
        type: "browser.cdp.view.input.request",
        subscriptionId: "s1",
        input: {
          kind: "mouse",
          type: "down",
          x: 10,
          y: 20,
          button: "left",
          buttons: 1,
          clickCount: 1,
          modifiers: 0,
        },
        viewport: { width: 390, height: 700, deviceScaleFactor: 2 },
      },
      {
        type: "browser.cdp.view.input.request",
        subscriptionId: "s1",
        input: { kind: "wheel", x: 1, y: 2, deltaX: 0, deltaY: 120, modifiers: 0 },
      },
      {
        type: "browser.cdp.view.input.request",
        subscriptionId: "s1",
        input: { kind: "key", type: "down", key: "a", code: "KeyA", text: "a", modifiers: 0 },
      },
      {
        type: "browser.cdp.view.input.request",
        subscriptionId: "s1",
        input: { kind: "text", text: "hello" },
      },
      {
        type: "browser.cdp.view.input.request",
        subscriptionId: "s1",
        input: { kind: "resize" },
        viewport: { width: 390, height: 700, deviceScaleFactor: 2 },
      },
    ];
    for (const message of messages) {
      expect(SessionInboundMessageSchema.parse(message)).toEqual(message);
    }
  });

  test("parses every outbound message", () => {
    const messages = [
      {
        type: "browser.cdp.tab.open.response",
        payload: { requestId: "r1", tab: CDP_TAB, error: null },
      },
      {
        type: "browser.cdp.tab.open.response",
        payload: { requestId: "r1", tab: null, error: "browser_no_host" },
      },
      { type: "browser.cdp.tab.close.response", payload: { requestId: "r2", error: null } },
      {
        type: "browser.cdp.tabs.subscribe.response",
        payload: {
          requestId: "r3",
          subscriptionId: "s0",
          connected: true,
          tabs: [CDP_TAB],
          error: null,
        },
      },
      {
        type: "browser.cdp.tabs.update",
        payload: { subscriptionId: "s0", event: { kind: "opened", tab: CDP_TAB } },
      },
      {
        type: "browser.cdp.tabs.update",
        payload: {
          subscriptionId: "s0",
          event: { kind: "state", tab: { ...CDP_TAB, agentActiveUntil: 123 } },
        },
      },
      {
        type: "browser.cdp.tabs.update",
        payload: {
          subscriptionId: "s0",
          event: {
            kind: "closed",
            browserId: CDP_TAB.browserId,
            workspaceId: "ws-a",
            lastUrl: "https://example.com/",
          },
        },
      },
      {
        type: "browser.cdp.tabs.update",
        payload: { subscriptionId: "s0", event: { kind: "host", connected: false } },
      },
      {
        type: "browser.cdp.view.subscribe.response",
        payload: { requestId: "r4", subscriptionId: "s1", error: null },
      },
      {
        type: "browser.cdp.view.update",
        payload: { subscriptionId: "s1", error: "browser_timeout" },
      },
      { type: "browser.cdp.view.navigate.response", payload: { requestId: "r5", error: null } },
    ];
    for (const message of messages) {
      expect(SessionOutboundMessageSchema.parse(message)).toEqual(message);
    }
  });

  test("rejects an input kind it does not know", () => {
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "browser.cdp.view.input.request",
        subscriptionId: "s1",
        input: { kind: "pinch", scale: 2 },
      }).success,
    ).toBe(false);
  });
});
