// plugins/office/client/column-sheet.mounted.test.tsx
/**
 * @vitest-environment jsdom
 */
// The phone's column: a bar of the tabs under the floor and a sheet over it.
import { act, createElement, useCallback, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Text } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ColumnTab } from "./column-model.js";
import { ColumnSheet } from "./column-sheet.js";
import { useOfficeStyles } from "./styles.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { View } = await import("react-native");
  const Icon = (props: { name: string }) => createElement(View, { testID: `icon-${props.name}` });
  return { Icon };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
let container: HTMLElement;
let root: Root;

const BADGES = { attention: "1", chat: null };
const FLOOR = <Text>floor</Text>;

function Harness(): ReactNode {
  const styles = useOfficeStyles(THEME, true, true);
  const [open, setOpen] = useState<ColumnTab | null>(null);
  const close = useCallback(() => setOpen(null), []);
  return (
    <ColumnSheet
      open={open}
      badges={BADGES}
      color="#000000"
      iconSize={20}
      platform="web"
      onOpen={setOpen}
      onClose={close}
      styles={styles}
      floor={FLOOR}
    >
      <Text>{`panel:${open}`}</Text>
    </ColumnSheet>
  );
}

const mount = () => act(async () => root.render(<Harness />));

function tab(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[role="tab"][aria-label^="${label}"]`);
  if (!found) throw new Error(`No tab is labelled "${label}"`);
  return found;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("closed, there is the bar of four tabs and no sheet", async () => {
  await mount();

  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4);
  expect(tab("Attention").getAttribute("aria-label")).toBe("Attention, 1 new");
  expect(container.textContent).not.toContain("panel:");
});

test("a bar press opens the sheet on that tab, and another tab changes it", async () => {
  await mount();
  await act(async () => tab("Chat").click());
  expect(container.textContent).toContain("panel:chat");
  expect(tab("Chat").getAttribute("aria-selected")).toBe("true");

  await act(async () => tab("Sessions").click());
  expect(container.textContent).toContain("panel:sessions");
});

test("Close, a press on the floor above the sheet, and Escape each close it", async () => {
  await mount();
  for (const close of [
    () => container.querySelector<HTMLElement>('[aria-label="Close"]')?.click(),
    () => container.querySelector<HTMLElement>('[aria-label="Close the column"]')?.click(),
    () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  ]) {
    await act(async () => tab("Activity").click());
    expect(container.textContent).toContain("panel:activity");
    await act(async () => close());
    expect(container.textContent).not.toContain("panel:");
  }
});

test("the open tab's press closes the sheet", async () => {
  await mount();
  await act(async () => tab("Activity").click());
  await act(async () => tab("Activity").click());
  expect(container.textContent).not.toContain("panel:");
});
