/**
 * @vitest-environment jsdom
 */
// A board's sheet, mounted: its form, the page that chooses who a post wakes, and what is posted;
// on the lobby, the to-do list and the agents' tasks.
// The sheet, the inputs and the icon are the host's, so plain stand-ins show what they were given.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeAgent, OfficeSnapshot, Post } from "../shared/contracts.js";
import { BoardSheet } from "./board-sheet.js";
import { buildOfficeModel, type AgentTaskGroup, type OfficeRoom } from "../shared/model.js";
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

function officeRooms(agents: OfficeAgent[], boards: OfficeSnapshot["boards"] = {}): OfficeRoom[] {
  const snapshot: OfficeSnapshot = {
    agents,
    workspaces: [
      { id: "w1", name: "shop-api", projectName: "shop" },
      { id: "w2", name: "landing", projectName: "site" },
    ],
    activity: {},
    doing: {},
    boards,
    wake: { paused: false, queued: {} },
  };
  return buildOfficeModel(snapshot).rooms;
}

function post(seq: number, fields: Partial<Post>): Post {
  const at = `2026-11-17T09:00:${String(seq).padStart(2, "0")}.000Z`;
  return {
    id: `p${seq}`,
    seq,
    board: "lobby",
    kind: "task",
    text: `To-do ${seq}`,
    author: "user",
    state: "open",
    createdAt: at,
    updatedAt: at,
    ...fields,
  };
}

/** The office with these posts on the lobby's board. */
function lobbyRooms(posts: Post[], agents: OfficeAgent[] = []): OfficeRoom[] {
  return officeRooms(agents, { lobby: posts });
}

let posted: Array<Parameters<BoardActions["post"]>[0]>;
/** The board changes asked of the host, in order: "markDone p2", "clearDone lobby". */
let asked: string[];
/** Set to make the host refuse the post or the change. */
let refusal: Error | null;
/** While set, a change waits for it: the host has not answered yet. */
let answer: Promise<void> | null;
let closed: number;

async function change(request: string): Promise<void> {
  asked.push(request);
  await answer;
  if (refusal) throw refusal;
}

const ACTIONS: BoardActions = {
  post: async (input) => {
    if (refusal) throw refusal;
    posted.push(input);
  },
  markDone: (id) => change(`markDone ${id}`),
  reopen: (id) => change(`reopen ${id}`),
  remove: (id) => change(`remove ${id}`),
  clearDone: (board) => change(`clearDone ${board}`),
  setWakesPaused: async () => undefined,
};
const nameOf = (author: string) => author;
const onClose = () => {
  closed += 1;
};

const NO_TASKS: AgentTaskGroup[] = [];

interface HarnessProps {
  rooms: OfficeRoom[];
  /** The room whose board is open. */
  roomId?: string;
  agentTasks?: AgentTaskGroup[];
  compact?: boolean;
  /** The host's sheet has left by the time it reports a close: a phone's, or any on native. */
  sheetLeavesFirst?: boolean;
  wakesPaused?: boolean;
}

