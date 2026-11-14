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

/** What design.edit.request answers, in turn; the bridge's side is tested on its own. */
let editReplies: unknown[];

async function invoke(method: string, input: unknown): Promise<unknown> {
  calls.push({ method, input });
  if (method === "design.edit.request") return editReplies.shift();
  return { ok: true };
}

// Only what the editor reads; the rest of a panel's props are the host's.
const PANEL = {
  workspaceId: "w1",
  theme: THEME,
  layout: { compact: true, platform: "android" },
} as unknown as PluginWorkspacePanelProps;

function close(): void {}

// A phone browser: web, but compact, so it gets the phone's view and not FigCraft's editor.
const PHONE_BROWSER = {
  ...PANEL,
  layout: { compact: true, platform: "web" },
} as unknown as PluginWorkspacePanelProps;

function Mounted(props: { panel?: PluginWorkspacePanelProps }) {
  const styles = useDesignStyles(THEME, true, true);
  return (
    <PluginRpcProvider invoke={invoke} subscribe={subscribe}>
      <EditorView {...(props.panel ?? PANEL)} file={FILE} styles={styles} onClose={close} />
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
  editReplies = [];
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

test("a phone browser gets the picture to comment on, not the editor", async () => {
  act(() => root.unmount());
  views = [];
  root = createRoot(container);
  await act(async () => root.render(<Mounted panel={PHONE_BROWSER} />));
  expect(views.map((view) => view.input)).toEqual([
    { fileId: "f1", workspaceId: "w1", pictures: true, attempt: 0 },
  ]);
  expect(calls.map((call) => call.method)).not.toContain("design.editor_link.request");
  expect(container.textContent).not.toContain("Send to agent");
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

const LABEL = {
  id: "2",
  name: "Label",
  type: "TEXT",
  width: 100,
  height: 20,
  text: "Sign in",
  fill: { token: null, color: "#000000" },
  box: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
};

async function pictureOnScreen(): Promise<HTMLElement> {
  await bridgeSays({ type: "picture", seq: 1, uri: "data:image/png;base64,AAAA" });
  const picture = byLabel("Login. Tap a spot to comment on it");
  Object.defineProperty(picture, "offsetWidth", { configurable: true, value: 200 });
  Object.defineProperty(picture, "offsetHeight", { configurable: true, value: 200 });
  resized([{ target: picture }]);
  await settle();
  return picture;
}

async function press(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
  await settle();
}

function inside(scope: HTMLElement, role: string, label: string): HTMLElement {
  const found = [...scope.querySelectorAll<HTMLElement>(`[role="${role}"]`)].find(
    (element) => element.getAttribute("aria-label") === label || element.textContent === label,
  );
  if (!found) throw new Error(`No ${role} ${label}`);
  return found;
}

async function tapCentre(picture: HTMLElement): Promise<void> {
  const click = new MouseEvent("click", { bubbles: true });
  Object.defineProperty(click, "offsetX", { value: 100 });
  Object.defineProperty(click, "offsetY", { value: 100 });
  await act(async () => {
    picture.dispatchEvent(click);
  });
  await settle();
}

const editCalls = () =>
  calls.filter((call) => call.method === "design.edit.request").map((call) => call.input);

test("in Edit, a tap picks the layer there, outlines it and opens its sheet", async () => {
  await pictureOnScreen();
  await press(inside(container, "radio", "Edit"));
  editReplies.push({
    ok: true,
    layer: LABEL,
    here: [
      { id: "2", name: "Label", type: "TEXT" },
      { id: "1", name: "Card", type: "FRAME" },
    ],
    colors: [{ name: "color/accent", hex: "#3366CC" }],
  });
  await tapCentre(byLabel("Login. Tap a layer to edit it"));

  expect(editCalls()).toEqual([{ fileId: "f1", action: { type: "pick", x: 0.5, y: 0.5 } }]);
  const sheet = byLabel("Edit layer");
  expect(sheet.textContent).toContain("Text · 100 × 20 · Fill #000000");
  expect(inside(sheet, "radio", "Card")).toBeTruthy();
  // The 400 x 200 picture drawn 200 x 100 from y = 50: the box's middle half.
  const outline = container.querySelector<HTMLElement>('[data-testid="layer-outline"]');
  if (!outline) throw new Error("No outline");
  const placed = getComputedStyle(outline);
  expect([placed.left, placed.top, placed.width, placed.height]).toEqual([
    "50px",
    "75px",
    "100px",
    "50px",
  ]);
  // Nothing to undo yet.
  expect(inside(sheet, "button", "Undo").getAttribute("aria-disabled")).toBe("true");
});

test("the sheet's edits go to the bridge and show the layer as it comes back", async () => {
  await pictureOnScreen();
  await press(inside(container, "radio", "Edit"));
  editReplies.push({
    ok: true,
    layer: LABEL,
    here: [],
    colors: [{ name: "color/accent", hex: "#3366CC" }],
  });
  await tapCentre(byLabel("Login. Tap a layer to edit it"));
  const sheet = byLabel("Edit layer");

  const field = sheet.querySelector("textarea");
  if (!field) throw new Error("No text field");
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setValue?.call(field, "Log in");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  editReplies.push({ ok: true, layer: { ...LABEL, text: "Log in" }, here: [], colors: [] });
  await press(inside(sheet, "button", "Apply text"));
  editReplies.push({
    ok: true,
    layer: { ...LABEL, text: "Log in", fill: { token: "color/accent", color: "#3366CC" } },
    here: [],
    colors: [],
  });
  await press(inside(sheet, "radio", "color/accent"));
  editReplies.push({ ok: true, layer: LABEL, here: [], colors: [] });
  await press(inside(sheet, "radio", "10 px"));
  await press(inside(sheet, "button", "Right"));
  editReplies.push({ ok: true, layer: null, here: [], colors: [] });
  await press(inside(sheet, "button", "Delete"));

  expect(editCalls().slice(1)).toEqual([
    { fileId: "f1", action: { type: "change", id: "2", change: { kind: "text", text: "Log in" } } },
    {
      fileId: "f1",
      action: { type: "change", id: "2", change: { kind: "fill", token: "color/accent" } },
    },
    { fileId: "f1", action: { type: "change", id: "2", change: { kind: "move", dx: 10, dy: 0 } } },
    { fileId: "f1", action: { type: "change", id: "2", change: { kind: "delete" } } },
  ]);
  expect(sheet.textContent).toContain("Deleted. Undo brings it back");
  editReplies.push({ ok: true, layer: LABEL, here: [], colors: [] });
  await press(inside(sheet, "button", "Undo"));
  expect(editCalls().at(-1)).toEqual({ fileId: "f1", action: { type: "undo", id: "2" } });
  expect(sheet.textContent).toContain("Text · 100 × 20");
});

test("a tap with no layer under it, or a failed edit, says so", async () => {
  await pictureOnScreen();
  await press(inside(container, "radio", "Edit"));
  editReplies.push({ ok: true, layer: null, here: [], colors: [] });
  await tapCentre(byLabel("Login. Tap a layer to edit it"));
  expect(container.textContent).toContain("Nothing to edit there. Tap a layer");
  expect(container.querySelector('[aria-label="Edit layer"]')).toBeNull();

  editReplies.push({ ok: true, layer: LABEL, here: [], colors: [] });
  await tapCentre(byLabel("Login. Tap a layer to edit it"));
  editReplies.push({ ok: false, error: "This layer is gone. Tap it again" });
  await press(inside(byLabel("Edit layer"), "button", "Wider"));
  expect(byLabel("Edit layer").textContent).toContain(
    "Unable to resize the layer: This layer is gone. Tap it again",
  );
});
