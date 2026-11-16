/**
 * @vitest-environment jsdom
 */
// The strip, mounted: on a wide screen its cards wrap; on a phone they scroll sideways.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AttentionStrip, fadeShown, type StripCard } from "./attention-strip.js";
import type { AttentionEntry } from "./model.js";
import { useOfficeStyles } from "./styles.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { createElement } = await import("react");
  const { View } = await import("react-native");
  const ScrollView = (props: { horizontal?: boolean; children: ReactNode }) =>
    createElement(
      "div",
      { "data-scroll": props.horizontal ? "horizontal" : "vertical" },
      createElement(View, null, props.children),
    );
  return { ScrollView };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const CARDS: StripCard[] = ["Host", "Janitor", "Stand-up", "Reviews", "QA", "Library"].map(
  (title) => ({
    title,
    note: { tone: "muted", text: `${title} note` },
    onOpen: () => undefined,
  }),
);

const NO_ENTRIES: readonly AttentionEntry[] = [];
const ignore = () => undefined;

function Harness({ compact }: { compact: boolean }) {
  const styles = useOfficeStyles(THEME, compact, false);
  return (
    <AttentionStrip
      entries={NO_ENTRIES}
      cards={CARDS}
      styles={styles}
      wrap={!compact}
      onSelect={ignore}
    />
  );
}

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("wide: the cards wrap and nothing scrolls sideways", async () => {
  await act(async () => root.render(<Harness compact={false} />));
  expect(container.querySelector('[data-scroll="horizontal"]')).toBeNull();
  expect(container.textContent).toContain("Library");
});

test("phone: the cards scroll sideways", async () => {
  await act(async () => root.render(<Harness compact />));
  expect(container.querySelector('[data-scroll="horizontal"]')).not.toBeNull();
});

test("the fade shows while more cards are past the edge, and goes at the end", () => {
  expect(fadeShown({ viewport: 375, content: 600, offset: 0 })).toBe(true);
  expect(fadeShown({ viewport: 375, content: 600, offset: 223 })).toBe(true);
  expect(fadeShown({ viewport: 375, content: 600, offset: 225 })).toBe(false);
  expect(fadeShown({ viewport: 375, content: 300, offset: 0 })).toBe(false);
  expect(fadeShown({ viewport: 0, content: 0, offset: 0 })).toBe(false);
});

test("the fade goes at the end when the scroll offset falls short of a fractional width", () => {
  // Android reports the offset in whole device pixels; widths are fractional.
  expect(fadeShown({ viewport: 375, content: 600.4, offset: 225 })).toBe(false);
  expect(fadeShown({ viewport: 375.33, content: 600, offset: 224.33 })).toBe(false);
});