function Harness({
  rooms,
  roomId = "w1",
  agentTasks = NO_TASKS,
  compact = false,
  sheetLeavesFirst = false,
  wakesPaused = false,
}: HarnessProps) {
  const styles = useOfficeStyles(THEME, compact, false);
  return (
    <BoardSheet
      room={rooms.find((room) => room.id === roomId) ?? null}
      rooms={rooms}
      agentTasks={agentTasks}
      name={nameOf}
      actions={ACTIONS}
      wakesPaused={wakesPaused}
      sheetLeavesFirst={sheetLeavesFirst}
      styles={styles}
      onClose={onClose}
    />
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  posted = [];
  asked = [];
  refusal = null;
  answer = null;
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

/** Enter in the field, with the focus in it. */
async function enter(label: string): Promise<void> {
  const field = byLabel(label);
  await act(async () => {
    field.focus();
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();
}

const isOff = (label: string) => byLabel(label).getAttribute("aria-disabled") === "true";
const fieldText = (label: string) => (byLabel(label) as HTMLInputElement).value;

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

/** Every line of text the sheet shows, in order; a button's hidden width spacer is left out. */
function lines(): string[] {
  return [...container.querySelectorAll("*")]
    .filter((element) => element.childElementCount === 0 && element.textContent !== "")
    .filter((element) => element.closest('[aria-hidden="true"]') === null)
    .map((element) => element.textContent ?? "");
}

/** The lines from this heading on. */
function linesFrom(heading: string): string[] {
  const all = lines();
  return all.slice(all.indexOf(heading));
}

const checkboxes = () => [...container.querySelectorAll<HTMLElement>('[role="checkbox"]')];

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

test("the row that is nobody keeps a slot as wide as an agent's dot, so the titles line up", async () => {
  await mount({ rooms: officeRooms([agent("1")]) });
  await press("Wake an agent with it: Nobody");

  // react-native-web writes these styles inline in jsdom; a real browser measured the rail.
  const lead = (label: string) => byLabel(label).firstElementChild as HTMLElement;
  const nobody = lead("Nobody: The post wakes no agent");
  const dot = lead("Agent 1: shop-api · Idle").firstElementChild as HTMLElement;
  expect(nobody.childElementCount).toBe(0);
  expect(getComputedStyle(nobody).width).not.toBe("");
  expect(getComputedStyle(nobody).width).toBe(getComputedStyle(dot).width);
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

test("focus goes to the chosen row when the page opens, and back to the form's row after", async () => {
  await mount({ rooms: officeRooms([agent("1"), agent("2", { title: "Builder" }), agent("3")]) });

  await press("Wake an agent with it: Nobody");
  expect(document.activeElement).toBe(byLabel("Nobody: The post wakes no agent"));

  await press("Builder: shop-api · Idle");
  expect(document.activeElement).toBe(byLabel("Wake an agent with it: Builder"));

  await press("Wake an agent with it: Builder");
  expect(document.activeElement).toBe(byLabel("Builder: shop-api · Idle"));

  await press("Back");
  expect(document.activeElement).toBe(byLabel("Wake an agent with it: Builder"));
});

test("with nine agents the search field takes the focus", async () => {
  await mount({
    rooms: officeRooms(Array.from({ length: 9 }, (_, index) => agent(String(index + 1)))),
  });
  await press("Wake an agent with it: Nobody");
  expect(document.activeElement).toBe(byLabel("Search agents"));
});

test("thirty agents are all on the page", async () => {
  const thirty = Array.from({ length: 30 }, (_, index) => agent(String(index + 1)));
  await mount({ rooms: officeRooms(thirty) });
  await press("Wake an agent with it: Nobody");
  expect(radios()).toHaveLength(31);
});

test("a close from the page goes back while the sheet stays, and closes one that has left", async () => {
  const rooms = officeRooms([agent("1")]);
  await mount({ rooms });
  await press("Wake an agent with it: Nobody");

  await act(async () => dismiss());
  expect(title()).toBe("shop-api board");
  expect(closed).toBe(0);
  expect(document.activeElement).toBe(byLabel("Wake an agent with it: Nobody"));
  await act(async () => dismiss());
  expect(closed).toBe(1);

  // A phone's sheet, swiped away.
  await mount({ rooms, compact: true, sheetLeavesFirst: true });
  await press("Wake an agent with it: Nobody");
  await act(async () => dismiss());
  expect(closed).toBe(2);

  // A tablet's sheet, which Android's Back dismisses before it reports. The host took the closed
  // sheet away, so it opens again on the form.
  await mount({ rooms: [] });
  await mount({ rooms, compact: false, sheetLeavesFirst: true });
  await press("Wake an agent with it: Nobody");
  await act(async () => dismiss());
  expect(closed).toBe(3);
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

test("the lobby adds a to-do with Enter and with Add, and keeps the agent choice to the form", async () => {
  await mount({
    rooms: lobbyRooms([], [agent("2", { title: "Builder", workspaceId: null })]),
    roomId: "lobby",
  });
  expect(title()).toBe("Lobby board");
  // The field adds to-dos only: no Task/Note choice.
  expect(container.querySelector('[aria-label="Kind of post"]')).toBeNull();
  expect(radios()).toEqual([]);
  expect(isOff("Add")).toBe(true);
  await type("Add a to-do", "   ");
  expect(isOff("Add")).toBe(true);

  await type("Add a to-do", "Rotate keys");
  expect(isOff("Add")).toBe(false);
  await enter("Add a to-do");

  expect(posted).toEqual([{ board: "lobby", kind: "task", text: "Rotate keys" }]);
  expect(fieldText("Add a to-do")).toBe("");
  // The next to-do is typed straight after: the field keeps the focus.
  expect(document.activeElement).toBe(byLabel("Add a to-do"));

  await type("Add a to-do", "Check the build");
  await press("Wake an agent with it: Nobody");
  await press("Builder: Lobby · Idle");
  expect(title()).toBe("Lobby board");
  expect(fieldText("Add a to-do")).toBe("Check the build");
  await press("Add");

  expect(posted).toEqual([
    { board: "lobby", kind: "task", text: "Rotate keys" },
    { board: "lobby", kind: "task", text: "Check the build", to: "2" },
  ]);
  expect(fieldText("Add a to-do")).toBe("");
  byLabel("Wake an agent with it: Nobody");
});

test("a to-do the host refuses keeps its text and says why", async () => {
  await mount({ rooms: lobbyRooms([]), roomId: "lobby" });
  await type("Add a to-do", "Rotate keys");
  refusal = new Error("the board is full");

  await enter("Add a to-do");

  expect(posted).toEqual([]);
  expect(container.textContent).toContain("Unable to add: the board is full");
  expect(fieldText("Add a to-do")).toBe("Rotate keys");
});

test("ticking sends done, unticking sends reopen, and a pending box takes no second tap", async () => {
  await mount({
    rooms: lobbyRooms([
      post(1, { text: "Update the README", state: "done" }),
      post(2, { text: "Rotate keys" }),
    ]),
    roomId: "lobby",
  });
  // Open ones first, then done ones.
  expect(checkboxes().map((box) => box.getAttribute("aria-label"))).toEqual([
    "Rotate keys",
    "Update the README",
  ]);
  expect(byLabel("Rotate keys").getAttribute("aria-checked")).toBe("false");
  expect(byLabel("Update the README").getAttribute("aria-checked")).toBe("true");

  let release: () => void = () => undefined;
  answer = new Promise((resolve) => {
    release = resolve;
  });
  await press("Rotate keys");
  expect(isOff("Rotate keys")).toBe(true);
  await press("Rotate keys");
  expect(asked).toEqual(["markDone p2"]);
  await act(async () => release());
  await settle();
  expect(isOff("Rotate keys")).toBe(false);
  answer = null;

  await press("Update the README");
  expect(asked).toEqual(["markDone p2", "reopen p1"]);

  refusal = new Error("Unable to finish p2: it is a note");
  await press("Rotate keys");
  // Under its own row, and the box still shows the board's state.
  expect(byLabel("Rotate keys").parentElement?.textContent).toContain(
    "Unable to finish p2: it is a note",
  );
  expect(byLabel("Rotate keys").getAttribute("aria-checked")).toBe("false");
});

test("Clear finished asks with the live count and clears the lobby", async () => {
  const open = post(1, { text: "Rotate keys" });
  await mount({ rooms: lobbyRooms([open]), roomId: "lobby" });
  expect(isOff("Clear finished")).toBe(true);

  const twoDone = [open, post(2, { state: "done" }), post(3, { state: "done" })];
  await mount({ rooms: lobbyRooms(twoDone), roomId: "lobby" });
  expect(isOff("Clear finished")).toBe(false);
  await press("Clear finished");
  expect(container.textContent).toContain("Delete 2 finished to-dos?");

  // An agent finishes another one while the question shows.
  await mount({ rooms: lobbyRooms([...twoDone, post(4, { state: "done" })]), roomId: "lobby" });
  expect(container.textContent).toContain("Delete 3 finished to-dos?");

  await press("Keep");
  expect(container.textContent).not.toContain("finished to-dos?");
  await press("Clear finished");
  await press("Delete");
  expect(asked).toEqual(["clearDone lobby"]);
  byLabel("Clear finished");
});

test("the clear question ends when nothing is done, and the next done to-do does not bring it back", async () => {
  const open = post(1, { text: "Rotate keys" });
  await mount({ rooms: lobbyRooms([open, post(2, { state: "done" })]), roomId: "lobby" });
  await press("Clear finished");
  expect(container.textContent).toContain("Delete 1 finished to-do?");

  // Another hand clears it, then an agent ticks another to-do.
  await mount({ rooms: lobbyRooms([open]), roomId: "lobby" });
  await mount({ rooms: lobbyRooms([open, post(3, { state: "done" })]), roomId: "lobby" });

  expect(container.textContent).not.toContain("finished to-do?");
  expect(isOff("Clear finished")).toBe(false);
});

test("a to-do arriving while typing keeps the typed text", async () => {
  const agents = [agent("2", { title: "Builder", workspaceId: null })];
  const first = post(1, { text: "Rotate keys" });
  await mount({ rooms: lobbyRooms([first], agents), roomId: "lobby" });
  await type("Add a to-do", "half");
  await press("Wake an agent with it: Nobody");
  await press("Builder: Lobby · Idle");

  // An agent ticks the first to-do and adds another.
  const ticked = { ...first, state: "done" as const };
  const added = post(2, { text: "Check the build", author: "2" });
  await mount({ rooms: lobbyRooms([ticked, added], agents), roomId: "lobby" });

  expect(checkboxes().map((box) => box.getAttribute("aria-label"))).toEqual([
    "Check the build",
    "Rotate keys",
  ]);
  expect(byLabel("Rotate keys").getAttribute("aria-checked")).toBe("true");
  expect(fieldText("Add a to-do")).toBe("half");
  byLabel("Wake an agent with it: Builder");
});

test("a to-do's Delete asks first", async () => {
  await mount({ rooms: lobbyRooms([post(1, { text: "Rotate keys" })]), roomId: "lobby" });

  await press("Delete");
  expect(asked).toEqual([]);
  expect(container.textContent).toContain("Delete this post?");
  await press("Delete");

  expect(asked).toEqual(["remove p1"]);
});

test("notes show under the list only when there are notes", async () => {
  const todo = post(1, { text: "Rotate keys", state: "claimed", claimedBy: "a1", to: "a1" });
  await mount({ rooms: lobbyRooms([todo]), roomId: "lobby" });
  expect(lines()).not.toContain("Notes");

  const note = post(2, { kind: "note", state: undefined, text: "The demo is on Thursday" });
  await mount({ rooms: lobbyRooms([todo, note]), roomId: "lobby" });

  expect(linesFrom("To-do")).toEqual([
    "To-do",
    "Clear finished",
    "Rotate keys",
    "claimed by a1 · for a1",
    "Delete",
    "Notes",
    "Note · user",
    "The demo is on Thursday",
    "Delete",
    "Agent tasks",
    "No agent tasks",
  ]);
});

test("agent tasks show each agent's steps, or say there are none", async () => {
  const agentTasks: AgentTaskGroup[] = [
    {
      agentId: "a1",
      steps: [
        { text: "Run typecheck", status: "in_progress" },
        { text: "Commit", status: "pending" },
      ],
    },
    {
      agentId: "a2",
      steps: [
        { text: "Run tests", status: "pending" },
        { text: "Draft the release notes", status: "pending" },
        { text: "Run tests", status: "pending" },
      ],
    },
  ];
  await mount({ rooms: lobbyRooms([]), roomId: "lobby", agentTasks });
  expect(container.textContent).toContain("No to-dos");
  expect(linesFrom("Agent tasks")).toEqual([
    "Agent tasks",
    "a1",
    "◐ Run typecheck",
    "○ Commit",
    "a2",
    "○ Run tests",
    "○ Draft the release notes",
    "○ Run tests",
  ]);

  await mount({ rooms: lobbyRooms([]), roomId: "lobby", agentTasks: [] });
  expect(linesFrom("Agent tasks")).toEqual(["Agent tasks", "No agent tasks"]);
});

test("another room's board still shows the posts form", async () => {
  await mount({ rooms: officeRooms([], { w1: [post(1, { board: "w1" })] }) });

  expect(title()).toBe("shop-api board");
  const kinds = byLabel("Kind of post").querySelectorAll('[role="radio"]');
  expect([...kinds].map((chip) => chip.textContent)).toEqual(["Task", "Note"]);
  byLabel("Post");
  expect(container.querySelector('[aria-label="Clear finished"]')).toBeNull();
  expect(container.querySelector('[aria-label="Add a to-do"]')).toBeNull();
  expect(checkboxes()).toEqual([]);
});
