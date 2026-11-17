/**
 * @vitest-environment jsdom
 */
// The 3D office's view, mounted, for where the keyboard goes when the scene calls back. The frame,
// the loaded script and the host's hooks are stand-ins; the scene's API records its start.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeModel } from "../../shared/model.js";
import type { OfficeStyles } from "../styles.js";
import type { WorldApi, WorldStartOptions } from "./world-api.js";
import { WorldView } from "./world-view.js";

const frame = vi.hoisted(() => ({
  focusApp: vi.fn(),
  started: null as WorldStartOptions | null,
  // useSyncExternalStore wants the same snapshot back while nothing changed.
  loaded: { status: "ready", script: "" },
}));

vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => async () => ({}),
  useSettings: () => ({ status: "loading" }),
}));
vi.mock("@getpaseo/plugin/client/ui", () => ({
  useToast: () => ({ error: () => undefined }),
}));
vi.mock("../web-env.web.js", () => ({ readBrand: () => null }));
vi.mock("./world-loader.js", () => ({
  messageOf: (error: unknown) => String(error),
  sharedWorldLoader: {
    subscribe: () => () => undefined,
    state: () => frame.loaded,
    load: async () => undefined,
  },
}));
vi.mock("./world-frame.web.js", () => ({
  focusApp: frame.focusApp,
  openWorldFrame: () => {
    // Every method does nothing but start; "then" stays absent so the promise resolves to it.
    const api = new Proxy({} as WorldApi, {
      get: (_, key) => {
        if (key === "then") return undefined;
        if (key === "start") {
          return (options: WorldStartOptions) => {
            frame.started = options;
          };
        }
        return () => undefined;
      },
    });
    return { api: Promise.resolve(api), dispose: () => undefined };
  },
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

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
  frame.focusApp.mockClear();
  frame.started = null;
  // jsdom lays nothing out: the view starts the office only in a container with a size.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function startedOffice(
  onSelectAgent: (id: string | null) => void,
): Promise<WorldStartOptions> {
  await act(async () =>
    root.render(
      <WorldView
        model={MODEL}
        theme={THEME}
        styles={STYLES}
        focusRoomId={null}
        focusRequest={null}
        selectedAgentId={null}
        onSelectAgent={onSelectAgent}
        onSelectBoard={ignore}
        machine={null}
        onOpenMachine={ignore}
        onOpenResources={undefined}
        onOpenSession={undefined}
        onOpenLibrary={ignore}
        onOpenNotes={ignore}
        meeting={false}
        incidents={undefined}
        onOpenIncidents={ignore}
        onProblem={ignore}
      />,
    ),
  );
  if (frame.started === null) throw new Error("the office did not start");
  return frame.started;
}

test("a person chosen in the scene opens their card and takes the keyboard with it", async () => {
  const onSelectAgent = vi.fn();
  const options = await startedOffice(onSelectAgent);
  options.onSelect?.("agent-1");
  expect(onSelectAgent).toHaveBeenCalledWith("agent-1");
  expect(frame.focusApp).toHaveBeenCalledTimes(1);
});

// Walk in closes an open card (first-person.js enterFp); the walk needs the keys in the frame.
test("a card closed from the scene leaves the keyboard where it is", async () => {
  const onSelectAgent = vi.fn();
  const options = await startedOffice(onSelectAgent);
  options.onSelect?.(null);
  expect(onSelectAgent).toHaveBeenCalledWith(null);
  expect(frame.focusApp).not.toHaveBeenCalled();
});
