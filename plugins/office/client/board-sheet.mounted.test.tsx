/**
 * @vitest-environment jsdom
 */
// A board's sheet, mounted: its form, the page that chooses who a post wakes, and what is posted.
// The sheet, the inputs and the icon are the host's, so plain stand-ins show what they were given.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeAgent, OfficeSnapshot } from "../shared/contracts.js";
import { BoardSheet } from "./board-sheet.js";
import { buildOfficeModel, type OfficeRoom } from "./model.js";
import { useOfficeStyles } from "./styles.js";
import type { BoardActions } from "./use-board-actions.js";

/** What the host's sheet does when it is closed: Escape, its close button, a swipe. */
let dismiss: () => void = () => undefined;

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView, TextInput } = await import("react-native");
  const Modal = (props: {
    title: string;
    open: boolean;
    onOpenChange(open: boolean): void;
    children: ReactNode;
  }) => {
    dismiss = () => props.onOpenChange(false);
    return props.open
      ? createElement("section", { "aria-label": props.title }, props.children)
      : null;
  };
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  const Icon = () => null;
  return { Icon, Modal, ScrollView, TextInput };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

function agent(id: string, patch: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: `Agent ${id}`,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: `2026-11-16T00:00:${id.padStart(2, "0")}Z`,
    ...patch,
  };
}

function officeRooms(agents: OfficeAgent[]): OfficeRoom[] {
  const snapshot: OfficeSnapshot = {
    agents,
    workspaces: [
      { id: "w1", name: "shop-api", projectName: "shop" },
      { id: "w2", name: "landing", projectName: "site" },
    ],
    activity: {},
    doing: {},
    boards: {},
    wake: { paused: false, queued: {} },
  };
  return buildOfficeModel(snapshot).rooms;
}

let posted: Array<Parameters<BoardActions["post"]>[0]>;
/** Set to make the host refuse the post. */
let refusal: Error | null;
let closed: number;

const ACTIONS: BoardActions = {
  post: async (input) => {
    if (refusal) throw refusal;
    posted.push(input);
  },
  markDone: async () => undefined,
  remove: async () => undefined,
  setWakesPaused: async () => undefined,
};
const nameOf = (author: string) => author;
const onClose = () => {
  closed += 1;
};

interface HarnessProps {
  rooms: OfficeRoom[];
  compact?: boolean;
  wakesPaused?: boolean;
}

function Harness({ rooms, compact = false, wakesPaused = false }: HarnessProps) {
  const styles = useOfficeStyles(THEME, compact, false);
  return (
    <BoardSheet
      room={rooms.find((room) => room.id === "w1") ?? null}
      rooms={rooms}
      name={nameOf}
      actions={ACTIONS}
      wakesPaused={wakesPaused}
      compact={compact}
      styles={styles}
      onClose={onClose}
    />
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  posted = [];
  refusal = null;
  closed = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (props: HarnessProps) => act(async () => root.render(<Harness {...props} />));
const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));
const title = () => container.querySelector("section")?.getAttribute("aria-label");

function byLabel(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`Nothing is labelled "${label}"`);
  return found;
}

async function press(label: string): Promise<void> {
  await act(async () => byLabel(label).click());
  await settle();
}

