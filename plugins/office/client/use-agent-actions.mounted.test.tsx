/**
 * @vitest-environment jsdom
 */
// The agent actions as the host's SDK gives them: Stop exists only where an agent's handle has
// cancel(), and asking for it sends nothing.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useAgentActions, type AgentActions } from "./use-agent-actions.js";

/** What the host's `agents.ref(id)` returns; a handle with `cancel` is the fork's. */
let handle: Record<string, unknown>;
let refs: string[];

vi.mock("@getpaseo/plugin/client", () => ({
  usePaseo: () => ({
    agents: {
      ref: (id: string) => {
        refs.push(id);
        return handle;
      },
    },
  }),
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

let container: HTMLElement;
let root: Root;
let actions: AgentActions | null;

function Probe() {
  actions = useAgentActions();
  return null;
}

beforeEach(() => {
  refs = [];
  actions = null;
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

test("where the handle has cancel(), the actions cancel through it, bound to the handle", async () => {
  const stopped: string[] = [];
  handle = {
    id: "a1",
    async cancel(this: { id: string }) {
      stopped.push(this.id);
    },
  };
  await act(async () => root.render(<Probe />));
  expect(actions?.cancel).not.toBeNull();
  await actions?.cancel?.("a1");
  expect(stopped).toEqual(["a1"]);
});

test("where the handle has no cancel(), the actions have none", async () => {
  handle = { send: async () => undefined };
  await act(async () => root.render(<Probe />));
  expect(actions?.cancel).toBeNull();
});
