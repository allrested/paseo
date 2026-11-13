/**
 * @vitest-environment jsdom
 */
// What the plugin offers on a host: the sidebar row and the Command Center item appear only when
// the host answers that it has a device.
import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { PluginRpcProvider } from "@getpaseo/plugin/client/host";
import contribute from "./index.client.js";

vi.mock("@getpaseo/plugin/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/plugin/client")>()),
  useSettings: () => ({ status: "loading", saveError: null }),
}));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { Pressable, Text, TextInput } = await import("react-native");
  return {
    TextInput,
    SidebarRow: ({ onPress }: { onPress(): void }) => (
      <Pressable accessibilityLabel="Android row" onPress={onPress}>
        <Text>Android</Text>
      </Pressable>
    ),
  };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

type Answer = () => Promise<unknown>;

let stateAnswer: Answer;
let rpcAnswer: Answer;
let sidebar: ComponentType<PluginSidebarItemProps>;
let added: Array<{ id: string }>;
let removed: string[];
let cleanup: () => void = () => undefined;
let container: HTMLElement;
let root: Root;

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

function fakeClient(): PluginClientContext {
  const client = {
    rpc: () => rpcAnswer(),
    addScreen: () => () => undefined,
    addWorkspacePanel: () => () => undefined,
    addSidebarHeaderItem: (contribution: { Component: typeof sidebar }) => {
      sidebar = contribution.Component;
      return () => undefined;
    },
    addCommandCenterItem: (contribution: { id: string }) => {
      added.push(contribution);
      return () => {
        removed.push(contribution.id);
      };
    },
  };
  return client as unknown as PluginClientContext;
}

const invoke = async () => stateAnswer();
const subscribe = () => undefined as never;
const ITEM_PROPS = { openScreen: () => undefined } as unknown as PluginSidebarItemProps;

async function renderSidebar(): Promise<void> {
  cleanup = contribute(fakeClient()) as () => void;
  const Item = sidebar;
  await act(async () =>
    root.render(
      <PluginRpcProvider invoke={invoke} subscribe={subscribe}>
        <Item {...ITEM_PROPS} />
      </PluginRpcProvider>,
    ),
  );
  await settle();
}

beforeEach(() => {
  added = [];
  removed = [];
  stateAnswer = async () => ({ available: true, agentTools: true });
  rpcAnswer = async () => ({ available: true, agentTools: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  cleanup = () => undefined;
});

afterEach(() => {
  cleanup();
  act(() => root.unmount());
  container.remove();
});

test("the sidebar row shows when the host has a device", async () => {
  await renderSidebar();
  expect(container.querySelector('[aria-label="Android row"]')).not.toBeNull();
});

test("the sidebar row is absent when the host has no device", async () => {
  stateAnswer = async () => ({ available: false, agentTools: false });
  await renderSidebar();
  expect(container.innerHTML).toBe("");
});

test("the sidebar row is absent while the state call is loading", async () => {
  stateAnswer = () => new Promise(() => undefined);
  await renderSidebar();
  expect(container.innerHTML).toBe("");
});

test("the sidebar row is absent when the state call fails or is not served", async () => {
  stateAnswer = async () => {
    throw new Error("Unknown RPC method: android.state.request");
  };
  await renderSidebar();
  expect(container.innerHTML).toBe("");
});

test("the Command Center item is added once the host answers it has a device", async () => {
  cleanup = contribute(fakeClient()) as () => void;
  expect(added).toEqual([]);
  await settle();
  expect(added.map((item) => item.id)).toEqual(["open-android"]);
});

test("no Command Center item on a host with no device or a failing call", async () => {
  rpcAnswer = async () => ({ available: false, agentTools: false });
  cleanup = contribute(fakeClient()) as () => void;
  await settle();
  cleanup();
  rpcAnswer = async () => {
    throw new Error("Unknown RPC method: android.state.request");
  };
  cleanup = contribute(fakeClient()) as () => void;
  await settle();
  expect(added).toEqual([]);
});

test("the Command Center item is removed with the plugin, and not added after it stopped", async () => {
  let answer: (value: unknown) => void = () => undefined;
  rpcAnswer = () => new Promise((resolve) => (answer = resolve));
  cleanup = contribute(fakeClient()) as () => void;
  cleanup();
  answer({ available: true, agentTools: true });
  await settle();
  expect(added).toEqual([]);

  rpcAnswer = async () => ({ available: true, agentTools: true });
  cleanup = contribute(fakeClient()) as () => void;
  await settle();
  cleanup();
  expect(removed).toEqual(["open-android"]);
});
