/**
 * @vitest-environment jsdom
 */
// The Host card, mounted: what it offers depends on whether the host can close an agent's
// runtime. Without that, an idle agent's runtime cannot be closed, so nothing offers to; a closed
// agent's leftover processes can still be stopped.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Machine, MachineAgent } from "../shared/contracts.js";
import { MachineCard } from "./machine-card.js";
import { useOfficeStyles } from "./styles.js";

vi.mock("@getpaseo/plugin/client/ui", () => {
  const Modal = (props: { title: string; open: boolean; children: ReactNode }) =>
    props.open ? createElement("section", { "aria-label": props.title }, props.children) : null;
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  return { Modal };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

function agent(patch: Partial<MachineAgent>): MachineAgent {
  return {
    agentId: "a1",
    title: "Agent",
    status: "idle",
    rssBytes: 1024 * 1024,
    processCount: 1,
    ports: [],
    idleSince: "2026-11-18T08:00:00.000Z",
    forgotten: false,
    ...patch,
  };
}

function reading(agents: MachineAgent[], canCloseRuntime?: boolean): Machine {
  return {
    readAt: "2026-11-18T09:00:00.000Z",
    memory: { usedBytes: 1, totalBytes: 2 },
    cpuPercent: 1,
    agents,
    ...(canCloseRuntime === undefined ? {} : { canCloseRuntime }),
  };
}

const IDLE = agent({ agentId: "idle", title: "Idler" });
const FORGOTTEN_IDLE = agent({ agentId: "left", title: "Leaver", ports: [5173], forgotten: true });
const CLOSED = agent({
  agentId: "gone",
  title: "Gone",
  status: "closed",
  idleSince: null,
  forgotten: true,
});

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const cleanUp = async () => undefined;
const onClose = () => undefined;

function Card({ machine }: { machine: Machine }) {
  const styles = useOfficeStyles(THEME, false, false);
  return <MachineCard machine={machine} open cleanUp={cleanUp} styles={styles} onClose={onClose} />;
}

async function labels(machine: Machine): Promise<string[]> {
  await act(async () => root.render(<Card machine={machine} />));
  return [...container.querySelectorAll<HTMLElement>("button")].map((button) =>
    (button.textContent ?? "").replace(/Closing\.\.\.|Cleaning up\.\.\./g, "").trim(),
  );
}

test("a host that can close offers Close on an idle agent and Clean up on a forgotten one", async () => {
  for (const can of [true, undefined]) {
    expect(await labels(reading([IDLE, FORGOTTEN_IDLE], can))).toEqual(["Clean up", "Close"]);
  }
});

test("a host that cannot close offers neither for an idle agent", async () => {
  expect(await labels(reading([IDLE, FORGOTTEN_IDLE], false))).toEqual([]);
});

test("a host that cannot close still stops what a closed agent left", async () => {
  expect(await labels(reading([CLOSED, FORGOTTEN_IDLE], false))).toEqual(["Clean up"]);
});

test("Clean up all counts only what this host can clean", async () => {
  const second = { ...CLOSED, agentId: "gone2", title: "Gone too" };
  expect(await labels(reading([CLOSED, second, FORGOTTEN_IDLE], false))).toEqual([
    "Clean up",
    "Clean up",
    "Clean up all 2",
  ]);
  expect(await labels(reading([CLOSED, second, FORGOTTEN_IDLE], true))).toEqual([
    "Clean up",
    "Clean up",
    "Clean up",
    "Clean up all 3",
  ]);
});

test("a host that cannot close offers nothing for an agent in error or still starting", async () => {
  const failed = agent({ agentId: "err", title: "Broken", status: "error", forgotten: true });
  const starting = agent({ agentId: "init", title: "Starting", status: "initializing" });
  expect(await labels(reading([failed, starting], false))).toEqual([]);
});
