/**
 * @vitest-environment jsdom
 */
// The Attribution panel, mounted as the app mounts a workspace panel: with the plugin's calls
// and nothing else. The list is the host's, so react-native's own stands in.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  PluginRpcProvider,
  type PluginSubscribe,
  type PluginSubscriptionObserver,
} from "@getpaseo/plugin/client/host";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import type { Author, FileLines, Files } from "../shared/contracts.js";
import { AttributionPanel } from "./attribution-panel.js";

/** The agents the app knows now; an agent that is not here was closed. */
let liveAgents: Record<string, { title: string | null }>;

vi.mock("@getpaseo/plugin/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/plugin/client")>()),
  useAgent: (id: string, select: (agent: { title: string | null }) => unknown) =>
    liveAgents[id] ? select(liveAgents[id]) : null,
}));

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { FlatList, View } = await import("react-native");
  const { createElement } = await import("react");
  return {
    FlatList,
    Icon: ({ name }: { name: string }) => createElement(View, { testID: `icon-${name}` }),
    Loading: () => createElement(View, { testID: "loading" }),
  };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const NOW = Date.parse("2026-11-15T12:00:00Z");
const ONE: Author = { id: "a1", title: "Checkout total", provider: "claude" };
const TWO: Author = { id: "a2", title: null, provider: "codex" };

const FILES: Files = {
  status: "ready",
  files: [
    { path: "src/cart/total.ts", at: NOW - 5 * 60_000, agents: [ONE, TWO] },
    { path: "README.md", at: NOW - 3 * 3_600_000, agents: [TWO] },
  ],
};

const TOTAL: FileLines = {
  status: "ready",
  lines: ["export function total() {", "  return 1;", "}", "", "// tax", "// both"],
  marks: [
    { start: 2, count: 1, turn: 0 },
    { start: 5, count: 1, turn: 1 },
    { start: 6, count: 1, turn: 2 },
  ],
  turns: [
    { at: Date.parse("2026-11-15T10:32:00Z"), agents: [ONE] },
    { at: Date.parse("2026-11-15T11:05:00Z"), agents: [TWO] },
    { at: Date.parse("2026-11-15T11:40:00Z"), agents: [ONE, TWO] },
  ],
};

let files: Array<Files | Error>;
let lines: Record<string, FileLines | Error>;
let calls: Array<[string, unknown]>;
let observers: PluginSubscriptionObserver[];
let opened: unknown[];
let tabState: unknown;
let container: HTMLElement;
let root: Root;

const subscribe: PluginSubscribe = (_method, _input, observer) => {
  observers.push(observer);
  const close = () => undefined;
  return Object.assign(close, { ready: Promise.resolve(), release: async () => close() });
};

async function invoke(method: string, input: unknown): Promise<unknown> {
  calls.push([method, input]);
  if (method === "attribution.files.read.request") {
    // The last answer repeats.
    const answer = files.length > 1 ? files.shift() : files[0];
    if (answer instanceof Error) throw answer;
    return answer;
  }
  if (method === "attribution.file.read.request") {
    const answer = lines[(input as { path: string }).path];
    if (answer instanceof Error) throw answer;
    return answer;
  }
  throw new Error(`Unexpected call ${method}`);
}

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

function props(compact = false): PluginWorkspacePanelProps {
  return {
    theme: { colors: new Proxy({}, { get: () => "#808080" }) },
    layout: { compact, platform: "web" },
    host: { id: "host", label: "Host" },
    workspaceId: "w1",
    params: {},
    revision: 0,
    context: "workspace",
    navigation: {
      openAgent: (input: unknown) => void opened.push(input),
      openWorkspace() {},
    },
    tab: {
      setModified() {},
      get state() {
        return tabState;
      },
      // The host stores the state and renders the panel again with it.
      setState(next: unknown) {
        tabState = next;
        void mount(compact);
      },
    },
  } as unknown as PluginWorkspacePanelProps;
}

async function mount(compact = false): Promise<void> {
  await act(async () => {
    root.render(
      <PluginRpcProvider invoke={invoke} subscribe={subscribe}>
        <AttributionPanel {...props(compact)} />
      </PluginRpcProvider>,
    );
  });
  await settle();
}

