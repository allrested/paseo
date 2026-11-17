/**
 * @vitest-environment jsdom
 */
// The 3D office's native view, mounted with ScriptFrame faked: what it posts to the page, in
// order, and what it does with what the page posts back.
import { act, forwardRef, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeModel } from "../../shared/model.js";
import type { OfficeStyles } from "../styles.js";
import { WorldViewNative } from "./world-view-native.js";

const h = vi.hoisted(() => ({
  posted: [] as string[],
  props: null as {
    script: string;
    title: string;
    onMessage(t: string): void;
    onError?(m: string): void;
  } | null,
  loaded: { status: "ready", script: "SCENE_SCRIPT" },
}));

vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => async () => ({}),
  useSettings: () => ({ status: "loading" }),
}));
vi.mock("@getpaseo/plugin/client/ui", () => ({ useToast: () => ({ error: () => undefined }) }));
vi.mock("./script-frame-kit.js", async () => {
  const Frame = forwardRef((props: NonNullable<typeof h.props>, ref) => {
    h.props = props;
    useImperativeHandle(ref, () => ({ post: (text: string) => h.posted.push(text) }));
    return null;
  });
  return { kitScriptFrame: () => Frame, hasScriptFrame: () => true };
});
vi.mock("./world-loader.js", () => ({
  messageOf: (error: unknown) => String(error),
  sharedWorldLoader: {
    subscribe: () => () => undefined,
    state: () => h.loaded,
    load: async () => undefined,
  },
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const STYLES = new Proxy({}, { get: () => ({}) }) as OfficeStyles;
const MODEL: OfficeModel = {
  rooms: [],
  attention: [],
  agentTasks: [],
  agents: new Map(),
  roomOfAgent: new Map(),
  waitingOn: new Map(),
};
const ignore = () => undefined;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  h.posted = [];
  h.props = null;
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

async function mount(overrides: Partial<Parameters<typeof WorldViewNative>[0]> = {}) {
  const props = {
    model: MODEL,
    theme: THEME,
    styles: STYLES,
    focusRoomId: null,
    focusRequest: null,
    selectedAgentId: null,
    onSelectAgent: ignore,
    onSelectBoard: ignore,
    machine: null,
    onOpenMachine: ignore,
    onOpenResources: undefined,
    onOpenSession: undefined,
    onOpenLibrary: ignore,
    onOpenNotes: ignore,
    meeting: false,
    incidents: undefined,
    onOpenIncidents: ignore,
    onProblem: ignore,
    ...overrides,
  };
  await act(async () => root.render(<WorldViewNative {...props} />));
}

const calls = () => h.posted.map((text) => JSON.parse(text) as { call: string; args: unknown[] });

test("the frame runs the bridge's page with the scene's script, under the office's title", async () => {
  await mount();
  expect(h.props?.title).toBe("Office in 3D");
  expect(h.props?.script).toContain("SCENE_SCRIPT");
  expect(h.props?.script).toContain("PaseoOfficeWorld");
});

test("start is the first message; photo is off; the feed follows in order", async () => {
  await mount();
  const [start, ...rest] = calls();
  expect(start.call).toBe("start");
  const options = start.args[0] as Record<string, unknown>;
  expect(options.photo).toBe(false);
  expect(options.brand).toEqual({ name: "Paseo", logoUrl: null });
  expect(options.callbacks).toEqual(
    expect.arrayContaining([
      "onSelect",
      "onBoard",
      "onMachine",
      "onLibrary",
      "onBell",
      "onNotes",
      "onIncidents",
      "onProblem",
    ]),
  );
  expect(options.callbacks).not.toContain("onOpen");
  expect(options.callbacks).not.toContain("onResources");
  const names = rest.map((message) => message.call);
  expect(names).toEqual(
    expect.arrayContaining(["setTheme", "setSessions", "setBoardRows", "setMachine", "select"]),
  );
  // the people are seated before the view looks at any
  expect(names.indexOf("setSessions")).toBeLessThan(names.indexOf("select"));
});

test("onOpen is given where the office can open a session", async () => {
  await mount({ onOpenSession: ignore });
  expect((calls()[0].args[0] as { callbacks: string[] }).callbacks).toContain("onOpen");
});

test("a person chosen in the scene opens their card", async () => {
  const onSelectAgent = vi.fn();
  await mount({ onSelectAgent });
  act(() => h.props?.onMessage(JSON.stringify({ callback: "onSelect", args: ["a1"] })));
  expect(onSelectAgent).toHaveBeenCalledWith("a1");
});

test("a problem the page posts, and a frame error, reach the surface", async () => {
  const onProblem = vi.fn();
  await mount({ onProblem });
  act(() => h.props?.onMessage(JSON.stringify({ problem: "WebGL2 is not available" })));
  act(() => h.props?.onError?.("The page's process ended"));
  expect(onProblem.mock.calls).toEqual([["WebGL2 is not available"], ["The page's process ended"]]);
});

test("closing the view tells the page to stop", async () => {
  await mount();
  h.posted = [];
  act(() => root.unmount());
  expect(calls().map((message) => message.call)).toEqual(["stop"]);
  root = createRoot(container);
});
