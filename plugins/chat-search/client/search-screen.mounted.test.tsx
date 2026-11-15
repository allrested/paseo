/**
 * @vitest-environment jsdom
 */
// The Search chats screen, mounted. The scroll view and the text field are the host's, so
// react-native's own stand in; the search call is the test's.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PluginRpcProvider } from "@getpaseo/plugin/client/host";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { ChatHit, SearchResult } from "../shared/contracts.js";
import { SearchScreen } from "./search-screen.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView, TextInput, View } = await import("react-native");
  const { createElement } = await import("react");
  const Icon = ({ name }: { name: string }) => createElement(View, { testID: `icon-${name}` });
  return { Icon, ScrollView, TextInput };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const HERE: ChatHit = {
  provider: "claude",
  sessionId: "s-new",
  agentId: "agent-new",
  title: "Checkout total",
  folder: "/work/shop",
  changedAt: "2026-11-14T08:00:00.000Z",
  matches: 2,
  snippets: [
    {
      role: "assistant",
      at: "2026-11-14T08:00:05.000Z",
      before: "The ",
      match: "rounding",
      after: " happens before the tax.",
    },
    { role: "user", at: null, before: "Move the ", match: "ROUNDING", after: " after the tax." },
  ],
};
const ELSEWHERE: ChatHit = {
  provider: "kiro",
  sessionId: "0f7a1c2e-terminal",
  agentId: null,
  title: "Explain rounding modes",
  folder: "/home/me",
  changedAt: "2026-11-12T08:00:00.000Z",
  matches: 10,
  snippets: [{ role: "user", at: null, before: "Explain ", match: "rounding", after: " modes" }],
};

interface Call {
  query: string;
  resolve(result: SearchResult): void;
  reject(error: Error): void;
}

let calls: Call[];
let opened: unknown[];
let container: HTMLElement;
let root: Root;

function invoke(method: string, input: unknown): Promise<unknown> {
  if (method !== "chat-search.search.request") throw new Error(`Unexpected call ${method}`);
  return new Promise((resolve, reject) => {
    calls.push({ query: (input as { query: string }).query, resolve, reject });
  });
}

const subscribe = (() => ({ close() {} })) as never;

const PROPS = {
  theme: { colors: new Proxy({}, { get: () => "#808080" }) },
  layout: { compact: true, platform: "web" },
  host: { id: "host", label: "Host" },
  params: {},
  navigation: { openAgent: (input: unknown) => void opened.push(input), openWorkspace() {} },
} as unknown as PluginScreenProps;

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

async function mount(props: PluginScreenProps = PROPS): Promise<void> {
  await act(async () => {
    root.render(
      <PluginRpcProvider invoke={invoke} subscribe={subscribe}>
        <SearchScreen {...props} />
      </PluginRpcProvider>,
    );
  });
}

function field(): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>('input[aria-label="Search chats"]');
  if (!found) throw new Error("No search field");
  return found;
}

