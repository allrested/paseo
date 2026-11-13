/**
 * @vitest-environment jsdom
 */
// The editor tab on a phone, mounted: the bridge's picture, the open threads, and a tap that
// becomes a comment at that spot. The plugin UI kit is the host's, so plain stand-ins take its
// place; jsdom loads no images and lays nothing out, so the test gives the sizes.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Image, ScrollView, TextInput } from "react-native";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  PluginRpcProvider,
  type PluginSubscribe,
  type PluginSubscriptionObserver,
} from "@getpaseo/plugin/client/host";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import type { FileRow, ViewEvent } from "../shared/contracts.js";
import { EditorView } from "./editor-view.js";
import { useDesignStyles } from "./styles.js";

vi.mock("@getpaseo/plugin/client/ui", () => {
  const Modal = Object.assign(
    ({ open, title, children }: { open: boolean; title: string; children: ReactNode }) =>
      open ? createElement("section", { "aria-label": title }, children) : null,
    { Content: ({ children }: { children: ReactNode }) => children },
  );
  return {
    Modal,
    ScrollView,
    TextInput,
    Icon: () => null,
    useToast: () => ({ show() {}, error() {} }),
  };
});

const THEME = {
  id: "light",
  name: "Light",
  appearance: "light" as const,
  colors: {
    surface0: "#ffffff",
    surface1: "#fafafa",
    surface2: "#f4f4f5",
    border: "#e4e4e7",
    foreground: "#18181b",
    foregroundMuted: "#71717a",
    accent: "#d97757",
    accentForeground: "#ffffff",
    statusSuccess: "#2f855a",
    statusWarning: "#b7791f",
    statusDanger: "#c53030",
  },
} as never;

const FILE: FileRow = {
  id: "f1",
  projectKey: "p1",
  name: "Login",
  createdAt: 0,
  lastAgentId: null,
  status: "running",
  error: null,
  outOfStep: false,
};

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let resized: (entries: { target: Element }[]) => void = () => {
  throw new Error("No view has asked for its layout");
};
vi.stubGlobal(
  "ResizeObserver",
  class {
    constructor(callback: (entries: { target: Element }[]) => void) {
      resized = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

let views: { input: unknown; observer: PluginSubscriptionObserver }[];
let calls: { method: string; input: unknown }[];
let container: HTMLElement;
let root: Root;

const subscribe: PluginSubscribe = (_method, input, observer) => {
  views.push({ input, observer });
  return Object.assign(() => {}, { ready: Promise.resolve(), release: async () => {} });
};

async function invoke(method: string, input: unknown): Promise<unknown> {
  calls.push({ method, input });
  return { ok: true };
}

// Only what the editor reads; the rest of a panel's props are the host's.
const PANEL = {
  workspaceId: "w1",
  theme: THEME,
  layout: { compact: true, platform: "android" },
} as unknown as PluginWorkspacePanelProps;

function close(): void {}

function Mounted() {
  const styles = useDesignStyles(THEME, true, true);
  return (
    <PluginRpcProvider invoke={invoke} subscribe={subscribe}>
      <EditorView {...PANEL} file={FILE} styles={styles} onClose={close} />
    </PluginRpcProvider>
  );
}

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

async function bridgeSays(event: ViewEvent): Promise<void> {
  await act(async () => views[0].observer.event(event));
  await settle();
}

function byLabel(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`Nothing labelled ${label}`);
  return found;
}

beforeEach(async () => {
  views = [];
  calls = [];
  vi.spyOn(Image, "getSize").mockImplementation((_uri, success) => success(400, 200));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Mounted />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

test("asks the bridge for pictures, and shows the latest one with the open threads", async () => {
  expect(views.map((view) => view.input)).toEqual([
    { fileId: "f1", workspaceId: "w1", pictures: true, attempt: 0 },
  ]);
  expect(container.textContent).toContain("Drawing the design...");

  await bridgeSays({ type: "picture", seq: 1, uri: "data:image/png;base64,AAAA" });
  await bridgeSays({
    type: "threads",
    threads: [{ id: "4294967302", author: "Guest 3", preview: "Make it rounder" }],
  });

  expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  expect(container.textContent).toContain("Make it rounder");
  expect(container.textContent).not.toContain("Drawing the design...");
});

test("a tap without a position opens no comment", async () => {
  await bridgeSays({ type: "picture", seq: 1, uri: "data:image/png;base64,AAAA" });
  const picture = byLabel("Login. Tap a spot to comment on it");
  await act(async () => {
    picture.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
  expect(container.querySelector('[aria-label="Add comment"]')).toBeNull();
});

test("says so when the page is empty", async () => {
  await bridgeSays({ type: "picture", seq: 1, uri: null });
  expect(container.textContent).toContain("Nothing on this page yet");
});

test("a tap on the picture becomes a comment at that spot of the page", async () => {
  await bridgeSays({ type: "picture", seq: 1, uri: "data:image/png;base64,AAAA" });
  const picture = byLabel("Login. Tap a spot to comment on it");
  Object.defineProperty(picture, "offsetWidth", { configurable: true, value: 200 });
  Object.defineProperty(picture, "offsetHeight", { configurable: true, value: 200 });
  resized([{ target: picture }]);
  await settle();

  // A 400 x 200 picture contained in 200 x 200: drawn 200 x 100, its centre at (100, 100).
  // A browser click carries offsetX/Y; jsdom leaves them out.
  const click = new MouseEvent("click", { bubbles: true });
  Object.defineProperty(click, "offsetX", { value: 100 });
  Object.defineProperty(click, "offsetY", { value: 100 });
  await act(async () => {
    picture.dispatchEvent(click);
  });
  await settle();
  const sheet = byLabel("Add comment");
  const field = sheet.querySelector("textarea");
  if (!field) throw new Error("No comment field");
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setValue?.call(field, "Rounder corners");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const button = sheet.querySelector<HTMLElement>('[role="button"][aria-label="Comment"]');
  if (!button) throw new Error("No Comment button");
  await act(async () => button.click());
  await settle();

  expect(calls).toContainEqual({
    method: "design.comment.request",
    input: { fileId: "f1", x: 0.5, y: 0.5, text: "Rounder corners" },
  });
});
