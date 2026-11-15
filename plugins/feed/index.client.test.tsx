/**
 * @vitest-environment jsdom
 */
// What the plugin adds to a client: the screen, the sidebar row with its count, and the Command
// Center item.
import { act, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import {
  PluginRpcProvider,
  type PluginSubscribe,
  type PluginSubscriptionObserver,
} from "@getpaseo/plugin/client/host";
import contribute from "./index.client.js";
import type { FeedEntry, FeedEvent } from "./shared/contracts.js";

interface RowProps {
  icon: string;
  active?: boolean;
  onPress(): void;
  trailing?: ReactNode;
}

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { Pressable, ScrollView, Text, View } = await import("react-native");
  return {
    Icon: () => null,
    ScrollView,
    SidebarRow: ({ icon, active, onPress, trailing }: RowProps) => (
      <View testID="row" accessibilityLabel={`${icon}${active ? " active" : ""}`}>
        <Pressable accessibilityRole="button" onPress={onPress}>
          <Text>Feed</Text>
        </Pressable>
        {trailing}
      </View>
    ),
  };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

interface Item {
  id: string;
  title: string;
  onSelect(actions: { openScreen(input: unknown): void }): void;
}

let observers: PluginSubscriptionObserver[];
let screens: Array<{ id: string; title: string }>;
let items: Item[];
let removed: string[];
let sidebar: ComponentType<PluginSidebarItemProps>;
let openedScreens: unknown[];
let container: HTMLElement;
let root: Root;

function fakeClient(): PluginClientContext {
  const remover = (name: string) => () => void removed.push(name);
  const client = {
    addScreen: (contribution: { id: string; title: string }) => {
      screens.push(contribution);
      return remover("screen");
    },
    addSidebarHeaderItem: (contribution: { Component: typeof sidebar }) => {
      sidebar = contribution.Component;
      return remover("sidebar");
    },
    addCommandCenterItem: (contribution: Item) => {
      items.push(contribution);
      return remover("command");
    },
  };
  return client as unknown as PluginClientContext;
}

const subscribe: PluginSubscribe = (_method, _input, observer) => {
  observers.push(observer);
  const close = () => undefined;
  return Object.assign(close, { ready: Promise.resolve(), release: async () => close() });
};
const invoke = async () => ({ seenAt: "2026-11-15T12:00:00.000Z" });

const entry = (id: string, at: string): FeedEntry => ({
  id,
  at,
  kind: "finished",
  agentId: "a1",
  title: null,
  folder: "/work/shop",
  text: null,
});

async function renderRow(currentScreen: PluginSidebarItemProps["currentScreen"] = null) {
  const Item = sidebar;
  const props = {
    theme: { colors: new Proxy({}, { get: () => "#808080" }) },
    currentScreen,
    openScreen: (input: unknown) => void openedScreens.push(input),
  } as unknown as PluginSidebarItemProps;
  await act(async () =>
    root.render(
      <PluginRpcProvider invoke={invoke} subscribe={subscribe}>
        <Item {...props} />
      </PluginRpcProvider>,
    ),
  );
}

async function send(event: FeedEvent): Promise<void> {
  await act(async () => observers[0].event(event));
}

const count = () =>
  container.querySelector("[aria-label$='new entry'], [aria-label$='new entries']");

beforeEach(() => {
  observers = [];
  screens = [];
  items = [];
  removed = [];
  openedScreens = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("the plugin adds the Feed screen, its sidebar row and a Command Center item", () => {
  const dispose = contribute(fakeClient());

  expect(screens).toEqual([expect.objectContaining({ id: "feed", title: "Feed" })]);
  expect(items).toEqual([expect.objectContaining({ id: "open-feed", title: "Open feed" })]);
  items[0].onSelect({ openScreen: (input) => void openedScreens.push(input) });
  expect(openedScreens).toEqual([{ screenId: "feed" }]);

  dispose();
  expect(removed.toSorted()).toEqual(["command", "screen", "sidebar"]);
});

test("the row shows how many entries came since the feed was last opened", async () => {
  contribute(fakeClient());
  await renderRow();
  expect(count()).toBeNull();

  await send({
    type: "state",
    state: {
      entries: [
        entry("e3", "2026-11-15T11:00:00.000Z"),
        entry("e2", "2026-11-15T10:30:00.000Z"),
        entry("e1", "2026-11-15T09:00:00.000Z"),
      ],
      seenAt: "2026-11-15T10:00:00.000Z",
    },
  });
  expect(count()?.textContent).toBe("2");
  expect(count()?.getAttribute("aria-label")).toBe("2 new entries");

  await send({ type: "added", entry: entry("e4", "2026-11-15T11:30:00.000Z") });
  expect(count()?.textContent).toBe("3");

  // The feed was opened, here or on another device.
  await send({ type: "seen", seenAt: "2026-11-15T11:45:00.000Z" });
  expect(count()).toBeNull();
});

test("pressing the row opens the feed, and the row is marked while the feed is up", async () => {
  contribute(fakeClient());
  await renderRow({ screenId: "feed", params: {} });

  await act(async () => (container.querySelector('[role="button"]') as HTMLElement).click());

  expect(openedScreens).toEqual([{ screenId: "feed" }]);
  expect(container.querySelector('[data-testid="row"]')?.getAttribute("aria-label")).toBe(
    "Inbox active",
  );
});