async function type(label: string, text: string): Promise<void> {
  const field = byLabel(label);
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const radios = () =>
  [...container.querySelectorAll('[role="radio"]')].map((row) => row.getAttribute("aria-label"));

test("the form's row opens the page, which has the room's agents first", async () => {
  await mount({
    rooms: officeRooms([
      agent("1", { workspaceId: null }),
      agent("2"),
      agent("3", { workspaceId: "w2", status: "running" }),
    ]),
  });
  expect(title()).toBe("shop-api board");

  await press("Wake an agent with it: Nobody");

  expect(title()).toBe("Wake an agent");
  expect(radios()).toEqual([
    "Nobody: The post wakes no agent",
    "Agent 2: shop-api · Idle",
    "Agent 1: Lobby · Idle",
    "Agent 3: landing · Running",
  ]);
  expect(container.textContent).toContain("This room");
  expect(container.textContent).toContain("Other rooms");
  expect(container.querySelector('[aria-label="Search agents"]')).toBeNull();
});

test("a chosen agent is on the form with the text kept, and the post names it", async () => {
  await mount({ rooms: officeRooms([agent("1"), agent("2", { title: "Builder" })]) });
  await type("Task text", "Ship it");
  await press("Wake an agent with it: Nobody");

  await press("Builder: shop-api · Idle");

  expect(title()).toBe("shop-api board");
  expect((byLabel("Task text") as HTMLTextAreaElement).value).toBe("Ship it");
  await press("Wake an agent with it: Builder");
  expect(byLabel("Builder: shop-api · Idle").getAttribute("aria-checked")).toBe("true");
  await press("Back");

  await press("Post");

  expect(posted).toEqual([{ board: "w1", kind: "task", text: "Ship it", to: "2" }]);
  // A post that was sent starts the next one from nobody.
  byLabel("Wake an agent with it: Nobody");
});

test("a post the host refuses keeps the text and the chosen agent", async () => {
  await mount({ rooms: officeRooms([agent("2", { title: "Builder" })]) });
  await type("Task text", "Ship it");
  await press("Wake an agent with it: Nobody");
  await press("Builder: shop-api · Idle");
  refusal = new Error("the board is full");

  await press("Post");

  expect(posted).toEqual([]);
  expect(container.textContent).toContain("Unable to post: the board is full");
  expect((byLabel("Task text") as HTMLTextAreaElement).value).toBe("Ship it");
  byLabel("Wake an agent with it: Builder");
});

test("Back returns to the form without a change", async () => {
  await mount({ rooms: officeRooms([agent("1")]) });
  await press("Wake an agent with it: Nobody");

  await press("Back");

  expect(title()).toBe("shop-api board");
  byLabel("Wake an agent with it: Nobody");
});

test("from nine agents a search keeps the ones whose title or room has the words", async () => {
  const nine = Array.from({ length: 9 }, (_, index) =>
    agent(String(index + 1), index === 8 ? { workspaceId: "w2", title: "Copy" } : {}),
  );
  await mount({ rooms: officeRooms(nine) });
  await press("Wake an agent with it: Nobody");
  expect(radios()).toHaveLength(10);

  await type("Search agents", "landing");
  expect(radios()).toEqual(["Nobody: The post wakes no agent", "Copy: landing · Idle"]);

  await type("Search agents", "zzz");
  expect(container.textContent).toContain("No agent matches.");
});

test("thirty agents are all on the page", async () => {
  const thirty = Array.from({ length: 30 }, (_, index) => agent(String(index + 1)));
  await mount({ rooms: officeRooms(thirty) });
  await press("Wake an agent with it: Nobody");
  expect(radios()).toHaveLength(31);
});

test("a close from the page goes back on a wide sheet and closes a phone's", async () => {
  const rooms = officeRooms([agent("1")]);
  await mount({ rooms });
  await press("Wake an agent with it: Nobody");

  await act(async () => dismiss());
  expect(title()).toBe("shop-api board");
  expect(closed).toBe(0);
  await act(async () => dismiss());
  expect(closed).toBe(1);

  await mount({ rooms, compact: true });
  await press("Wake an agent with it: Nobody");
  await act(async () => dismiss());
  expect(closed).toBe(2);
});

test("a chosen agent that leaves the office is nobody again", async () => {
  await mount({ rooms: officeRooms([agent("1"), agent("2", { title: "Builder" })]) });
  await press("Wake an agent with it: Nobody");
  await press("Builder: shop-api · Idle");
  byLabel("Wake an agent with it: Builder");

  await mount({ rooms: officeRooms([agent("1")]) });

  byLabel("Wake an agent with it: Nobody");
});

test("with wakes off the form says that a named agent waits", async () => {
  await mount({ rooms: officeRooms([agent("2", { title: "Builder" })]), wakesPaused: true });
  expect(container.textContent).not.toContain("Wake agents is off");
  await press("Wake an agent with it: Nobody");
  await press("Builder: shop-api · Idle");
  expect(container.textContent).toContain(
    "Wake agents is off. The agent gets this post when you turn it on.",
  );
});
