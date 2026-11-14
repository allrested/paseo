/**
 * @vitest-environment jsdom
 */
// The Flows section, mounted: it lists the workspace's flows, starts one, shows the host's run,
// and sends a failure to an agent.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  PluginRpcProvider,
  type PluginSubscribe,
  type PluginSubscriptionObserver,
} from "@getpaseo/plugin/client/host";
import type { MaestroRunState } from "../shared/contracts.js";
import { MaestroFlows } from "./maestro-flows.js";
import type { AndroidStyles } from "./styles.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { TextInput: Input } = await import("react-native");
  return { TextInput: Input };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const STYLES = new Proxy({}, { get: () => ({}) }) as unknown as AndroidStyles;
const FAILED: MaestroRunState = {
  id: "run-1",
  flow: ".maestro/login.yaml",
  status: "failed",
  startedAt: 1_000,
  endedAt: 13_000,
  failedStep: 'Tap on "Login"',
  message: "Element not found",
  hasPicture: true,
  output: ['Tap on "Login"... FAILED'],
};

let calls: Array<[string, unknown]>;
let runs: PluginSubscriptionObserver[];
let container: HTMLElement;
let root: Root;

const subscribe: PluginSubscribe = (_method, _input, observer) => {
  runs.push(observer);
  const close = () => undefined;
  return Object.assign(close, { ready: Promise.resolve(), release: async () => close() });
};

async function invoke(method: string, input: unknown): Promise<unknown> {
  calls.push([method, input]);
  if (method === "android.maestro.flows.request") {
    return { flows: [".maestro/login.yaml", "packages/app/maestro/create.yml"] };
  }
  if (method === "android.maestro.agents.request")
    return { agents: [{ id: "a1", title: "Builder" }] };
  return { ok: true };
}

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));
const press = async (label: string) => {
  const button = container.querySelector(`[aria-label='${label}']`) as HTMLElement | null;
  if (!button) throw new Error(`No button ${label}: ${container.textContent}`);
  await act(async () => button.click());
  await settle();
};
const hostRun = async (run: MaestroRunState | null) => {
  await act(async () => runs[0]!.event({ run }));
  await settle();
};

beforeEach(async () => {
  calls = [];
  runs = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <PluginRpcProvider invoke={invoke} subscribe={subscribe}>
        <MaestroFlows workspaceId="w1" styles={STYLES} />
      </PluginRpcProvider>,
    ),
  );
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("lists the workspace's flows and runs the one pressed", async () => {
  expect(container.textContent).toContain(".maestro/login.yaml");
  expect(container.textContent).toContain("packages/app/maestro/create.yml");
  await press("Run .maestro/login.yaml");
  expect(calls).toContainEqual([
    "android.maestro.start.request",
    { workspaceId: "w1", flow: ".maestro/login.yaml" },
  ]);
});

test("while a flow runs, it has Stop and no Run buttons", async () => {
  await hostRun({ ...FAILED, status: "running", endedAt: null, failedStep: null, message: null });
  expect(container.querySelector("[aria-label='Run .maestro/login.yaml']")).toBeNull();
  await press("Stop");
  expect(calls).toContainEqual(["android.maestro.stop.request", {}]);
});

test("a failure shows its step, message and output, and goes to an agent", async () => {
  await hostRun(FAILED);
  expect(container.textContent).toContain('Failed at Tap on "Login" · 12 s');
  expect(container.textContent).toContain("Element not found");
  expect(container.textContent).not.toContain('Tap on "Login"... FAILED');
  await press("Show output");
  expect(container.textContent).toContain('Tap on "Login"... FAILED');
  await press("Send to agent");
  await press("Send to Builder");
  expect(calls).toContainEqual([
    "android.maestro.send.request",
    { runId: "run-1", agentId: "a1", note: "" },
  ]);
  expect(container.textContent).toContain("Sent to Builder");
});
