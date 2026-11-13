/**
 * @vitest-environment jsdom
 */
// The streamed view, mounted: when it holds a stream on the host and what it tells that stream.
// jsdom lays nothing out, so a test gives the view its size and says the size changed.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  PluginRpcProvider,
  type PluginSubscribe,
  type PluginSubscriptionObserver,
} from "@getpaseo/plugin/client/host";
import type { RenderEvent, RenderInputMessage } from "../../shared/contracts.js";
import { useOfficeStyles } from "../styles.js";
import { LIGHT_THEME_COLORS } from "./fake-theme.js";
import { StreamView } from "./stream-view.js";

const THEME = { colors: LIGHT_THEME_COLORS };

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
// React Native Web makes one observer for every view, the first time a view asks for its layout.
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
  input: unknown;
  observer: PluginSubscriptionObserver;
  closed: boolean;
}

let streams: OpenedStream[];
let calls: RenderInputMessage[];
let problems: string[];
let visibility: "visible" | "hidden";
let container: HTMLElement;
let root: Root;

const subscribe: PluginSubscribe = (_method, input, observer) => {
  const stream: OpenedStream = { input, observer, closed: false };
  streams.push(stream);
  const close = () => {
    stream.closed = true;
  };
  return Object.assign(close, { ready: Promise.resolve(), release: async () => close() });
};

async function invoke(_method: string, input: unknown): Promise<unknown> {
  calls.push(input as RenderInputMessage);
  return { ok: true };
}

function ignoreSelection(): void {}

function onProblem(message: string): void {
  problems.push(message);
}

function Mounted() {
  const styles = useOfficeStyles(THEME, true, true);
  return (
    <PluginRpcProvider invoke={invoke} subscribe={subscribe}>
      <StreamView
        theme={THEME}
        styles={styles}
        coarsePointer
        focusRoomId={null}
        focusRequest={null}
        onSelectAgent={ignoreSelection}
        onSelectBoard={ignoreSelection}
        onProblem={onProblem}
      />
    </PluginRpcProvider>
  );
}

/** Lets the view's measurement and the calls it queued run. */
const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

async function layout(width: number, height: number): Promise<void> {
  const scene = container.firstElementChild!;
  Object.defineProperty(scene, "offsetWidth", { configurable: true, value: width });
  Object.defineProperty(scene, "offsetHeight", { configurable: true, value: height });
  resized([{ target: scene }]);
  await settle();
}

async function appGoes(next: "visible" | "hidden"): Promise<void> {
  visibility = next;
  await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
}

async function hostSays(stream: OpenedStream, event: RenderEvent): Promise<void> {
  await act(async () => stream.observer.event(event));
  await settle();
}

const picture = (seq: number, jpeg: string): RenderEvent => ({
  type: "picture",
  seq,
  jpeg,
  width: 585,
  height: 1050,
});

const openStreams = () => streams.filter((stream) => !stream.closed);
const resizes = () => calls.filter((call) => call.resize !== undefined);

beforeEach(async () => {
  streams = [];
  calls = [];
  problems = [];
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Mounted />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("the stream opens at the view's first size", async () => {
  expect(streams).toHaveLength(0);

  await layout(390, 700);

  expect(streams.map((stream) => stream.input)).toEqual([
    expect.objectContaining({ width: 390, height: 700, coarsePointer: true }),
  ]);
  expect(openStreams()).toHaveLength(1);
});

test("a view that is hidden closes its stream, and opens a new one when it shows again", async () => {
  await layout(390, 700);

  // A hidden workspace tab measures nothing.
  await layout(0, 0);
  expect(openStreams()).toHaveLength(0);

  await layout(390, 700);
  expect(streams).toHaveLength(2);
  expect(openStreams()).toHaveLength(1);
  expect(problems).toEqual([]);
});

test("the app in the background closes the stream, and back in front opens a new one", async () => {
  await layout(390, 700);

  await appGoes("hidden");
  expect(openStreams()).toHaveLength(0);

  await appGoes("visible");
  expect(streams).toHaveLength(2);
  expect(openStreams()).toHaveLength(1);
  expect(problems).toEqual([]);
});

test("turned and turned back, the host is told the opening size again", async () => {
  await layout(390, 700);
  await hostSays(streams[0]!, { type: "ready", streamId: "s1" });

  await layout(700, 390);
  await layout(390, 700);

  expect(streams).toHaveLength(1);
  expect(resizes().map((call) => [call.streamId, call.resize?.width, call.resize?.height])).toEqual(
    [
      ["s1", 700, 390],
      ["s1", 390, 700],
    ],
  );
});

test("a new stream on the same view, as after a reconnect, shows its own first picture", async () => {
  await layout(390, 700);
  const stream = streams[0]!;
  await hostSays(stream, { type: "ready", streamId: "s1" });
  await hostSays(stream, picture(40, "OLD"));

  await hostSays(stream, { type: "ready", streamId: "s2" });
  expect(container.querySelector("img")).toBeNull();

  await hostSays(stream, picture(1, "NEW"));
  expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/jpeg;base64,NEW");
  expect(calls.at(-1)).toEqual({ streamId: "s2", shown: 1 });
});

test("a new stream on the same view is told the view's size when it is not the opening one", async () => {
  await layout(390, 700);
  const stream = streams[0]!;
  await hostSays(stream, { type: "ready", streamId: "s1" });
  await layout(700, 390);

  // The host opens the new stream's page at the size the view first asked for.
  await hostSays(stream, { type: "ready", streamId: "s2" });

  expect(resizes().at(-1)).toEqual({
    streamId: "s2",
    resize: expect.objectContaining({ width: 700, height: 390 }),
  });
});
