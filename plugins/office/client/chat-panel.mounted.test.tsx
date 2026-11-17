/**
 * @vitest-environment jsdom
 */
// The chat panel, mounted as the side area mounts the screen: the office's subscription is stood in
// so a test delivers the chat, and the chat's call is a mock the test reads one call at a time.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ScrollViewProps } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps, PluginSubscriptionState } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, expect, test, vi, type Mock } from "vitest";
import type {
  ChatChange,
  ChatMessage,
  ChatRequest,
  ChatResult,
  OfficeAgent,
  OfficeEvent,
} from "../shared/contracts.js";
import { getChatSeen, resetChatSeen } from "./chat-seen.js";
import { CHAT_EMPTY, CHAT_RECALLED, REACTION_CHOICES, STICKERS, remindState } from "./chat-text.js";
import { useOfficeLink, type OfficeLink } from "./office-link.js";
import { EMPTY_OFFICE } from "./office-state.js";

/** The subscription's status, and the office's events once it delivers them. */
let status: PluginSubscriptionState;
let deliver: ((event: OfficeEvent) => void) | null;
/** The chat's call: it takes each request until a test says otherwise. */
let call: Mock<(input: ChatRequest) => Promise<ChatResult>>;
/** The props the message list was last drawn with, and how often it was sent to its end. */
let scroller: ScrollViewProps | null;
let toEnd: number;

vi.mock("@getpaseo/plugin/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/plugin/client")>()),
  useSubscription: (_contract: unknown, _input: unknown, onEvent: (event: OfficeEvent) => void) => {
    deliver = onEvent;
    return status;
  },
  useRpc: () => call,
}));

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  const { TextInput, View } = await import("react-native");
  // The message list is the scroller that follows its content; the @ list scrolls too, and is not it.
  const ScrollView = forwardRef<unknown, ScrollViewProps & { children?: ReactNode }>(
    (props, ref) => {
      if (props.onContentSizeChange) scroller = props;
      useImperativeHandle(ref, () => ({
        scrollToEnd: () => {
          toEnd += 1;
        },
      }));
      return createElement(
        "div",
        { "data-scroll": "vertical" },
        createElement(View, null, props.children),
      );
    },
  );
  const Icon = () => null;
  return { Icon, ScrollView, TextInput };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const at = (hours: number, minutes: number) => new Date(2026, 10, 17, hours, minutes).getTime();
const NOW = at(9, 30);

function agent(id: string, title: string): OfficeAgent {
  return {
    id,
    title,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: null,
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-17T08:00:00.000Z",
  };
}

const FIX = agent("a1", "Fix login");
const DOCS = agent("a2", "Docs");

let seq = 0;
function msg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  seq += 1;
  return {
    id: `m${seq}`,
    at: at(9, 0),
    kind: "text",
    from: "a1",
    name: "Fix login",
    text: "On it",
    reacts: {},
    ...overrides,
  };
}

let opened: string[];
let container: HTMLElement;
let root: Root;

function screenProps(compact: boolean): PluginScreenProps {
  return {
    theme: THEME,
    layout: { compact, platform: "web" },
    host: { id: "host", label: "Host" },
    params: {},
    navigation: {
      openAgent: ({ agentId }: { agentId: string }) => void opened.push(agentId),
      openWorkspace: () => undefined,
    },
  } as unknown as PluginScreenProps;
}

async function mount(options: { link?: OfficeLink; compact?: boolean } = {}): Promise<void> {
  const { ChatPanel } = await import("./chat-panel.js");
  const panel = createElement(ChatPanel, screenProps(options.compact ?? true));
  const { link } = options;
  // The office surface beside the panel is a tree of its own in the app; here a sibling stands in.
  await act(async () =>
    root.render(
      link ? createElement("div", null, createElement(Surface, { value: link }), panel) : panel,
    ),
  );
}

function Surface({ value }: { value: OfficeLink }) {
  useOfficeLink(value);
  return null;
}

async function snapshot(
  messages: ChatMessage[],
  agents: OfficeAgent[] = [],
  typing: string[] = [],
): Promise<void> {
  await act(async () =>
    deliver?.({ type: "snapshot", state: { ...EMPTY_OFFICE, agents, chat: { messages, typing } } }),
  );
}