async function type(text: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field(), text);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function enter(): Promise<void> {
  await act(async () => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();
}

async function searchFor(text: string): Promise<Call> {
  await type(text);
  await enter();
  const call = calls.at(-1);
  if (!call) throw new Error("No search was started");
  return call;
}

async function answer(call: Call, result: Partial<SearchResult>): Promise<void> {
  await act(async () => call.resolve({ chats: [], others: [], more: false, ...result }));
  await settle();
}

const text = () => container.textContent ?? "";
const buttons = () => [...container.querySelectorAll<HTMLElement>('[role="button"]')];
const alert = () => container.querySelector('[role="alert"]')?.textContent ?? null;

beforeEach(() => {
  calls = [];
  opened = [];
  vi.setSystemTime(new Date("2026-11-14T12:00:00.000Z"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

test("starts with the field and what it searches, and asks nothing", async () => {
  await mount();
  expect(field().getAttribute("placeholder")).toBe("Words from a chat");
  expect(text()).toContain("Type at least 3 characters");
  expect(text()).toContain("every Claude and Kiro chat on this host");
  expect(calls).toEqual([]);
});

test("Enter searches for the words, trimmed, and says it is searching", async () => {
  await mount();
  const call = await searchFor("  rounding ");
  expect(call.query).toBe("rounding");
  expect(text()).toContain("Searching...");
  expect(text()).not.toContain("Type at least 3 characters");
});

test("fewer than three characters search nothing", async () => {
  await mount();
  await type("ro");
  await enter();
  expect(calls).toEqual([]);
  expect(text()).toContain("Type at least 3 characters");
});

test("typing searches by itself after a pause", async () => {
  await mount();
  await type("rounding");
  expect(calls).toEqual([]);
  await act(async () => void (await new Promise((done) => setTimeout(done, 450))));
  expect(calls.map((call) => call.query)).toEqual(["rounding"]);
});

test("lists the chats here with their snippets; a tap opens the chat", async () => {
  await mount();
  await answer(await searchFor("rounding"), { chats: [HERE] });

  expect(text()).toContain("1 chat");
  expect(buttons().map((button) => button.getAttribute("aria-label"))).toEqual([
    "Open chat Checkout total",
  ]);
  const card = buttons()[0];
  expect(card?.textContent).toContain("Checkout total");
  expect(card?.textContent).toContain("Claude · shop · 4 h ago · 2 messages");
  expect(card?.textContent).toContain("Agent: The rounding happens before the tax.");
  expect(card?.textContent).toContain("You: Move the ROUNDING after the tax.");
  // The words stand out from the text around them.
  expect(
    [...(card?.querySelectorAll('[data-testid="chat-search-match"]') ?? [])].map(
      (each) => each.textContent,
    ),
  ).toEqual(["rounding", "ROUNDING"]);
  expect(card?.querySelectorAll('[data-testid="icon-ChevronRight"]')).toHaveLength(1);

  await act(async () => card?.click());
  expect(opened).toEqual([{ agentId: "agent-new" }]);
});

test("lists sessions that are no agent here apart, with their id and folder and nothing to tap", async () => {
  await mount();
  await answer(await searchFor("rounding"), { chats: [HERE], others: [ELSEWHERE] });

  expect(text()).toContain("2 chats");
  expect(buttons()).toHaveLength(1);
  const section = container.querySelector('[aria-label="Not in Paseo"]');
  expect(section?.textContent).toContain("no agent here");
  expect(section?.textContent).toContain("Explain rounding modes");
  expect(section?.textContent).toContain("Kiro · me · 2 d ago · 10 or more messages");
  expect(section?.textContent).toContain("Session 0f7a1c2e-terminal in /home/me");
  // No arrow on a session that cannot be opened.
  expect(section?.querySelectorAll('[data-testid="icon-ChevronRight"]')).toHaveLength(0);
});

test("says when nothing matched, and when only the newest chats are shown", async () => {
  await mount();
  await answer(await searchFor("rounding"), {});
  expect(text()).toContain('No chat says "rounding"');

  await answer(await searchFor("tax"), { chats: [HERE], more: true });
  expect(text()).toContain("The 1 newest chats that match. Add a word to narrow the search");
});

test("a search that fails says why", async () => {
  await mount();
  const call = await searchFor("rounding");
  await act(async () => call.reject(new Error("Chat search needs grep on this host")));
  await settle();
  expect(alert()).toBe("Chat search needs grep on this host");
  expect(text()).not.toContain("Searching...");
});

test("an answer that comes after a newer search began is dropped", async () => {
  await mount();
  const first = await searchFor("rounding");
  const second = await searchFor("tax rate");
  await answer(first, { chats: [HERE] });
  expect(text()).toContain("Searching...");
  expect(buttons()).toEqual([]);
  await answer(second, { others: [ELSEWHERE] });
  expect(text()).toContain("Explain rounding modes");
  expect(text()).not.toContain("Checkout total");
});

test("without the host's navigation a chat here is shown but cannot be tapped", async () => {
  await mount({ ...PROPS, navigation: undefined });
  await answer(await searchFor("rounding"), { chats: [HERE] });
  expect(text()).toContain("Checkout total");
  expect(buttons()).toEqual([]);
});
