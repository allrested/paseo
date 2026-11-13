/**
 * @vitest-environment jsdom
 */
// The panel, mounted: what it asks the host, what it shows, and what a touch sends. jsdom lays
// nothing out, so a test gives the stage its size and the touched view its rectangle.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  PluginRpcProvider,
  type PluginSubscribe,
  type PluginSubscriptionObserver,
} from "@getpaseo/plugin/client/host";
import type { AndroidInput, AndroidStreamEvent } from "../shared/contracts.js";
import { AndroidSurface, NO_DEVICE } from "./android-surface.js";

// useSettings and the SDK's TextInput are supplied by the app at runtime.
const settingsSaved: Array<[unknown, string]> = [];
vi.mock("@getpaseo/plugin/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/plugin/client")>()),
  useSettings: () => ({
    status: "ready",
    revision: "1",
    values: { agentTools: true },
    saveError: null,
    save: async (values: unknown, revision: string) => {
      settingsSaved.push([values, revision]);
      return true;
    },
  }),
}));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { TextInput: Input } = await import("react-native");
  return { TextInput: Input };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let resized: (entries: Array<{ target: Element }>) => void = () => {
  throw new Error("No view has asked for its layout");
};
vi.stubGlobal(
  "ResizeObserver",
  class {
    constructor(callback: (entries: Array<{ target: Element }>) => void) {
      resized = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

interface OpenedStream {
  observer: PluginSubscriptionObserver;
  closed: boolean;
}

const PROPS = {
  theme: { colors: new Proxy({}, { get: () => "#808080" }) },
  layout: { compact: true, platform: "web" },
  params: {},
} as unknown as PluginScreenProps;

let streams: OpenedStream[];
let calls: Array<[string, unknown]>;
let stateAnswer: () => Promise<unknown>;
let container: HTMLElement;
let root: Root;

const subscribe: PluginSubscribe = (_method, _input, observer) => {
  const stream: OpenedStream = { observer, closed: false };
  streams.push(stream);
  const close = () => {
    stream.closed = true;
  };
  return Object.assign(close, { ready: Promise.resolve(), release: async () => close() });
};

async function invoke(method: string, input: unknown): Promise<unknown> {
  calls.push([method, input]);
  if (method === "android.state.request") return stateAnswer();
  return { ok: true };
}

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));
const inputs = () =>
  calls
    .filter(([method]) => method === "android.stream.input.request")
    .map(([, input]) => input as AndroidInput);

let stage: Element | null = null;

/** Found by the text it holds before any stream opens, then kept. */
function stageElement(): Element {
  if (stage !== null) return stage;
  const waiting = [...container.querySelectorAll("div")].find(
    (element) =>
      element.children.length === 0 &&
      element.textContent === "Connecting to the Android device...",
  );
  stage = waiting!.parentElement!;
  return stage;
}

async function layout(width: number, height: number): Promise<void> {
  const target = stageElement();
  Object.defineProperty(target, "offsetWidth", { configurable: true, value: width });
  Object.defineProperty(target, "offsetHeight", { configurable: true, value: height });
  resized([{ target }]);
  await settle();
}

async function hostSays(stream: OpenedStream, event: AndroidStreamEvent): Promise<void> {
  await act(async () => stream.observer.event(event));
  await settle();
}

beforeEach(async () => {
  streams = [];
  stage = null;
  calls = [];
  settingsSaved.length = 0;
  stateAnswer = async () => ({ available: true, agentTools: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <PluginRpcProvider invoke={invoke} subscribe={subscribe}>
        <AndroidSurface {...PROPS} />
      </PluginRpcProvider>,
    ),
  );
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("asks the host once whether a device is there", () => {
  expect(calls.filter(([method]) => method === "android.state.request")).toHaveLength(1);
});

test("a host with no device shows one line and opens no stream", async () => {
  act(() => root.unmount());
  root = createRoot(container);
  stateAnswer = async () => ({ available: false, agentTools: false });
  await act(async () =>
    root.render(
      <PluginRpcProvider invoke={invoke} subscribe={subscribe}>
        <AndroidSurface {...PROPS} />
      </PluginRpcProvider>,
    ),
  );
  await settle();

  expect(container.textContent).toBe(NO_DEVICE);
  expect(streams).toHaveLength(0);
});

test("a host that does not serve the call means no device", async () => {
  act(() => root.unmount());
  root = createRoot(container);
  stateAnswer = async () => {
    throw new Error("Unknown RPC method: android.state.request");
  };
  await act(async () =>
    root.render(
      <PluginRpcProvider invoke={invoke} subscribe={subscribe}>
        <AndroidSurface {...PROPS} />
      </PluginRpcProvider>,
    ),
  );
  await settle();

  expect(container.textContent).toBe(NO_DEVICE);
});

test("the stream opens once the stage has a size, and closes when it has none", async () => {
  expect(streams).toHaveLength(0);

  await layout(360, 1000);
  expect(streams.filter((stream) => !stream.closed)).toHaveLength(1);

  await layout(0, 0);
  expect(streams.filter((stream) => !stream.closed)).toHaveLength(0);
});

test("a tap on the picture sends one tap in device pixels", async () => {
  await layout(360, 1000);
  const stream = streams[0]!;
  await hostSays(stream, { type: "ready", streamId: "s1", width: 720, height: 1280 });
  await hostSays(stream, { type: "picture", seq: 1, png: "AAA" });
  expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAA");
  calls.length = 0;

  // The picture is 360 x 640 in a 360 x 1000 stage: it starts 180 px down.
  const touched = container.querySelector('[aria-label="Android device"]')!;
  touched.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 360, height: 1000, right: 360, bottom: 1000 }) as DOMRect;
  await act(async () => {
    touched.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 180, clientY: 500 }),
    );
    touched.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 180, clientY: 500 }));
  });
  await settle();

  expect(inputs().filter((input) => input.tap)).toEqual([
    { streamId: "s1", tap: { x: 360, y: 640 } },
  ]);
});