const all = (testId: string) => [
  ...container.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
];
const labelled = (label: string) => {
  const found = [...container.querySelectorAll<HTMLElement>("[aria-label]")].find(
    (each) => each.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`Nothing is labelled "${label}"`);
  return found;
};
const press = async (element: HTMLElement | undefined) => {
  if (!element) throw new Error("Nothing to press");
  await act(async () => element.click());
  await settle();
};
const openTotal = () => press(all("attribution-file")[0]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  liveAgents = { a1: { title: "Checkout total v2" }, a2: { title: null } };
  files = [FILES];
  lines = { "src/cart/total.ts": TOTAL };
  calls = [];
  observers = [];
  opened = [];
  tabState = undefined;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

test("the list has each file agents changed, with its agents by their names now, and its age", async () => {
  await mount();

  expect(container.querySelector('[role="heading"]')?.textContent).toBe("Attribution");
  expect(container.textContent).toContain("2 files changed by agents");
  expect(all("attribution-file").map((row) => row.getAttribute("aria-label"))).toEqual([
    "src/cart/total.ts, changed by Checkout total v2 +1, 5 min ago",
    "README.md, changed by Agent a2, 3 h ago",
  ]);
  expect(calls).toEqual([["attribution.files.read.request", { workspaceId: "w1" }]]);
});

test("a folder that is no checkout, and one nobody worked in, each say so", async () => {
  files = [{ status: "no_checkout" }];
  await mount();
  expect(container.textContent).toContain("Nothing is tracked here");

  files = [{ status: "ready", files: [] }];
  await press(all("attribution-refresh")[0]);
  expect(container.textContent).toContain("No agent has changed a file here yet");
});

test("a list that cannot be read says why, and reads again when asked", async () => {
  files = [new Error("The host is gone"), FILES];
  await mount();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "The files could not be read",
  );
  expect(container.textContent).toContain("The host is gone");

  await press(
    [...container.querySelectorAll<HTMLElement>('[role="button"]')].find(
      (each) => each.textContent === "Try again",
    ),
  );

  expect(all("attribution-file")).toHaveLength(2);
});

test("a recorded change reads the list again", async () => {
  await mount();
  files = [{ status: "ready", files: [FILES.status === "ready" ? FILES.files[1] : never()] }];

  await act(async () => observers[0]?.event({ type: "changed", workspaceIds: ["w1"] }));
  await settle();

  expect(all("attribution-file")).toHaveLength(1);
});

test("a file shows its lines, numbers the agents, and marks the lines they wrote", async () => {
  await mount();

  await openTotal();

  expect(tabState).toEqual({ path: "src/cart/total.ts" });
  expect(container.querySelector('[role="heading"]')?.textContent).toBe("total.ts");
  expect(container.textContent).toContain("Agents wrote 3 of 6 lines");
  // The agent with the most lines is number 1; a shared line counts for both.
  expect(all("attribution-agent").map((chip) => chip.getAttribute("aria-label"))).toEqual([
    "Agent 1, Agent a2, 2 lines",
    "Agent 2, Checkout total v2, 2 lines",
  ]);
  const shown = all("attribution-lines")[0]?.textContent ?? "";
  expect(shown).toContain("export function total() {");
  // Only the lines an agent wrote are controls.
  expect(all("attribution-line").map((line) => line.textContent)).toEqual([
    "22  return 1;",
    "15// tax",
    "1+26// both",
  ]);
});

test("choosing an agent presses its chip, and choosing it again lets go", async () => {
  await mount();
  await openTotal();
  const chip = () => labelled("Agent 2, Checkout total v2, 2 lines");

  await press(chip());
  expect(chip().getAttribute("aria-pressed")).toBe("true");
  expect(labelled("Agent 1, Agent a2, 2 lines").getAttribute("aria-pressed")).toBe("false");

  await press(chip());
  expect(chip().getAttribute("aria-pressed")).toBe("false");
});

test("choosing a line shows its turn and opens its agent", async () => {
  await mount();
  await openTotal();

  await press(all("attribution-line")[0]);

  const turn = all("attribution-turn")[0];
  expect(turn?.textContent).toContain("Line 2");
  expect(turn?.textContent).toContain("Checkout total v2");
  await press(labelled("Open the agent Checkout total v2"));
  expect(opened).toEqual([{ agentId: "a1" }]);

  await press(labelled("Hide the turn"));
  expect(all("attribution-turn")).toHaveLength(0);
});

test("a line two agents share names both, and a closed agent has no button", async () => {
  liveAgents = { a1: { title: "Checkout total v2" } };
  await mount();
  await openTotal();

  await press(all("attribution-line")[2]);

  const turn = all("attribution-turn")[0];
  expect(turn?.textContent).toContain("written while these agents ran together");
  // The closed agent keeps the name its lines were recorded under.
  expect(turn?.textContent).toContain("Agent a2");
  expect(all("attribution-open-agent")).toHaveLength(1);
});

test("back returns to the list, and the tab forgets the file", async () => {
  await mount();
  await openTotal();

  await press(all("attribution-back")[0]);

  expect(tabState).toEqual({ path: null });
  expect(all("attribution-file")).toHaveLength(2);
});

test("a tab that remembers a file opens on it", async () => {
  tabState = { path: "src/cart/total.ts" };

  await mount();

  expect(container.querySelector('[role="heading"]')?.textContent).toBe("total.ts");
  expect(calls).toEqual([
    ["attribution.file.read.request", { workspaceId: "w1", path: "src/cart/total.ts" }],
  ]);
});

test("a file with no lines to show says why", async () => {
  lines = {
    "src/cart/total.ts": { status: "binary" },
    "README.md": new Error("The host is gone"),
  };
  await mount();

  await openTotal();
  expect(container.textContent).toContain("This file is not text.");

  await press(all("attribution-back")[0]);
  await press(all("attribution-file")[1]);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("The file could not be read");
});

function never(): never {
  throw new Error("The fixture has no such file");
}
