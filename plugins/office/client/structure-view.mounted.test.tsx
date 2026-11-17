/**
 * @vitest-environment jsdom
 */
// The List view, mounted: its bar of tabs and search over the room cards, and each row's context,
// time and cost. The kit's scroller and field are the host's, so React Native's stand in.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeAgent } from "../shared/contracts.js";
import type { OfficeRoom, OfficeRow } from "../shared/model.js";
import { StructureView } from "./structure-view.js";
import { useOfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView, TextInput } = await import("react-native");
  return { ScrollView, TextInput };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const AT = Date.parse("2026-11-17T09:00:00.000Z");
const ago = (seconds: number) => new Date(AT - seconds * 1000).toISOString();

function agent(overrides: Partial<OfficeAgent>): OfficeAgent {
  return {
    id: "a1",
    title: "Ali",
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-17T08:00:00.000Z",
    ...overrides,
  };
}

function row(overrides: Partial<OfficeAgent>, depth: 0 | 1 = 0): OfficeRow {
  return { agent: agent(overrides), depth, activity: null, step: null, waitingOn: 0 };
}

function shop(rows: OfficeRow[]): OfficeRoom {
  return {
    id: "w1",
    name: "shop-api",
    subtitle: "Shop",
    lobby: false,
    workspace: { id: "w1", name: "shop-api", projectName: "Shop", branch: "feat/cart" },
    rows,
    posts: [],
    todos: [],
  };
}

function lobby(rows: OfficeRow[]): OfficeRoom {
  return {
    id: "lobby",
    name: "Lobby",
    subtitle: null,
    lobby: true,
    workspace: null,
    rows,
    posts: [],
    todos: [],
  };
}

const ALI = row({
  id: "a1",
  title: "Ali",
  status: "running",
  context: { usedTokens: 62, maxTokens: 100 },
  promptedAt: ago(4 * 60 + 12),
  costUsd: 0.42,
});
const SARA = row({ id: "a2", title: "Sara", status: "idle", idleSince: ago(5 * 60) });
const BOB = row({ id: "a3", title: "Bob", status: "error", workspaceId: null });
const OFFICE = [lobby([BOB]), shop([ALI, SARA])];

const nameOf = (author: string) => author;
const ignore = () => undefined;
const ACTIONS: AgentActions = {
  send: async () => undefined,
  respond: async () => undefined,
  cancel: async () => undefined,
};

function Harness({ rooms }: { rooms: readonly OfficeRoom[] }) {
  const styles = useOfficeStyles(THEME, false, false);
  return (
    <StructureView
      rooms={rooms}
      styles={styles}
      actions={ACTIONS}
      name={nameOf}
      compact={false}
      onSelectAgent={ignore}
      onOpenBoard={ignore}
    />
  );
}

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  // The row's clock reads the time and ticks on an interval: both are the test's.
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(AT);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const mount = (rooms: readonly OfficeRoom[]) =>
  act(async () => root.render(<Harness rooms={rooms} />));

/** Every line of text the view shows, in order; the button's hidden width spacer is left out. */
function lines(): string[] {
  return [...container.querySelectorAll("*")]
    .filter((element) => element.childElementCount === 0 && element.textContent !== "")
    .filter((element) => element.closest('[aria-hidden="true"]') === null)
    .map((element) => element.textContent ?? "");
}

function labelled(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`Nothing is labelled "${label}"`);
  return found;
}

const search = () => labelled("Search agents") as HTMLInputElement;

async function type(text: string): Promise<void> {
  const input = search();
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Presses a key on an element; true when nothing took it (its default was not prevented). */
async function key(target: Element, name: string): Promise<boolean> {
  let typed = true;
  await act(async () => {
    typed = target.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });
  return typed;
}

const BAR = ["All", "3", "Needs you", "1", "Working", "1", "Resting", "1"];
const LOBBY_CARD = ["Lobby", "Bob", "Error", "claude", "To-do", "No to-dos", "Open board"];

test("the tabs show their counts, and a tab leaves out rooms with no match", async () => {
  await mount(OFFICE);
  expect(labelled("All (3)").getAttribute("role")).toBe("tab");
  expect(labelled("All (3)").getAttribute("aria-selected")).toBe("true");
  expect(labelled("Working (1)").getAttribute("aria-selected")).toBe("false");
  expect(labelled("Resting (1)").getAttribute("aria-selected")).toBe("false");
  expect(lines()).toContain("shop-api");

  await act(async () => labelled("Needs you (1)").click());

  expect(labelled("Needs you (1)").getAttribute("aria-selected")).toBe("true");
  expect(labelled("All (3)").getAttribute("aria-selected")).toBe("false");
  expect(lines()).toEqual([...BAR, ...LOBBY_CARD]);
});

test("a search keeps a matching sub-agent at the top level when its parent does not match", async () => {
  const child = row(
    { id: "a4", name: "Ali-1", title: "Fix the tests", status: "idle", parentAgentId: "a1" },
    1,
  );
  await mount([shop([ALI, child])]);
  // A child's text starts on its parent's text rail: the row pads 16 and the dot's rail 20 more.
  const indent = () => getComputedStyle(labelled("Ali-1: Idle")).paddingLeft;
  expect(indent()).toBe("36px");

  await type("tests");

  expect(lines()).not.toContain("Ali");
  expect(lines()).toContain("Ali-1");
  expect(indent()).toBe("16px");
});

test("nothing found says No agent matches.", async () => {
  await mount(OFFICE);
  await type("nobody here");
  expect(lines()).toEqual([...BAR, "No agent matches."]);
});

test("Escape in the search clears it", async () => {
  await mount(OFFICE);
  await type("bob");
  expect(lines()).not.toContain("shop-api");

  await key(search(), "Escape");

  expect(search().value).toBe("");
  expect(lines()).toContain("shop-api");
});

test("a slash typed in the search field is typed, not taken", async () => {
  await mount(OFFICE);
  // Outside a field, the slash goes to the search.
  expect(await key(document.body, "/")).toBe(false);
  expect(document.activeElement).toBe(search());

  // In the field, it is the field's.
  expect(await key(search(), "/")).toBe(true);
  expect(document.activeElement).toBe(search());
});

test("a row shows its context, time and cost, and says them in its label", async () => {
  await mount([shop([ALI])]);
  const ali = labelled("Ali: Running, context 62%, 4:12, $0.42");
  expect(ali.getAttribute("role")).toBe("button");
  expect(lines()).toEqual([
    "All",
    "1",
    "Needs you",
    "0",
    "Working",
    "1",
    "Resting",
    "0",
    "shop-api",
    "Shop",
    "Ali",
    "Running",
    "claude · feat/cart",
    "62%",
    "4:12",
    "$0.42",
    "Board",
    "No posts",
    "Open board",
  ]);
});
