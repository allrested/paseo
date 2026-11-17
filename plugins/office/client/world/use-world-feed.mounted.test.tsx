/**
 * @vitest-environment jsdom
 */
// What the hook sends a started scene, with a recording stand-in for the scene's API.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeModel } from "../../shared/model.js";
import { useWorldFeed, type WorldFeedInput } from "./use-world-feed.js";
import type { WorldApi } from "./world-api.js";

vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: () => ({ status: "loading" }),
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const MODEL: OfficeModel = {
  rooms: [],
  attention: [],
  agentTasks: [],
  agents: new Map(),
  roomOfAgent: new Map(),
  waitingOn: new Map(),
};
const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

function input(overrides: Partial<WorldFeedInput> = {}): WorldFeedInput {
  return {
    model: MODEL,
    theme: THEME,
    focusRoomId: null,
    focusRequest: null,
    selectedAgentId: null,
    machine: null,
    meeting: false,
    incidents: undefined,
    ...overrides,
  };
}

function fakeScene() {
  const calls: string[] = [];
  const api = new Proxy({} as WorldApi, {
    get:
      (_, name: string) =>
      (...args: unknown[]) =>
        calls.push(`${name}:${JSON.stringify(args)}`),
  });
  return { api, calls };
}

let container: HTMLElement;
let root: Root;
let note: string | null = "unset";

function Probe(props: { api: WorldApi | null; feed: WorldFeedInput }) {
  note = useWorldFeed(props.api, props.feed).note;
  return null;
}

beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

test("sends nothing while there is no scene", async () => {
  const { calls } = fakeScene();
  await act(async () => root.render(<Probe api={null} feed={input()} />));
  await act(async () =>
    root.render(<Probe api={null} feed={input({ selectedAgentId: "a1", meeting: true })} />),
  );
  expect(note).toBeNull();
  expect(calls).toEqual([]);
});

test("sends nothing once the scene is gone, whatever changes after", async () => {
  const { api, calls } = fakeScene();
  await act(async () => root.render(<Probe api={api} feed={input()} />));
  await act(async () => root.render(<Probe api={null} feed={input()} />));
  calls.length = 0;
  await act(async () =>
    root.render(
      <Probe
        api={null}
        feed={input({
          selectedAgentId: "a1",
          meeting: true,
          focusRequest: { agentId: "a2", nonce: 1 },
        })}
      />,
    ),
  );
  expect(calls).toEqual([]);
  expect(note).toBeNull();
});

test("seats the people, writes the board, sets the machine and the selection once the scene starts", async () => {
  const { api, calls } = fakeScene();
  await act(async () => root.render(<Probe api={api} feed={input()} />));
  const names = calls.map((call) => call.split(":")[0]);
  expect(names).toEqual(
    expect.arrayContaining(["setTheme", "setSessions", "setBoardRows", "setMachine", "select"]),
  );
  expect(calls).toContain("setSessions:[[]]");
  expect(calls).toContain("setMachine:[null]");
  expect(calls).toContain("select:[null]");
});

test("follows the selection and the stand-up", async () => {
  const { api, calls } = fakeScene();
  await act(async () => root.render(<Probe api={api} feed={input()} />));
  await act(async () => root.render(<Probe api={api} feed={input({ selectedAgentId: "a1" })} />));
  await act(async () =>
    root.render(<Probe api={api} feed={input({ selectedAgentId: "a1", meeting: true })} />),
  );
  expect(calls).toContain('select:["a1"]');
  expect(calls).toContain("meet:[]");
});

test("a request for a person is sent once", async () => {
  const { api, calls } = fakeScene();
  const request = { agentId: "a2", nonce: 1 };
  await act(async () => root.render(<Probe api={api} feed={input()} />));
  await act(async () => root.render(<Probe api={api} feed={input({ focusRequest: request })} />));
  await act(async () => root.render(<Probe api={api} feed={input({ focusRequest: request })} />));
  expect(calls.filter((call) => call === 'select:["a2"]')).toHaveLength(1);
});