test("a touch above the picture sends nothing", async () => {
  await layout(360, 1000);
  const stream = streams[0]!;
  await hostSays(stream, { type: "ready", streamId: "s1", width: 720, height: 1280 });
  await hostSays(stream, { type: "picture", seq: 1, png: "AAA" });
  calls.length = 0;

  const touched = container.querySelector('[aria-label="Android device"]')!;
  touched.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 360, height: 1000, right: 360, bottom: 1000 }) as DOMRect;
  await act(async () => {
    touched.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, clientX: 180, clientY: 50 }),
    );
    touched.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 180, clientY: 50 }));
  });
  await settle();

  expect(inputs().filter((input) => input.tap)).toEqual([]);
});

test("Back, Home and Recents send their keys", async () => {
  await layout(360, 1000);
  await hostSays(streams[0]!, { type: "ready", streamId: "s1", width: 720, height: 1280 });

  for (const label of ["Back", "Home", "Recents"]) {
    const button = container.querySelector(`[aria-label="${label}"]`)!;
    await act(async () => (button as HTMLElement).click());
    await settle();
  }

  expect(inputs().map((input) => input.key)).toEqual(["back", "home", "recents"]);
});

test("Send types the text and clears the field", async () => {
  await layout(360, 1000);
  await hostSays(streams[0]!, { type: "ready", streamId: "s1", width: 720, height: 1280 });
  const field = container.querySelector("input")!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    set.call(field, "hello");
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await act(async () => (container.querySelector('[aria-label="Send"]') as HTMLElement).click());
  await settle();

  expect(inputs().map((input) => input.text)).toEqual(["hello"]);
  expect(container.querySelector("input")!.value).toBe("");
});

test("the unreachable problem shows with Retry, and Retry opens the stream again", async () => {
  await layout(360, 1000);
  await hostSays(streams[0]!, {
    type: "problem",
    message: "The Android device is unreachable",
  });
  expect(container.textContent).toContain("The Android device is unreachable");

  await act(async () => (container.querySelector('[aria-label="Retry"]') as HTMLElement).click());
  await settle();

  expect(streams).toHaveLength(2);
  expect(container.textContent).not.toContain("The Android device is unreachable");
});

test("a new ready on the same stream shows its own first picture", async () => {
  await layout(360, 1000);
  const stream = streams[0]!;
  await hostSays(stream, { type: "ready", streamId: "s1", width: 720, height: 1280 });
  await hostSays(stream, { type: "picture", seq: 40, png: "OLD" });

  await hostSays(stream, { type: "ready", streamId: "s2", width: 720, height: 1280 });
  expect(container.querySelector("img")).toBeNull();
  await hostSays(stream, { type: "picture", seq: 1, png: "NEW" });

  expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,NEW");
  expect(inputs().at(-1)).toEqual({ streamId: "s2", shown: 1 });
});

test("the Agent tools switch saves the host setting against its revision", async () => {
  const toggle = container.querySelector('[aria-label="Agent tools"]');
  // Shown only with a device: the surface is still asking until the first layout.
  expect(toggle).not.toBeNull();

  await act(async () => (toggle as HTMLElement).click());
  await settle();

  expect(settingsSaved).toEqual([[{ agentTools: false }, "1"]]);
});
