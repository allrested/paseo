/**
 * @vitest-environment jsdom
 */
// The column, mounted with a stand-in for the device's setting: its tabs, its badges, its rail.
import { act, createElement, useMemo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Text } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { OfficeColumn } from "./office-column.js";
import { useOfficeStyles } from "./styles.js";
import { useColumn } from "./use-column.js";

let saves: unknown[];
let storedColumn: { width: number; collapsed: boolean };

vi.mock("@getpaseo/plugin/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/plugin/client")>()),
  useSettings: () => ({
    status: "ready",
    revision: "r1",
    values: storedColumn,
    saving: false,
    saveError: null,
    save: async (values: unknown) => {
      saves.push(values);
      return true;
    },
    reset: async () => true,
    reload: async () => undefined,
  }),
}));

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { View } = await import("react-native");
  const Icon = (props: { name: string }) => createElement(View, { testID: `icon-${props.name}` });
  return { Icon };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
let container: HTMLElement;
let root: Root;

function Harness({ chat }: { chat: string | null }): ReactNode {
  const styles = useOfficeStyles(THEME, false, false);
  const column = useColumn();
  const badges = useMemo(() => ({ attention: "2", chat }), [chat]);
  return (
    <OfficeColumn
      column={column}
      surfaceWidth={1280}
      badges={badges}
      color="#000000"
      iconSize={16}
      styles={styles}
    >
      <Text>{`panel:${column.tab}`}</Text>
    </OfficeColumn>
  );
}

async function mount(chat: string | null = null): Promise<void> {
  await act(async () => root.render(createElement(Harness, { chat })));
}

function tab(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[role="tab"][aria-label^="${label}"]`);
  if (!found) throw new Error(`No tab is labelled "${label}"`);
  return found;
}

beforeEach(() => {
  saves = [];
  storedColumn = { width: 360, collapsed: false };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("the column opens on Sessions, with four tabs in order", async () => {
  await mount();

  const labels = [...container.querySelectorAll('[role="tab"]')].map((each) =>
    each.getAttribute("aria-label"),
  );
  expect(labels).toEqual(["Attention, 2 new", "Sessions", "Activity", "Chat"]);
  expect(tab("Sessions").getAttribute("aria-selected")).toBe("true");
  expect(container.textContent).toContain("panel:sessions");
});

test("a tab press shows that tab's panel and saves nothing", async () => {
  await mount();
  await act(async () => tab("Activity").click());

  expect(tab("Activity").getAttribute("aria-selected")).toBe("true");
  expect(container.textContent).toContain("panel:activity");
  expect(saves).toEqual([]);
});

test("Chat carries its count in its name", async () => {
  await mount("3");
  expect(tab("Chat").getAttribute("aria-label")).toBe("Chat, 3 new");
});

test("Collapse leaves the rail and saves it; a rail press opens that tab again", async () => {
  await mount();
  const collapse = container.querySelector<HTMLElement>('[aria-label="Collapse the column"]');
  if (!collapse) throw new Error("There is no Collapse button");
  await act(async () => collapse.click());

  expect(container.textContent).not.toContain("panel:");
  expect(saves).toEqual([{ width: 360, collapsed: true }]);

  await act(async () => tab("Chat").click());
  expect(container.textContent).toContain("panel:chat");
  expect(saves).toEqual([
    { width: 360, collapsed: true },
    { width: 360, collapsed: false },
  ]);
});

test("a device that left the column collapsed opens the office on the rail", async () => {
  storedColumn = { width: 400, collapsed: true };
  await mount();

  expect(container.textContent).not.toContain("panel:");
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4);
});