async function chat(change: ChatChange): Promise<void> {
  await act(async () => deliver?.({ type: "chat", change }));
}

function maybe(label: string, scope: ParentNode = container): HTMLElement | null {
  return scope.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}

function labelled(label: string, scope: ParentNode = container): HTMLElement {
  const found = maybe(label, scope);
  if (!found) throw new Error(`Nothing is labelled "${label}"`);
  return found;
}

async function press(label: string, scope: ParentNode = container): Promise<void> {
  const button = labelled(label, scope);
  await act(async () => button.click());
}

function maybeRow(id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-testid="chat-${id}"]`);
}

function row(id: string): HTMLElement {
  const found = maybeRow(id);
  if (!found) throw new Error(`No message ${id} is shown`);
  return found;
}

const box = () => labelled("Message") as HTMLTextAreaElement;

async function type(text: string): Promise<void> {
  const field = box();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** A key in the box, with the focus in it. */
async function key(name: string, shiftKey = false): Promise<void> {
  const field = box();
  await act(async () => {
    field.focus();
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, shiftKey, bubbles: true, cancelable: true }),
    );
  });
}

/** The element whose own text is this, as a reader sees it. */
function textElement(text: string, scope: ParentNode = container): HTMLElement {
  const found = [...scope.querySelectorAll<HTMLElement>("*")].find(
    (element) => element.textContent === text && element.childElementCount === 0,
  );
  if (!found) throw new Error(`No element says "${text}"`);
  return found;
}

const follows = (first: Node, second: Node) =>
  (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

function scrollEvent(offset: number, content: number, viewport: number) {
  return {
    nativeEvent: {
      contentOffset: { x: 0, y: offset },
      contentSize: { width: 300, height: content },
      layoutMeasurement: { width: 300, height: viewport },
    },
  } as unknown as Parameters<NonNullable<ScrollViewProps["onScroll"]>>[0];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  status = { status: "live" };
  deliver = null;
  call = vi.fn(async () => ({ ok: true as const }));
  scroller = null;
  toEnd = 0;
  opened = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

test("empty: the line that says how to start", async () => {
  await mount();
  await snapshot([]);
  expect(container.textContent).toContain(CHAT_EMPTY);

  await chat({ op: "add", message: msg() });
  expect(container.textContent).not.toContain(CHAT_EMPTY);
});

test("messages oldest first: yours on the right without an avatar, an agent's with initials, name and time", async () => {
  const theirs = msg({ at: at(9, 5), text: "On it" });
  const mine = msg({ at: at(9, 6), from: "me", name: "Boss", text: "Thanks" });
  await mount();
  await snapshot([theirs, mine], [FIX]);

  expect(follows(row(theirs.id), row(mine.id))).toBe(true);
  // An agent's: its initials on a disc in its floor colour, its name and the time.
  const avatar = row(theirs.id).querySelector<HTMLElement>('[aria-hidden="true"]');
  expect(avatar?.textContent).toBe("FL");
  expect(avatar?.style.backgroundColor).not.toBe("");
  expect(row(theirs.id).textContent).toContain("Fix login");
  expect(row(theirs.id).textContent).toContain("09:05");
  expect(getComputedStyle(row(theirs.id)).justifyContent).not.toBe("flex-end");
  // Yours: on the right, the time under it, no avatar and no name.
  expect(getComputedStyle(row(mine.id)).justifyContent).toBe("flex-end");
  expect(row(mine.id).querySelector('[aria-hidden="true"]')).toBeNull();
  expect(row(mine.id).textContent).toContain("09:06");
  expect(row(mine.id).textContent).not.toContain("Boss");
  expect(follows(textElement("Thanks", row(mine.id)), textElement("09:06", row(mine.id)))).toBe(
    true,
  );
});

test("a reply quotes the message it answers; a system line is centred; a recalled one says Message recalled", async () => {
  const question = msg({ from: "me", name: "Boss", text: "Can you fix the login?" });
  const answer = msg({
    text: "Fixed: the cookie had the wrong path.",
    reply: { id: question.id, name: "Boss", text: "Can you fix the login?" },
  });
  const line = msg({
    kind: "sys",
    from: undefined,
    name: undefined,
    text: "Docs joined the group",
  });
  const gone = msg({ from: "me", name: "Boss", text: "", recalled: true });
  await mount();
  await snapshot([question, answer, line, gone], [FIX]);

  // The quote sits above the answer, with whose message it was and what it said.
  const quoted = textElement("Can you fix the login?", row(answer.id));
  expect(row(answer.id).textContent).toContain("Boss");
  expect(
    follows(quoted, textElement("Fixed: the cookie had the wrong path.", row(answer.id))),
  ).toBe(true);
  expect(getComputedStyle(row(line.id)).textAlign).toBe("center");
  expect(row(line.id).textContent).toBe("Docs joined the group");
  // A system line has nothing to do on it.
  expect(maybe("Reply", row(line.id))).toBeNull();
  expect(row(gone.id).textContent).toContain(CHAT_RECALLED);
  expect(maybe("React", row(gone.id))).toBeNull();
  expect(maybe("Reply", row(gone.id))).toBeNull();
  expect(maybe("Recall", row(gone.id))).toBeNull();
});

test("a sticker is a chip with upstream's words; a photo or work message shows nothing", async () => {
  const sticker = msg({ kind: "sticker", sticker: 2, text: "" });
  const photo = msg({ kind: "photo", text: "" });
  const work = msg({ kind: "work", text: "" });
  await mount();
  await snapshot([sticker, photo, work], [FIX]);

  // A pill with an outline around the words.
  const chip = textElement(STICKERS[2] ?? "", row(sticker.id)).parentElement;
  expect(chip?.style.borderTopLeftRadius).toBe("9999px");
  expect(chip?.style.borderTopWidth).toBe("1px");
  expect(maybeRow(photo.id)).toBeNull();
  expect(maybeRow(work.id)).toBeNull();
});

test("a poll shows options with counts and your vote, and a press votes", async () => {
  const lunch = msg({
    kind: "poll",
    text: "Lunch?",
    poll: {
      q: "Lunch?",
      opts: [
        { t: "Pho", by: ["me", "a2"] },
        { t: "Rice", by: [] },
      ],
    },
  });
  await mount();
  await snapshot([lunch], [FIX, DOCS]);

  expect(row(lunch.id).textContent).toContain("Lunch?");
  const pho = labelled("Pho, 2", row(lunch.id));
  const rice = labelled("Rice, 0", row(lunch.id));
  expect(pho.getAttribute("role")).toBe("radio");
  expect(pho.getAttribute("aria-checked")).toBe("true");
  expect(rice.getAttribute("aria-checked")).toBe("false");

  await press("Rice, 0", row(lunch.id));
  expect(call.mock.calls).toEqual([[{ op: "vote", id: lunch.id, index: 1 }]]);
});

test("a reminder shows its time, Going and Not going, and a press sends rsvp", async () => {
  const standup = msg({
    kind: "remind",
    from: "__director",
    name: "Director",
    text: "Stand-up",
    remind: { title: "Stand-up", at: at(10, 0), repeat: "week", yes: ["a1"], no: [] },
  });
  await mount();
  await snapshot([standup], [FIX]);

  expect(row(standup.id).textContent).toContain("Stand-up");
  expect(row(standup.id).textContent).toContain(remindState(standup)?.when ?? "none");
  expect(row(standup.id).textContent).toContain("1 going");

  await press("Going", row(standup.id));
  expect(call.mock.calls).toEqual([[{ op: "rsvp", id: standup.id, yes: true }]]);
  call.mockClear();
  await press("Not going", row(standup.id));
  expect(call.mock.calls).toEqual([[{ op: "rsvp", id: standup.id, yes: false }]]);
});

test("reactions: counts under a message with your own pressed; React opens the six; the same emoji again sends react", async () => {
  const [heart, thumbs] = REACTION_CHOICES;
  const liked = msg({ reacts: { [heart ?? ""]: ["a2"], [thumbs ?? ""]: ["me", "a2"] } });
  await mount();
  await snapshot([liked], [FIX, DOCS]);

  const mine = labelled(`${thumbs} 2`, row(liked.id));
  const theirs = labelled(`${heart} 1`, row(liked.id));
  expect(mine.getAttribute("aria-pressed")).toBe("true");
  expect(theirs.getAttribute("aria-pressed")).toBe("false");
  // Under the message's words.
  expect(follows(textElement("On it", row(liked.id)), mine)).toBe(true);

  // The six choices are not there until React is pressed.
  expect(REACTION_CHOICES.map((emoji) => maybe(emoji, row(liked.id)))).toEqual(
    REACTION_CHOICES.map(() => null),
  );
  await press("React", row(liked.id));
  expect(REACTION_CHOICES.map((emoji) => maybe(emoji, row(liked.id)) !== null)).toEqual(
    REACTION_CHOICES.map(() => true),
  );
  const last = REACTION_CHOICES.at(-1) ?? "";
  await press(last, row(liked.id));
  expect(call.mock.calls).toEqual([[{ op: "react", id: liked.id, emoji: last }]]);
  // A choice closes the six.
  expect(maybe(last, row(liked.id))).toBeNull();

  // Your own reaction pressed again goes to the chat as the same emoji, which takes it back.
  call.mockClear();
  await press(`${thumbs} 2`, row(liked.id));
  expect(call.mock.calls).toEqual([[{ op: "react", id: liked.id, emoji: thumbs }]]);
});

test("typing words show above the box", async () => {
  const said = msg();
  await mount();
  await snapshot([said], [FIX, DOCS], ["Fix login"]);

  const typing = textElement("Fix login is typing…");
  expect(follows(typing, box())).toBe(true);
  expect(follows(row(said.id), typing)).toBe(true);

  await chat({ op: "typing", names: ["Fix login", "Docs"] });
  expect(container.textContent).toContain("Fix login and Docs are typing…");
  await chat({ op: "typing", names: [] });
  expect(container.textContent).not.toContain("typing");
});

test("an agent's long answer is clipped with Show more, and Open session opens the agent", async () => {
  const sessions: string[] = [];
  const link: OfficeLink = {
    select: () => undefined,
    openSession: (agentId) => void sessions.push(agentId),
  };
  const long = Array.from({ length: 12 }, (_, index) => `Line ${index + 1}`).join("\n");
  const answer = msg({ text: long });
  const short = msg({ text: "Done" });
  // An agent that is no longer on the floor has no session to open.
  const left = msg({ from: "a9", name: "Gone", text: "Bye" });
  await mount({ link });
  await snapshot([answer, short, left], [FIX]);

  // react-native-web clamps with -webkit-box classes; a real browser showed the eight lines.
  const words = textElement(long, row(answer.id));
  expect(words.className).toMatch(/WebkitBoxOrient/);
  expect(maybe("Show more", row(short.id))).toBeNull();
  await press("Show more", row(answer.id));
  expect(textElement(long, row(answer.id)).className).not.toMatch(/WebkitBoxOrient/);
  expect(maybe("Show more", row(answer.id))).toBeNull();

  expect(maybe("Open session", row(short.id))).not.toBeNull();
  expect(maybe("Open session", row(left.id))).toBeNull();
  await press("Open session", row(answer.id));
  expect(sessions).toEqual(["a1"]);
  expect(opened).toEqual([]);
});

test("Enter sends and clears the box; Shift+Enter does not send", async () => {
  await mount();
  await snapshot([]);
  expect(box().getAttribute("maxlength")).toBe("600");

  await type("hello");
  await key("Enter", true);
  expect(call).not.toHaveBeenCalled();

  await type("  hello team  ");
  await key("Enter");
  expect(call.mock.calls).toEqual([[{ op: "send", text: "hello team" }]]);
  expect(box().value).toBe("");

  // An empty box sends nothing.
  await key("Enter");
  expect(call).toHaveBeenCalledTimes(1);
  // The Send button sends too: on a phone Enter is a new line.
  await type("from the button");
  await press("Send");
  expect(call.mock.calls.at(-1)).toEqual([{ op: "send", text: "from the button" }]);
  expect(box().value).toBe("");
});

test("a send that fails leaves the text in the box and shows the error under it", async () => {
  call.mockResolvedValueOnce({ ok: false, error: "The chat is not loaded." });
  await mount();
  await snapshot([]);

  await type("hello");
  await key("Enter");
  expect(box().value).toBe("hello");
  const error = container.querySelector<HTMLElement>('[role="alert"]');
  expect(error?.textContent).toBe("Unable to send: The chat is not loaded.");
  if (!error) throw new Error("No error is shown");
  expect(follows(box(), error)).toBe(true);

  call.mockRejectedValueOnce(new Error("Host offline."));
  await key("Enter");
  expect(box().value).toBe("hello");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Unable to send: Host offline.",
  );

  // The next send that goes through takes the error away.
  await key("Enter");
  expect(box().value).toBe("");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

test("@ lists the team filtered by the words after it; Enter, Tab or a press puts the name", async () => {
  await mount();
  await snapshot([], [FIX, DOCS]);
  expect(maybe("Fix login, Lobby")).toBeNull();

  await type("hi @fi");
  expect(maybe("Fix login, Lobby")).not.toBeNull();
  expect(maybe("Docs, Lobby")).toBeNull();
  // While the list is open Enter puts the name, and does not send.
  await key("Enter");
  expect(box().value).toBe("hi @Fix login ");
  expect(call).not.toHaveBeenCalled();
  // A picked name closes the list.
  expect(maybe("Fix login, Lobby")).toBeNull();

  await type("hi @Fix login and @do");
  expect(maybe("Docs, Lobby")).not.toBeNull();
  await key("Tab");
  expect(box().value).toBe("hi @Fix login and @Docs ");

  await type("@");
  expect(maybe("Fix login, Lobby")).not.toBeNull();
  await press("Docs, Lobby");
  expect(box().value).toBe("@Docs ");

  // No list while nobody matches: Enter sends.
  await type("@zz");
  expect(maybe("Fix login, Lobby")).toBeNull();
  await key("Enter");
  expect(call.mock.calls).toEqual([[{ op: "send", text: "@zz" }]]);
});

test('a sticker button opens the eight; a press sends { op: "send", sticker }', async () => {
  await mount();
  await snapshot([]);
  expect(maybe(STICKERS[3] ?? "")).toBeNull();

  await press("Stickers");
  expect(STICKERS).toHaveLength(8);
  expect(STICKERS.map((words) => maybe(words) !== null)).toEqual(STICKERS.map(() => true));
  await press(STICKERS[3] ?? "");
  expect(call.mock.calls).toEqual([[{ op: "send", sticker: 3 }]]);
  // A sent sticker closes the eight.
  expect(maybe(STICKERS[3] ?? "")).toBeNull();
});

test("Reply quotes the message above the box, and the send carries replyTo", async () => {
  const asked = msg({ text: "Which branch?" });
  await mount();
  await snapshot([asked], [FIX]);

  await press("Reply", row(asked.id));
  const quote = [...container.querySelectorAll<HTMLElement>("*")].filter(
    (element) => element.textContent === "Which branch?" && element.childElementCount === 0,
  );
  // The message itself, and its quote above the box.
  expect(quote).toHaveLength(2);
  const above = quote[1];
  if (!above) throw new Error("No quote above the box");
  expect(follows(above, box())).toBe(true);
  expect(follows(row(asked.id), above)).toBe(true);

  await type("main");
  await key("Enter");
  expect(call.mock.calls).toEqual([[{ op: "send", text: "main", replyTo: asked.id }]]);
  expect(maybe("Cancel reply")).toBeNull();

  // The quote can be closed without sending.
  await press("Reply", row(asked.id));
  await press("Cancel reply");
  expect(maybe("Cancel reply")).toBeNull();
  await type("plain");
  await key("Enter");
  expect(call.mock.calls.at(-1)).toEqual([{ op: "send", text: "plain" }]);
});

test("your own message has Recall for two minutes", async () => {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW);
  const mine = msg({ from: "me", name: "Boss", at: NOW - 60_000, text: "oops" });
  const theirs = msg({ at: NOW - 60_000 });
  await mount();
  await snapshot([mine, theirs], [FIX]);

  expect(maybe("Recall", row(theirs.id))).toBeNull();
  await press("Recall", row(mine.id));
  expect(call.mock.calls).toEqual([[{ op: "recall", id: mine.id }]]);

  // Two minutes after it was sent, Recall goes.
  await act(async () => vi.advanceTimersByTime(59_000));
  expect(maybe("Recall", row(mine.id))).not.toBeNull();
  await act(async () => vi.advanceTimersByTime(2_000));
  expect(maybe("Recall", row(mine.id))).toBeNull();
});

test("a counter shows from 500 characters", async () => {
  await mount();
  await snapshot([]);

  await type("x".repeat(499));
  expect(container.textContent).not.toContain("/ 600");
  await type("x".repeat(500));
  expect(container.textContent).toContain("500 / 600");
});

test("the panel marks the chat seen as messages arrive", async () => {
  resetChatSeen(1000);
  await mount();
  await snapshot([msg({ at: 2000 }), msg({ at: 5000 })], [FIX]);
  expect(getChatSeen()).toBe(5000);

  await chat({ op: "add", message: msg({ at: 7000 }) });
  expect(getChatSeen()).toBe(7000);
});

test("a subscription that cannot load says so", async () => {
  status = { status: "error", error: new Error("Host offline.") };
  await mount();
  expect(container.textContent).toContain("Unable to load the office: host offline");
  // In place of the list.
  expect(container.textContent).not.toContain(CHAT_EMPTY);

  status = { status: "closed" };
  await mount();
  expect(container.textContent).toContain(
    "Unable to show live agents: the host closed the office. Reopen it.",
  );
});

test("while you are at the bottom a new message scrolls to it, and not when you have scrolled up", async () => {
  await mount();
  await snapshot([msg()], [FIX]);
  const list = () => {
    if (!scroller) throw new Error("No message list");
    return scroller;
  };

  // The first messages: the list starts at the bottom.
  await act(async () => list().onContentSizeChange?.(300, 500));
  expect(toEnd).toBe(1);

  // Scrolled up to read: a new message leaves the list where it is.
  await act(async () => list().onScroll?.(scrollEvent(0, 1000, 300)));
  await chat({ op: "add", message: msg() });
  await act(async () => list().onContentSizeChange?.(300, 1100));
  expect(toEnd).toBe(1);

  // Back at the bottom: the next one is followed again.
  await act(async () => list().onScroll?.(scrollEvent(800, 1100, 300)));
  await chat({ op: "add", message: msg() });
  await act(async () => list().onContentSizeChange?.(300, 1200));
  expect(toEnd).toBe(2);
});

test("on a wide screen a message's actions show on hover and focus, and stay while the pointer is on them", async () => {
  const said = msg();
  await mount({ compact: false });
  await snapshot([said], [FIX]);
  const actions = () => labelled("React", row(said.id)).parentElement as HTMLElement;
  const enter = (element: HTMLElement) =>
    act(async () => void element.dispatchEvent(new MouseEvent("mouseenter")));
  const leave = (element: HTMLElement) =>
    act(async () => void element.dispatchEvent(new MouseEvent("mouseleave")));

  // Hidden, and still in place: hovering does not move the list.
  expect(getComputedStyle(actions()).opacity).toBe("0");
  await enter(row(said.id));
  expect(getComputedStyle(actions()).opacity).not.toBe("0");
  // The pointer on one of the message's buttons keeps them shown.
  await enter(labelled("Reply", row(said.id)));
  expect(getComputedStyle(actions()).opacity).not.toBe("0");
  await leave(labelled("Reply", row(said.id)));
  await leave(row(said.id));
  expect(getComputedStyle(actions()).opacity).toBe("0");

  // The keyboard reaches them too.
  await act(async () => labelled("React", row(said.id)).focus());
  expect(getComputedStyle(actions()).opacity).not.toBe("0");
});
